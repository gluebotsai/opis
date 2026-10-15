#!/usr/bin/env python3
"""
seed_routing_index.py  —  create and fill routing.tenant_index
==============================================================
TARGET PATH:  scripts/seed_routing_index.py

Run ONCE before the first v2 load, and again after any bulk import that
bypassed CDC. It creates the control-plane routing table and bulk-loads one
row per parent entity that a tenant.via chain points at, so the consumer
starts warm instead of cold-missing every child row.

  python scripts/seed_routing_index.py --core config/mappings/core.yaml
  python scripts/seed_routing_index.py --check          # report only

The table lives in the CONTROL-PLANE database (the one that holds tenant
metadata), not in any tenant database. Point CONTROL_DSN at it.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import yaml

DDL = """
CREATE SCHEMA IF NOT EXISTS routing;

CREATE TABLE IF NOT EXISTS routing.tenant_index (
    entity_table    text        NOT NULL,
    entity_id       text        NOT NULL,
    organization_id bigint      NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_table, entity_id)
);

-- tenants_for_global() and any per-tenant sweep read this
CREATE INDEX IF NOT EXISTS tenant_index_org
    ON routing.tenant_index (organization_id);

-- rows parked because their parent had not arrived yet
CREATE TABLE IF NOT EXISTS routing.pending_rows (
    id            bigserial PRIMARY KEY,
    child_table   text        NOT NULL,
    parent_table  text        NOT NULL,
    parent_id     text        NOT NULL,
    payload       jsonb       NOT NULL,
    attempts      int         NOT NULL DEFAULT 0,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_try_at   timestamptz
);

-- drained by parent arrival; anything older than the SLA is a real orphan
CREATE INDEX IF NOT EXISTS pending_rows_parent
    ON routing.pending_rows (parent_table, parent_id);
CREATE INDEX IF NOT EXISTS pending_rows_age
    ON routing.pending_rows (first_seen_at);
"""

TENANT_COL = "organization_id"


def parents_needed(doc: dict) -> dict[str, str]:
    """Every table a tenant.via chain points at -> the key column to index on."""
    out: dict[str, str] = {}
    for spec in (doc.get("tables") or {}).values():
        if not isinstance(spec, dict):
            continue
        for hop in ((spec.get("tenant") or {}).get("via") or []):
            out[hop["parent"]] = hop.get("parent_key", "id")
    # the tenant list itself, used by tenants_for_global()
    out["accounts.organizations"] = "id"
    return out


def has_tenant_column(doc: dict, table: str) -> bool:
    spec = (doc.get("tables") or {}).get(table, {})
    for p in (spec.get("properties") or []):
        name = p.get("as") or p.get("from") if isinstance(p, dict) else p
        if name == TENANT_COL:
            return True
    return table == "accounts.organizations"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--core", default="config/mappings/core.yaml")
    ap.add_argument("--control-dsn", default=os.environ.get("CONTROL_DSN"))
    ap.add_argument("--source-dsn", default=os.environ.get("SOURCE_DSN"))
    ap.add_argument("--check", action="store_true", help="report counts, write nothing")
    args = ap.parse_args()

    doc = yaml.safe_load(Path(args.core).read_text())
    targets = parents_needed(doc)

    print(f"parent entities to index: {len(targets)}")
    for t, k in sorted(targets.items()):
        via = "own column" if has_tenant_column(doc, t) else "NEEDS ITS OWN CHAIN"
        print(f"  {t:<42} key={k:<6} {via}")

    if args.check:
        return 0
    if not (args.control_dsn and args.source_dsn):
        return print("set CONTROL_DSN and SOURCE_DSN (or pass --control-dsn/--source-dsn)") or 2

    import psycopg2
    control = psycopg2.connect(args.control_dsn); control.autocommit = True
    source = psycopg2.connect(args.source_dsn)

    with control.cursor() as cur:
        cur.execute(DDL)
    print("\nrouting schema ready")

    total = 0
    for table, key in sorted(targets.items()):
        if not has_tenant_column(doc, table):
            print(f"  {table}: parent has no {TENANT_COL} either — resolve its own chain first")
            continue
        schema, tbl = table.split(".", 1)
        org_expr = "id" if table == "accounts.organizations" else TENANT_COL
        with source.cursor() as sc:
            try:
                sc.execute(f'SELECT "{key}"::text, "{org_expr}" FROM "{schema}"."{tbl}" '
                           f'WHERE "{org_expr}" IS NOT NULL')
                rows = sc.fetchall()
            except Exception as e:
                source.rollback()
                print(f"  {table}: SKIPPED ({e.__class__.__name__})")
                continue
        if not rows:
            print(f"  {table}: 0 rows")
            continue
        with control.cursor() as cc:
            from psycopg2.extras import execute_values
            execute_values(
                cc,
                "INSERT INTO routing.tenant_index (entity_table, entity_id, organization_id) "
                "VALUES %s ON CONFLICT (entity_table, entity_id) DO UPDATE "
                "SET organization_id = EXCLUDED.organization_id, updated_at = now()",
                [(table, r[0], r[1]) for r in rows])
        total += len(rows)
        print(f"  {table}: {len(rows)} indexed")

    print(f"\n{total} routing entries seeded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
