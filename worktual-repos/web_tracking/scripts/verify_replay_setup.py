#!/usr/bin/env python3
"""Verify rrweb session replay pipeline: ClickHouse table + recent chunks."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv(ROOT / ".env")

from shared.clickhouse import get_client


def main() -> int:
    client = get_client()
    db = os.environ.get("CLICKHOUSE_DATABASE", "web_tracking")

    tables = client.query(
        f"""
        SELECT name
        FROM system.tables
        WHERE database = {{db:String}} AND name IN ('fact_replay_chunks', 'mv_fact_replay_chunks')
        ORDER BY name
        """,
        parameters={"db": db},
    ).result_rows

    print(f"Database: {db}")
    print("Replay tables/views:")
    if not tables:
        print("  MISSING — run: python scripts/apply_clickhouse_ddl.py")
        return 1
    for (name,) in tables:
        print(f"  ✓ {name}")

    stats = client.query(
        f"""
        SELECT
            count() AS chunks,
            uniqExact(session_id) AS sessions,
            max(created_at) AS latest
        FROM {db}.fact_replay_chunks
        """
    ).first_item

    print("\nReplay data (fact_replay_chunks):")
    print(f"  chunks:   {stats.get('chunks', 0)}")
    print(f"  sessions: {stats.get('sessions', 0)}")
    print(f"  latest:   {stats.get('latest')}")

    recent = client.query(
        f"""
        SELECT session_id, count() AS chunks, sum(event_count) AS events, max(created_at) AS last_at
        FROM {db}.fact_replay_chunks
        GROUP BY session_id
        ORDER BY last_at DESC
        LIMIT 5
        """
    ).result_rows

    if recent:
        print("\nRecent sessions with replay:")
        for session_id, chunks, events, last_at in recent:
            gap = client.query(
                f"""
                SELECT min(chunk_index) AS mn, max(chunk_index) AS mx, count() AS c
                FROM {db}.fact_replay_chunks WHERE session_id = {{sid:String}}
                """,
                parameters={"sid": session_id},
            ).first_item
            mn = int(gap.get("mn") or 0)
            mx = int(gap.get("mx") or 0)
            c = int(gap.get("c") or 0)
            has_gaps = (mx - mn + 1) > c
            kind = "VIDEO" if events >= 10 and not has_gaps and mn == 0 else "IMAGE"
            print(f"  [{kind:5}] {session_id[:20]}…  chunks={chunks}  events={events}  at={last_at}")
        print("\nVIDEO = motion replay ready. IMAGE = static screenshot only.")
        print("Seed a test video session: python scripts/seed_video_replay_session.py")
    else:
        print("\nNo replay chunks yet.")
        print("  1. python run_backend.py --all")
        print("  2. python demo/serve.py")
        print("  3. Browse http://localhost:7870/ for ~10s, then re-run this script")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
