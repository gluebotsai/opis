#!/usr/bin/env python3
"""Diagnose why a replay session shows Image/Incomplete instead of Video."""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import sys
from collections import Counter
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

TYPE_NAMES = {2: "FullSnapshot", 3: "Incremental", 4: "Meta"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnose replay session capture quality")
    parser.add_argument("session_id", nargs="?", help="session_id (default: latest for website 1001)")
    args = parser.parse_args()

    client = get_client()
    db = "web_tracking"
    sid = args.session_id
    if not sid:
        row = client.query(
            f"""
            SELECT session_id FROM {db}.fact_replay_chunks
            WHERE website_id = 1001
            ORDER BY created_at DESC LIMIT 1
            """
        ).result_rows
        if not row:
            print("No replay sessions found.")
            return 1
        sid = row[0][0]

    chunks = client.query(
        f"""
        SELECT chunk_index, event_count, events_data, encoding, created_at
        FROM {db}.fact_replay_chunks
        WHERE session_id = {{sid:String}}
        ORDER BY chunk_index
        """,
        parameters={"sid": sid},
    ).result_rows

    print(f"Session: {sid}")
    print(f"Chunks in ClickHouse: {len(chunks)}")
    if not chunks:
        print("\nROOT CAUSE: No replay chunks stored.")
        print("  → Ingest not receiving replay_chunk_v1, or wrong endpoint (QA Kafka).")
        return 1

    indices = [int(c[0]) for c in chunks]
    print(f"Chunk indices: {indices}")
    if indices[0] > 0:
        print(f"\nROOT CAUSE: Missing chunk 0 (DOM snapshot). First stored chunk is {indices[0]}.")
        print("  → Earlier chunks failed POST or went to QA Kafka ingest (not ClickHouse).")
        print("  → SDK bug (fixed): failed POSTs incremented chunkIndex and dropped events.")

    if max(indices) - min(indices) + 1 > len(chunks):
        print(f"\nROOT CAUSE: Chunk gaps ({min(indices)}..{max(indices)} but only {len(chunks)} stored).")
        print("  → Some chunks lost in transit.")

    all_events = []
    for idx, ec, data, enc, _at in chunks:
        raw = gzip.decompress(base64.b64decode(data))
        evs = json.loads(raw)
        types = Counter(e.get("type") for e in evs)
        print(f"  chunk {idx}: {ec} events — { {TYPE_NAMES.get(k, k): v for k, v in types.items()} }")
        all_events.extend(evs)

    types = Counter(e.get("type") for e in all_events)
    has_snap = types.get(2, 0) > 0
    inc = types.get(3, 0)
    ts = [e.get("timestamp", 0) for e in all_events if e.get("timestamp")]
    span = (max(ts) - min(ts)) / 1000 if ts else 0

    print(f"\nTotals: Meta={types.get(4,0)} Snapshot={types.get(2,0)} Incremental={inc} span={span:.1f}s")

    if not has_snap:
        print("\nVERDICT: IMAGE ONLY — no FullSnapshot in ClickHouse. Playback cannot work.")
    elif inc < 5:
        print(f"\nVERDICT: MOSTLY STATIC — only {inc} interaction events. Looks like a screenshot, not video.")
    else:
        print(f"\nVERDICT: VIDEO REPLAY OK — {inc} interaction events with DOM snapshot.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
