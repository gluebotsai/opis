#!/usr/bin/env python3
"""
Form-tracking diagnostic queries for ClickHouse (no extra packages).

Usage (from project root):
  python3 scripts/check_form_tracking.py
  python3 scripts/check_form_tracking.py --website-id 12345
  python3 scripts/check_form_tracking.py --website-id 12345 --days 7

Uses CLICKHOUSE_* from .env in project root.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def ch_query(host: str, port: int, user: str, password: str, database: str, sql: str) -> list[list]:
    query = sql.strip() + "\n FORMAT JSONCompact"
    url = f"http://{host}:{port}/?database={urllib.parse.quote(database)}"
    body = query.encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    req.add_header("Authorization", f"Basic {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ClickHouse HTTP {exc.code}: {err}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot reach ClickHouse at {host}:{port}: {exc}") from exc
    return payload.get("data") or []


def print_table(title: str, columns: list[str], rows: list[list]) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)
    if not rows:
        print("(no rows)")
        return
    widths = [len(c) for c in columns]
    formatted: list[list[str]] = []
    for row in rows:
        cells = ["" if v is None else str(v) for v in row]
        formatted.append(cells)
        for i, cell in enumerate(cells):
            widths[i] = min(max(widths[i], len(cell)), 100)
    print(" | ".join(columns[i].ljust(widths[i]) for i in range(len(columns))))
    print("-+-".join("-" * w for w in widths))
    for cells in formatted:
        print(" | ".join(cells[i][: widths[i]].ljust(widths[i]) for i in range(len(cells))))


def main() -> int:
    load_env_file(ROOT / ".env")

    parser = argparse.ArgumentParser(description="Check form tracking in ClickHouse")
    parser.add_argument("--website-id", type=int, default=int(os.environ.get("CHECK_DOMAIN_ID", "12345")))
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()

    host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    port = int(os.environ.get("CLICKHOUSE_PORT", "8123"))
    user = os.environ.get("CLICKHOUSE_USER", "default")
    password = os.environ.get("CLICKHOUSE_PASSWORD", "")
    db = os.environ.get("CLICKHOUSE_DATABASE", "web_tracking")
    website_id = args.website_id
    days = args.days

    print(f"ClickHouse: {host}:{port} / {db}")
    print(f"website_id: {website_id}  |  last {days} day(s)")

    def q(sql: str) -> list[list]:
        return ch_query(host, port, user, password, db, sql)

    try:
        print_table(
            "1) SUMMARY — event counts",
            ["source", "cnt"],
            q(f"""
            SELECT 'fact_form_events' AS source, count() AS cnt
            FROM {db}.fact_form_events
            WHERE website_id = {website_id}
              AND created_at >= now() - INTERVAL {days} DAY
            UNION ALL
            SELECT 'custom: lead_form_*', count()
            FROM {db}.fact_custom_events
            WHERE website_id = {website_id}
              AND event_name LIKE 'lead_form%'
              AND created_at >= now() - INTERVAL {days} DAY
            UNION ALL
            SELECT 'custom: any %form%', count()
            FROM {db}.fact_custom_events
            WHERE website_id = {website_id}
              AND event_name LIKE '%form%'
              AND created_at >= now() - INTERVAL {days} DAY
            """),
        )

        print("\nNote: Dashboard Forms page reads fact_form_events (form_* only).")
        print("      lead_form_* goes to fact_custom_events → not shown on Forms UI.")

        print_table(
            "2) FORM FUNNEL — fact_form_events",
            ["event_type", "total"],
            q(f"""
            SELECT event_type, count() AS total
            FROM {db}.fact_form_events
            WHERE website_id = {website_id}
              AND created_at >= now() - INTERVAL {days} DAY
            GROUP BY event_type
            ORDER BY total DESC
            """),
        )

        print_table(
            "3) LATEST form_submit (fields JSON)",
            ["created_at", "form_id", "page_path", "visitor_id", "fields", "extra_data"],
            q(f"""
            SELECT
                created_at,
                form_id,
                page_path,
                visitor_id,
                JSONExtractRaw(extra_data, 'fields') AS fields,
                extra_data
            FROM {db}.fact_form_events
            WHERE website_id = {website_id}
              AND event_type = 'form_submit'
              AND created_at >= now() - INTERVAL {days} DAY
            ORDER BY created_at DESC
            LIMIT 10
            """),
        )

        print_table(
            "4) LATEST lead_form_* (custom_events — wrong name for Forms UI)",
            ["created_at", "event_name", "visitor_id", "event_data"],
            q(f"""
            SELECT created_at, event_name, visitor_id, event_data
            FROM {db}.fact_custom_events
            WHERE website_id = {website_id}
              AND event_name LIKE 'lead_form%'
              AND created_at >= now() - INTERVAL {days} DAY
            ORDER BY created_at DESC
            LIMIT 10
            """),
        )

        print_table(
            "5) LATEST raw_payloads with form events",
            ["received_at", "status", "visitor_id", "website_url", "source_ip"],
            q(f"""
            SELECT
                received_at,
                processing_status,
                visitor_id,
                JSONExtractString(payload, 'websiteUrl') AS website_url,
                source_ip
            FROM {db}.raw_payloads
            WHERE website_id = {website_id}
              AND received_at >= now() - INTERVAL {days} DAY
              AND (
                payload LIKE '%form_submit%'
                OR payload LIKE '%lead_form_submit%'
              )
            ORDER BY received_at DESC
            LIMIT 10
            """),
        )

        print_table(
            "6) BY form_id — views / submits / successes",
            ["form_id", "views", "submits", "successes", "failures"],
            q(f"""
            SELECT
                form_id,
                countIf(event_type = 'form_view') AS views,
                countIf(event_type = 'form_submit') AS submits,
                countIf(event_type = 'form_success') AS successes,
                countIf(event_type = 'form_failure') AS failures
            FROM {db}.fact_form_events
            WHERE website_id = {website_id}
              AND created_at >= now() - INTERVAL {days} DAY
            GROUP BY form_id
            ORDER BY submits DESC
            LIMIT 20
            """),
        )

    except RuntimeError as exc:
        print(f"\nERROR: {exc}")
        return 1

    print("\n" + "=" * 72)
    print("DONE")
    print("=" * 72)
    print("If lead_form_* > 0 but fact_form_events = 0 → rename events to form_submit")
    print("If both = 0 → check Network (nfs-ingestions), selectors, websiteUrl")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
