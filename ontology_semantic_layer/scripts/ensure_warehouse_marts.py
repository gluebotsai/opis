#!/usr/bin/env python3
"""Ensure MF warmup / query marts exist in Postgres; run dbt for missing domains."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# schema, table, dbt domain tag
REQUIRED_MARTS: tuple[tuple[str, str, str], ...] = (
    ("ticketing_marts", "mart_tickets", "ticketing"),
    ("crm_marts", "mart_deals", "crm"),
    ("ccass_marts_aiccaas", "mart_conversations", "ccaas"),
    ("campaign_marts", "mart_campaign_overview", "campaign"),
)


def missing_marts() -> list[tuple[str, str, str]]:
    """Return required marts that are absent (uses semantic-layer DB pool)."""
    try:
        from semantic.sql.db import run_postgres_query
    except Exception as exc:
        print(f"WARN  Cannot load DB helper for mart check: {exc}")
        return []

    missing: list[tuple[str, str, str]] = []
    for schema, table, domain in REQUIRED_MARTS:
        rows = run_postgres_query(
            """
            SELECT 1
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %s
              AND c.relname = %s
              AND c.relkind IN ('r', 'v', 'm')
            LIMIT 1
            """,
            [schema, table],
        )
        if not rows:
            missing.append((schema, table, domain))
    return missing


def _resolve_dbt_exe() -> str | None:
    explicit = os.environ.get("DBT_EXE", "").strip()
    if explicit:
        return explicit
    found = shutil.which("dbt")
    if found:
        return found
    sibling = Path(sys.executable).resolve().parent / "dbt"
    if sibling.is_file():
        return str(sibling)
    return None


def main() -> int:
    missing = missing_marts()
    if not missing:
        print("Warehouse marts: OK (ticketing, crm, ccaas, campaign)")
        return 0

    for schema, table, _domain in missing:
        print(f"  MISSING  {schema}.{table}")

    # Rebuild every domain: shared-staging refresh can CASCADE-drop cross-domain views.
    domains = sorted({domain for _s, _t, domain in REQUIRED_MARTS})
    print(f"\nRunning dbt for all domains: {', '.join(domains)}")
    dbt_exe = _resolve_dbt_exe()
    if dbt_exe is None:
        print(
            "FAIL  dbt not found — pip install dbt-postgres or set DBT_EXE "
            "before starting the API"
        )
        return 1

    cmd = [
        sys.executable,
        str(ROOT / "scripts" / "dbt_run_all.py"),
        "--marts-only",
    ]
    run_env = os.environ.copy()
    run_env["DBT_EXE"] = dbt_exe
    result = subprocess.run(cmd, cwd=ROOT, env=run_env)
    if result.returncode != 0:
        print("FAIL  dbt_run_all did not complete successfully")
        return result.returncode

    still_missing = missing_marts()
    if still_missing:
        for schema, table, _domain in still_missing:
            print(f"  STILL MISSING  {schema}.{table}")
        return 1

    print("Warehouse marts: built successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
