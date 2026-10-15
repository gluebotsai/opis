#!/usr/bin/env python3
"""
Verify Campaign email-click attribution in ClickHouse (read-only).

Usage:
  python3 scripts/check_campaign_attribution.py
  python3 scripts/check_campaign_attribution.py --website-id 1001 --days 7

Uses CLICKHOUSE_* from .env in project root.
"""

from __future__ import annotations

import argparse
import base64
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
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip())


def ch_query(sql: str) -> str:
    host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    port = os.environ.get("CLICKHOUSE_PORT", "8123")
    user = os.environ.get("CLICKHOUSE_USER", "default")
    password = os.environ.get("CLICKHOUSE_PASSWORD", "")
    database = os.environ.get("CLICKHOUSE_DATABASE", "web_tracking")

    url = f"http://{host}:{port}/?database={urllib.parse.quote(database)}"
    req = urllib.request.Request(
        url,
        data=sql.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    if user or password:
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        req.add_header("Authorization", f"Basic {token}")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ClickHouse HTTP {e.code}: {body}") from e


def main() -> int:
    load_env_file(ROOT / ".env")
    parser = argparse.ArgumentParser(description="Check Campaign wt_* attribution in ClickHouse")
    parser.add_argument("--website-id", type=int, default=0, help="Filter by website_id (0 = all)")
    parser.add_argument("--days", type=int, default=30, help="Lookback days")
    args = parser.parse_args()

    website_filter = f"AND website_id = {args.website_id}" if args.website_id else ""

    print("=== dim_sessions columns (wt_* ) ===")
    cols = ch_query(
        "SELECT name, type FROM system.columns "
        "WHERE database = currentDatabase() AND table = 'dim_sessions' "
        "AND name IN ('utm_source','utm_medium','utm_campaign','wt_organization_id','wt_campaign_id','wt_contact_id') "
        "ORDER BY name FORMAT TabSeparated"
    )
    print(cols.strip() or "(no matching columns — apply clickhouse/ddl/10_session_campaign_attribution.sql on live)")

    print("\n=== Campaign-attributed sessions (last {} days) ===".format(args.days))
    rows = ch_query(
        f"""
        SELECT
          session_start,
          website_id,
          session_id,
          utm_source,
          utm_medium,
          utm_campaign,
          wt_organization_id,
          wt_campaign_id,
          wt_contact_id
        FROM dim_sessions
        WHERE session_start >= now() - INTERVAL {args.days} DAY
          AND (
            wt_campaign_id IS NOT NULL
            OR utm_source = 'worktual_campaign'
          )
          {website_filter}
        ORDER BY session_start DESC
        LIMIT 25
        FORMAT TabSeparatedWithNames
        """
    )
    print(rows.strip() or "(no rows yet — deploy SDK with webTrackingHmacSecret and click a Campaign track link)")

    print("\n=== Counts ===")
    counts = ch_query(
        f"""
        SELECT
          countIf(utm_source = 'worktual_campaign') AS utm_worktual_campaign,
          countIf(wt_campaign_id IS NOT NULL) AS with_wt_campaign_id,
          countIf(wt_contact_id IS NOT NULL) AS with_wt_contact_id
        FROM dim_sessions
        WHERE session_start >= now() - INTERVAL {args.days} DAY
          {website_filter}
        FORMAT TabSeparatedWithNames
        """
    )
    print(counts.strip())
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
