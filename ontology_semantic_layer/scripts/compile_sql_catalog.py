#!/usr/bin/env python3
"""Compile SQL agent catalogs from Postgres information_schema + YAML sources."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML required") from exc

COMPILED_DIR = ROOT / "sql_agent" / "catalog" / "compiled"
CATALOG_DIR = ROOT / "sql_agent" / "catalog" / "sources"
JOINS_PATH = ROOT / "sql_agent" / "catalog" / "sources" / "joins.yml"

_PRODUCT_SCHEMAS: dict[str, list[str]] = {
    "ticketing": [
        "ticketing_marts",
        "ticketing_staging",
        "ticketing",
        "accounts",
        "cdp",
    ],
    "ccaas": ["ccass_marts_aiccaas", "ccaas_staging", "ccaas", "accounts"],
    "crm": ["crm_marts", "crm_staging", "crm", "accounts"],
    "campaign": ["campaign_marts", "campaign_staging", "campaign", "accounts"],
    "webtracking": ["webtracking_marts", "webtracking_staging", "accounts"],
    "cdp": ["cdp_marts", "cdp_staging", "cdp", "accounts"],
}

_SYNONYMS: dict[str, dict[str, str]] = {
    "ticketing": {
        "team": "queue_name",
        "agent": "assignee_name",
        "escalation": "action",
        "history": "audit_event",
    },
    "ccaas": {"team": "queue_name", "agent": "assigned_agent_name"},
}


def _load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


def _pg_columns(schemas: list[str]) -> dict[tuple[str, str], list[str]]:
    try:
        import psycopg2
    except ImportError:
        return {}

    _load_dotenv()
    host = os.environ.get("pg_host") or os.environ.get("PG_HOST")
    if not host:
        return {}

    from semantic.pg_pool import checkout_connection, release_connection

    out: dict[tuple[str, str], list[str]] = {}
    conn = checkout_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT table_schema, table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = ANY(%s)
                ORDER BY table_schema, table_name, ordinal_position
                """,
                (schemas,),
            )
            for schema, table, col in cur.fetchall():
                out.setdefault((schema, table), []).append(col)
    finally:
        release_connection(conn)
    return out


