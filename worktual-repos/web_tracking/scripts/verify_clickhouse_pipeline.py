#!/usr/bin/env python3
"""End-to-end ClickHouse migration smoke test."""

from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from shared.clickhouse import get_client

DOMAIN_ID = 12345
VISITOR_ID = "visitor_smoke_test"
SESSION_ID = "session_smoke_test"


def main() -> int:
    client = get_client()
    payload_id = str(uuid.uuid4())
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    body = {
        "type": "events_v3",
        "websiteId": DOMAIN_ID,
        "websiteUrl": "beta.worktual.co.uk",
        "visitorId": VISITOR_ID,
        "sessionId": SESSION_ID,
        "sdkVersion": "3.0.0",
        "events": [
            {
                "eventId": str(uuid.uuid4()),
                "name": "page_view",
                "ts": now_ms,
                "pid": "pv_smoke_1",
                "props": {"path": "/", "title": "Home"},
            },
            {
                "eventId": str(uuid.uuid4()),
                "name": "click",
                "ts": now_ms + 100,
                "pid": "pv_smoke_1",
                "props": {"x": 100, "y": 200, "viewportW": 1920, "viewportH": 1080},
            },
        ],
    }
    client.insert(
        "raw_payloads",
        [[
            payload_id,
            DOMAIN_ID,
            "beta.worktual.co.uk",
            VISITOR_ID,
            "events_v3",
            "127.0.0.1",
            "smoke-test",
            datetime.now(timezone.utc),
            json.dumps(body),
            "accepted",
            None,
            0,
            "",
            datetime.now(timezone.utc),
        ]],
        column_names=[
            "payload_id", "website_id", "website_url", "visitor_id", "payload_type",
            "source_ip", "user_agent", "received_at", "payload", "processing_status",
            "ingested_at",
        ],
    )
    print(f"Inserted raw payload {payload_id}")

    for table in ("events_staging", "fact_page_views", "fact_interaction_events", "dim_visitors", "dim_sessions"):
        cnt = client.query(f"SELECT count() FROM {table} WHERE website_id = {{d:UInt32}}", parameters={"d": DOMAIN_ID}).result_rows[0][0]
        print(f"  {table}: {cnt} rows")

    admin = client.query(
        """
        SELECT
            dictHas('web_tracking.dict_admin_accounts', toUInt64({d:UInt32})) AS found,
            dictGet('web_tracking.dict_admin_accounts', 'website_url', toUInt64({d:UInt32})) AS website_url
        """,
        parameters={"d": DOMAIN_ID},
    ).result_rows
    if admin and admin[0][0]:
        print(f"  dict_admin_accounts: website_url={admin[0][1]}")
    else:
        print("  dict_admin_accounts: MISSING (create dictionary + Postgres view first)")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
