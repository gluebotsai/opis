#!/usr/bin/env python3
"""Apply dim_known_users DDL for **new** installs (create-only).

For existing servers with the old flat ReplacingMergeTree table, run the migration:
  python3 scripts/apply_clickhouse_manual.py clickhouse/ddl/17_fix_dim_known_users.sql

Uses connection settings from .env (CLICKHOUSE_HOST, CLICKHOUSE_PORT, etc.).

Usage:
  python3 scripts/apply_dim_known_users.py
  python3 scripts/apply_dim_known_users.py --dry-run
"""

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

DDL_PATH = ROOT / "clickhouse" / "ddl" / "15_dim_known_users.sql"
MIGRATION_PATH = ROOT / "clickhouse" / "ddl" / "17_fix_dim_known_users.sql"

FORBIDDEN_PATTERN = re.compile(
    r"\b(DROP\s+(TABLE|VIEW|DATABASE|COLUMN)|TRUNCATE\s+TABLE|DELETE\s+FROM|ALTER\s+TABLE\s+.+\s+DROP)\b",
    re.IGNORECASE | re.DOTALL,
)


def get_client():
    return clickhouse_connect.get_client(
        host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
        port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "web_tracking"),
    )


def parse_statements(sql: str) -> list[str]:
    lines = []
    for line in sql.splitlines():
        if "--" in line:
            line = line[: line.index("--")]
        lines.append(line)
    parts = "\n".join(lines).split(";")
    return [s.strip() for s in parts if s.strip()]


def validate_statement(stmt: str) -> None:
    if FORBIDDEN_PATTERN.search(stmt):
        raise RuntimeError(f"Blocked destructive statement: {stmt[:120].replace(chr(10), ' ')}...")


def detect_legacy_table(client) -> bool:
    rows = client.query(
        """
        SELECT engine
        FROM system.tables
        WHERE database = 'web_tracking' AND name = 'dim_known_users'
        """
    ).result_rows
    if not rows:
        return False
    engine = str(rows[0][0])
    return engine == "ReplacingMergeTree" or engine == "MergeTree"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply dim_known_users identity DDL (new installs only).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print SQL statements without executing.",
    )
    parser.add_argument(
        "--force-new",
        action="store_true",
        help="Apply 15_dim_known_users.sql even if legacy table exists (may fail).",
    )
    args = parser.parse_args()

    if not DDL_PATH.is_file():
        print(f"ERROR: DDL file not found: {DDL_PATH}", file=sys.stderr)
        return 1

    host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    port = os.environ.get("CLICKHOUSE_PORT", "8123")
    print(f"Target: {host}:{port}")
    print(f"DDL:    {DDL_PATH.relative_to(ROOT)}")

    client = get_client()
    try:
        if detect_legacy_table(client) and not args.force_new:
            print(
                "\nLegacy dim_known_users table detected (ReplacingMergeTree).\n"
                "Run the migration instead:\n"
                f"  python3 scripts/apply_clickhouse_manual.py {MIGRATION_PATH.relative_to(ROOT)}\n"
            )
            return 1
    finally:
        client.close()

    statements = parse_statements(DDL_PATH.read_text(encoding="utf-8"))
    print(f"Statements: {len(statements)}")

    if args.dry_run:
        for i, stmt in enumerate(statements, 1):
            validate_statement(stmt)
            preview = stmt.replace("\n", " ")[:120]
            print(f"  [{i}] {preview}...")
        print("\nDry run complete — no changes applied.")
        return 0

    client = get_client()
    try:
        for i, stmt in enumerate(statements, 1):
            validate_statement(stmt)
            preview = stmt.split("\n")[0][:80]
            print(f"  [{i}/{len(statements)}] {preview}...")
            client.command(stmt)

        rows = client.query(
            """
            SELECT name, engine
            FROM system.tables
            WHERE database = 'web_tracking'
              AND name IN ('dim_known_users', 'dim_known_users_state', 'mv_dim_known_users')
            ORDER BY name
            """
        ).result_rows
        print("\nObjects:")
        for name, engine in rows:
            print(f"  web_tracking.{name} ({engine})")
    finally:
        client.close()

    print("\nDone — dim_known_users DDL applied.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