def _pg_keys(schemas: list[str]) -> tuple[
    dict[tuple[str, str], list[str]],
    dict[tuple[str, str], list[dict[str, str]]],
]:
    """Return PK columns and FK edges keyed by (schema, table)."""
    _load_dotenv()
    host = os.environ.get("pg_host") or os.environ.get("PG_HOST")
    if not host:
        return {}, {}

    from semantic.pg_pool import checkout_connection, release_connection

    pk: dict[tuple[str, str], list[str]] = {}
    fk: dict[tuple[str, str], list[dict[str, str]]] = {}
    try:
        conn = checkout_connection()
    except Exception:
        return {}, {}
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT tc.table_schema, tc.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = ANY(%s)
                ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
                """,
                (schemas,),
            )
            for schema, table, col in cur.fetchall():
                pk.setdefault((schema, table), []).append(col)

            cur.execute(
                """
                SELECT
                  src_ns.nspname AS src_schema,
                  src.relname AS src_table,
                  src_att.attname AS src_column,
                  tgt_ns.nspname AS tgt_schema,
                  tgt.relname AS tgt_table,
                  tgt_att.attname AS tgt_column
                FROM pg_constraint c
                JOIN pg_class src ON src.oid = c.conrelid
                JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
                JOIN pg_class tgt ON tgt.oid = c.confrelid
                JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
                JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS src_keys(attnum, ord)
                  ON true
                JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS tgt_keys(attnum, ord)
                  ON src_keys.ord = tgt_keys.ord
                JOIN pg_attribute src_att
                  ON src_att.attrelid = src.oid AND src_att.attnum = src_keys.attnum
                JOIN pg_attribute tgt_att
                  ON tgt_att.attrelid = tgt.oid AND tgt_att.attnum = tgt_keys.attnum
                WHERE c.contype = 'f'
                  AND src_ns.nspname = ANY(%s)
                ORDER BY src_schema, src_table, src_column
                """,
                (schemas,),
            )
            for (
                src_schema,
                src_table,
                src_col,
                tgt_schema,
                tgt_table,
                tgt_col,
            ) in cur.fetchall():
                fk.setdefault((src_schema, src_table), []).append(
                    {
                        "column": src_col,
                        "references_schema": tgt_schema,
                        "references_table": tgt_table,
                        "references_column": tgt_col,
                    }
                )
    finally:
        release_connection(conn)
    return pk, fk


def _preferred_source(schema: str) -> str:
    if "mart" in schema:
        return "mart"
    if "staging" in schema or schema.endswith("_staging"):
        return "staging"
    return "ops"


def _merge_table(
    yaml_tbl: dict[str, Any],
    pg_cols: dict[tuple[str, str], list[str]],
    pg_pk: dict[tuple[str, str], list[str]] | None = None,
    pg_fk: dict[tuple[str, str], list[dict[str, str]]] | None = None,
) -> dict[str, Any]:
    schema = str(yaml_tbl.get("schema") or "")
    name = str(yaml_tbl.get("name") or "")
    pg = pg_cols.get((schema, name), [])
    pk = (pg_pk or {}).get((schema, name), [])
    fks = (pg_fk or {}).get((schema, name), [])
    yaml_cols = [
        c.get("name") if isinstance(c, dict) else str(c)
        for c in (yaml_tbl.get("columns") or [])
    ]
    sem_dims = [str(d) for d in (yaml_tbl.get("semantic_dimensions") or [])]
    columns = sorted(set(yaml_cols) | set(pg) | set(sem_dims))
    return {
        "name": name,
        "schema": schema,
        "grain": yaml_tbl.get("grain"),
        "preferred_source": _preferred_source(schema),
        "sql_agent_read": yaml_tbl.get("sql_agent_only") is not True,
        "row_scope_column": yaml_tbl.get("row_scope_column"),
        "tenant_column": yaml_tbl.get("tenant_column") or "organization_id",
        "columns": columns,
        "primary_key": pk or None,
        "foreign_keys": fks or None,
        "semantic_dimensions": sem_dims,
        "description": yaml_tbl.get("description"),
    }


def compile_product(
    product: str,
    pg_cols: dict[tuple[str, str], list[str]],
    pg_pk: dict[tuple[str, str], list[str]] | None = None,
    pg_fk: dict[tuple[str, str], list[dict[str, str]]] | None = None,
) -> dict[str, Any]:
    path = CATALOG_DIR / f"{product}.yaml"
    if not path.is_file():
        raise FileNotFoundError(path)
    with path.open(encoding="utf-8") as fh:
        base = yaml.safe_load(fh) or {}

    tables = [
        _merge_table(tbl, pg_cols, pg_pk, pg_fk)
        for tbl in (base.get("tables") or [])
        if tbl.get("sql_agent_only") is not True
    ]

    joins: list[dict[str, Any]] = []
    if JOINS_PATH.is_file():
        with JOINS_PATH.open(encoding="utf-8") as fh:
            joins_doc = yaml.safe_load(fh) or {}
        joins = list((joins_doc.get("joins") or {}).get(product) or [])

    return {
        "version": 1,
        "product": product,
        "engine": base.get("engine") or "postgres",
        "default_schema": base.get("default_schema"),
        "tenant_column": base.get("tenant_column") or "organization_id",
        "tables": tables,
        "joins": joins,
        "synonyms": _SYNONYMS.get(product, {"team": "queue_name"}),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compile SQL agent catalogs")
    parser.add_argument(
        "--product",
        action="append",
        choices=list(_PRODUCT_SCHEMAS),
        help="Product to compile (default: all)",
    )
    args = parser.parse_args()
    products = args.product or list(_PRODUCT_SCHEMAS)

    COMPILED_DIR.mkdir(parents=True, exist_ok=True)
    schemas = sorted({s for p in products for s in _PRODUCT_SCHEMAS.get(p, [])})
    pg_cols = _pg_columns(schemas)
    pg_pk, pg_fk = _pg_keys(schemas)

    for product in products:
        path = CATALOG_DIR / f"{product}.yaml"
        if not path.is_file():
            print(f"Skip {product}: missing {path}")
            continue
        doc = compile_product(product, pg_cols, pg_pk, pg_fk)
        out = COMPILED_DIR / f"{product}.yml"
        with out.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(doc, fh, sort_keys=False, default_flow_style=False)
        print(f"Wrote {out} ({len(doc.get('tables') or [])} tables)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
