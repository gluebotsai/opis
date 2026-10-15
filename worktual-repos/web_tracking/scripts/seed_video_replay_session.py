#!/usr/bin/env python3
"""Clone a known-good replay session into ClickHouse via local ingest (video replay test).

Usage:
  python scripts/seed_video_replay_session.py
  python scripts/seed_video_replay_session.py --source session_7ecqa29ulmth2tyab
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv(ROOT / ".env")

import urllib.request

from shared.clickhouse import get_client

DEFAULT_SOURCE = "session_7ecqa29ulmth2tyab"
WEBSITE_ID = 1001
WEBSITE_URL = "https://beta.worktual.co.uk/"
ORG_ID = 1003


def ingest_url() -> str:
    port = os.environ.get("INGEST_PORT", "7860")
    return f"http://127.0.0.1:{port}/v1/tracking/nfs-ingestions"


def post_chunk(body: dict) -> None:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        ingest_url(),
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
        if resp.status != 200:
            raise RuntimeError(f"ingest HTTP {resp.status}: {payload}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a video-ready replay session")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="Source session_id in ClickHouse")
    args = parser.parse_args()

    client = get_client()
    db = os.environ.get("CLICKHOUSE_DATABASE", "web_tracking")

    rows = client.query(
        f"""
        SELECT chunk_index, chunk_id, encoding, events_data, event_count, page_view_id, visitor_id
        FROM {db}.fact_replay_chunks
        WHERE session_id = {{sid:String}} AND website_id = {{wid:UInt32}}
        ORDER BY chunk_index ASC
        """,
        parameters={"sid": args.source, "wid": WEBSITE_ID},
    ).named_results()

    chunks = list(rows)
    if not chunks:
        print(f"No chunks found for source session {args.source!r}")
        return 1

    new_session = f"session_{uuid.uuid4().hex[:16]}"
    new_visitor = f"visitor_{uuid.uuid4()}"
    new_page = f"pg_{uuid.uuid4().hex[:12]}"

    print(f"Ingest URL: {ingest_url()}")
    print(f"Cloning {len(chunks)} chunk(s) from {args.source}")
    print(f"New session: {new_session}")

    for row in chunks:
        body = {
            "type": "replay_chunk_v1",
            "websiteId": WEBSITE_ID,
            "websiteUrl": WEBSITE_URL,
            "organizationId": ORG_ID,
            "visitorId": new_visitor,
            "sessionId": new_session,
            "pageViewId": new_page,
            "chunkIndex": int(row["chunk_index"]),
            "chunkId": str(uuid.uuid4()),
            "encoding": row["encoding"] or "gzip_b64",
            "eventsData": row["events_data"],
            "eventCount": int(row["event_count"]),
            "source": "rrweb",
            "payloadId": str(uuid.uuid4()),
        }
        post_chunk(body)
        print(f"  ✓ chunk {row['chunk_index']} ({row['event_count']} events)")

    stats = client.query(
        f"""
        SELECT count() AS chunks, sum(event_count) AS events
        FROM {db}.fact_replay_chunks
        WHERE session_id = {{sid:String}}
        """,
        parameters={"sid": new_session},
    ).first_item

    print("\nSeeded video replay session:")
    print(f"  session_id: {new_session}")
    print(f"  chunks:     {stats.get('chunks')}")
    print(f"  events:     {stats.get('events')}")
    print("\nDashboard → Session replay → look for status 'Video' → Watch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
