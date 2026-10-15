#!/usr/bin/env python3
"""Apply a single ClickHouse DDL file (including DROP VIEW / RENAME migrations)."""

from __future__ import annotations

import argparse
import os
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

from apply_clickhouse_ddl import parse_statements_from_text, substitute_dict_env


def get_client(host: str | None, port: int | None):
    return clickhouse_connect.get_client(
        host=host or os.environ.get("CLICKHOUSE_HOST", "localhost"),
        port=port or int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "web_tracking"),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply one ClickHouse DDL file manually.")
    parser.add_argument("file", type=Path, help="Path to .sql file")
    parser.add_argument("--host", help="ClickHouse host (overrides .env)")
    parser.add_argument("--port", type=int, help="ClickHouse HTTP port (overrides .env)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    path = args.file if args.file.is_absolute() else ROOT / args.file
    if not path.is_file():
        raise SystemExit(f"File not found: {path}")

    host = args.host or os.environ.get("CLICKHOUSE_HOST", "localhost")
    port = args.port or int(os.environ.get("CLICKHOUSE_PORT", "8123"))
    print(f"Target: {host}:{port}")
    print(f"Applying: {path.name}")

    raw_sql = path.read_text(encoding="utf-8")
    if path.name == "02b_dict_admin_accounts.sql":
        raw_sql = substitute_dict_env(raw_sql)

    statements = parse_statements_from_text(raw_sql)
    client = get_client(args.host, args.port)

    for i, stmt in enumerate(statements, 1):
        preview = stmt.replace("\n", " ")[:120]
        print(f"  [{i}/{len(statements)}] {preview}...")
        if args.dry_run:
            continue
        client.command(stmt)

    if not args.dry_run:
        if "known_users" in path.name:
            rows = client.query(
                """
                SELECT name, engine
                FROM system.tables
                WHERE database = 'web_tracking'
                  AND name LIKE 'dim_known_users%'
                ORDER BY name
                """
            ).result_rows
            print("\nKnown-user objects:")
            for name, engine in rows:
                print(f"  {name} ({engine})")
            sample = client.query(
                """
                SELECT count() AS rows
                FROM web_tracking.dim_known_users
                """
            ).result_rows
            if sample:
                print(f"  dim_known_users (view) rows: {sample[0][0]:,}")
        else:
            rows = client.query(
                """
                SELECT name, engine
                FROM system.tables
                WHERE database = 'web_tracking'
                  AND name LIKE 'fact_page_views%'
                ORDER BY name
                """
            ).result_rows
            print("\nPage view tables:")
            for name, engine in rows:
                count = client.query(
                    f"SELECT count() FROM web_tracking.{name}"
                ).result_rows[0][0]
                print(f"  {name} ({engine}): {count:,} rows")

    client.close()
    print("\nDone." if not args.dry_run else "\nDry run complete.")


if __name__ == "__main__":
    main()
