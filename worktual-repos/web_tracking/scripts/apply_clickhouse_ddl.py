#!/usr/bin/env python3
"""Apply ClickHouse DDL files in order (create-only, production-safe)."""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv:
    load_dotenv(ROOT / ".env")

import clickhouse_connect

DDL_DIR = ROOT / "clickhouse" / "ddl"
SAFE_ORDER = [
    "00_web_tracking.sql",
    "01_bronze.sql",
    "02_auth_and_dim.sql",
    "02b_dict_admin_accounts.sql",
    "03_silver_facts.sql",
    "04_gold_aggs.sql",
    "04b_organization_id_columns.sql",
    "05_materialized_views_pipeline.sql",
    "07_replay_chunks.sql",
    "11_session_bounce_metrics.sql",
    "13_ecommerce_daily.sql",
]

BACKFILL_MANUAL = [
    "11b_backfill_session_bounce.sql",
    "12b_backfill_organization_id.sql",
]

DICTIONARY_ONLY = ["02b_dict_admin_accounts.sql"]
EXCLUDED_FILES = {
    "06_recreate_mv_profile_fix.sql",
    "11b_backfill_session_bounce.sql",
    "12_recreate_mv_organization_id.sql",
    "12b_backfill_organization_id.sql",
    "16_fact_page_views_dedupe.sql",
    "17_fix_dim_known_users.sql",
}
LEGACY_DATABASES = ("bronze", "silver", "gold", "dim")
FORBIDDEN_PATTERN = re.compile(
    r"\b(DROP\s+(TABLE|VIEW|DATABASE|COLUMN)|TRUNCATE\s+TABLE|DELETE\s+FROM|ALTER\s+TABLE\s+.+\s+DROP)\b",
    re.IGNORECASE | re.DOTALL,
)

DICT_ENV_DEFAULTS = {
    "__CH_DICT_PG_HOST__": lambda: os.environ.get("CH_DICT_PG_HOST") or os.environ.get("DB_HOST", "10.180.0.126"),
    "__CH_DICT_PG_PORT__": lambda: os.environ.get("CH_DICT_PG_PORT") or os.environ.get("DB_PORT", "5432"),
    "__CH_DICT_PG_DB__": lambda: os.environ.get("CH_DICT_PG_DB") or os.environ.get("DB_NAME", "worktual"),
    "__CH_DICT_PG_USER__": lambda: os.environ.get("CH_DICT_PG_USER", "ch_sync"),
    "__CH_DICT_PG_PASSWORD__": lambda: os.environ.get("CH_DICT_PG_PASSWORD", ""),
    "__CH_DICT_PG_SCHEMA__": lambda: os.environ.get("CH_DICT_PG_SCHEMA") or os.environ.get("DB_SCHEMA", "public"),
    "__CH_DICT_PG_TABLE__": lambda: os.environ.get("CH_DICT_PG_TABLE", "admin_accounts"),
}


def substitute_dict_env(sql: str) -> str:
    out = sql
    for token, resolver in DICT_ENV_DEFAULTS.items():
        out = out.replace(token, resolver())
    return out


def get_client(database: str | None = None):
    return clickhouse_connect.get_client(
        host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
        port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=database or os.environ.get("CLICKHOUSE_DATABASE", "default"),
    )


def _strip_leading_comments(sql: str) -> str:
    lines = sql.splitlines()
    while lines and lines[0].strip().startswith("--"):
        lines.pop(0)
    return "\n".join(lines).strip()


def _remove_line_comments(sql: str) -> str:
    lines = []
    for line in sql.splitlines():
        if "--" in line:
            line = line[: line.index("--")]
        lines.append(line)
    return "\n".join(lines)


def parse_statements(path: Path) -> list[str]:
    return parse_statements_from_text(path.read_text(encoding="utf-8"))


def parse_statements_from_text(sql: str) -> list[str]:
    sql = _remove_line_comments(sql)
    statements = [_strip_leading_comments(s) for s in sql.split(";")]
    return [s for s in statements if s.strip()]


def validate_statement(stmt: str, source: str) -> None:
    if FORBIDDEN_PATTERN.search(stmt):
        raise RuntimeError(
            f"Blocked destructive statement in {source}: "
            f"{stmt[:120].replace(chr(10), ' ')}..."
        )


def validate_files(files: list[str]) -> None:
    for name in files:
        if name in EXCLUDED_FILES:
            raise RuntimeError(
                f"Refusing to apply {name} — contains DROP VIEW statements. "
                "Use files 00-05 only for live migration."
            )


def print_inventory(client, label: str) -> None:
    print(f"\n=== {label} ===")
    rows = client.query(
        """
        SELECT database, count() AS table_count
        FROM system.tables
        WHERE database IN {dbs:Array(String)}
        GROUP BY database
        ORDER BY database
        """,
        parameters={"dbs": list(LEGACY_DATABASES)},
    ).result_rows
    for db, count in rows:
        print(f"  {db}: {count} tables")

    wt = client.query(
        "SELECT count() FROM system.tables WHERE database = 'web_tracking'"
    ).result_rows[0][0]
    print(f"  web_tracking: {wt} objects")


def apply_ddl(client, path: Path, *, dry_run: bool) -> None:
    raw_sql = path.read_text(encoding="utf-8")
    if path.name == "02b_dict_admin_accounts.sql":
        raw_sql = substitute_dict_env(raw_sql)
        if not os.environ.get("CH_DICT_PG_PASSWORD") and not dry_run:
            print(
                "WARNING: CH_DICT_PG_PASSWORD not set — dictionary may fail to load from PostgreSQL."
            )
    statements = parse_statements_from_text(raw_sql)
    print(f"Applying {path.name} ({len(statements)} statements)...")
    for stmt in statements:
        validate_statement(stmt, path.name)
        if dry_run:
            preview = stmt.replace("\n", " ")[:100]
            print(f"  [dry-run] {preview}...")
            continue
        client.command(stmt)


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply ClickHouse DDL (create-only).")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print statements without executing.",
    )
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip pre-flight inventory (not recommended for live).",
    )
    parser.add_argument(
        "--dictionary-only",
        action="store_true",
        help="Apply only dict_admin_accounts (02b). Use after DROP DICTIONARY on live.",
    )
    args = parser.parse_args()

    file_order = DICTIONARY_ONLY if args.dictionary_only else SAFE_ORDER
    validate_files(file_order)

    host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    print(f"Target: {host}:{os.environ.get('CLICKHOUSE_PORT', '8123')}")

    client = get_client("default")
    if not args.skip_preflight:
        print_inventory(client, "Pre-flight inventory")

    for name in file_order:
        path = DDL_DIR / name
        if not path.exists():
            raise FileNotFoundError(path)
        apply_ddl(client, path, dry_run=args.dry_run)
        if name == "00_web_tracking.sql" and not args.dry_run and not args.dictionary_only:
            client.close()
            client = get_client(os.environ.get("CLICKHOUSE_DATABASE", "web_tracking"))

    if not args.dry_run:
        client.close()
        client = get_client("default")
        print_inventory(client, "Post-flight inventory")
        client.close()
    else:
        client.close()

    if args.dry_run:
        print("\nDry run complete — no changes applied.")
    else:
        print("\nDDL applied successfully.")


if __name__ == "__main__":
    main()
