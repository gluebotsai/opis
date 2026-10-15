"""Read-only Postgres sampling for Detector / Understander."""

from __future__ import annotations

import json
from typing import Any, Callable


def sample_jsonb_keys(
    conn_factory: Callable,
    table: str,
    json_column: str,
    org_column: str,
    org_id: str,
    limit: int = 200,
) -> dict[str, list[Any]]:
    """Return distinct JSON keys with sample values from existing rows."""
    schema, tbl = table.split(".", 1) if "." in table else ("public", table)
    sql = f"""
        SELECT {json_column}
        FROM {schema}.{tbl}
        WHERE {org_column} = %s
          AND {json_column} IS NOT NULL
        LIMIT %s
    """
    keys: dict[str, list[Any]] = {}
    try:
        with conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (org_id, limit))
                for (blob,) in cur.fetchall():
                    if isinstance(blob, str):
                        try:
                            blob = json.loads(blob)
                        except json.JSONDecodeError:
                            continue
                    if not isinstance(blob, dict):
                        continue
                    for k, v in blob.items():
                        keys.setdefault(str(k), [])
                        if len(keys[k]) < 5 and v is not None:
                            keys[k].append(v)
    except Exception:
        pass
    return keys


def fetch_org_industry(conn_factory: Callable, org_id: str) -> str:
    sql = """
        SELECT industry_type FROM accounts.organizations WHERE id = %s LIMIT 1
    """
    try:
        with conn_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (org_id,))
                row = cur.fetchone()
                return str(row[0]) if row and row[0] else "generic"
    except Exception:
        return "generic"
