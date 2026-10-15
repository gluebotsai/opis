#!/usr/bin/env python3
"""Test /chat/stream SSE endpoint — prints progress, timing, and final answer."""

from __future__ import annotations

import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8000"
QUERY = "why did the missed contact incresse in the past week"


def parse_sse_stream(body: str):
    events = []
    buffer = body
    while "\n\n" in buffer:
        frame, buffer = buffer.split("\n\n", 1)
        event = "message"
        data_lines = []
        for line in frame.splitlines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
        if data_lines:
            try:
                data = json.loads("\n".join(data_lines))
            except json.JSONDecodeError:
                data = {"raw": "\n".join(data_lines)}
            events.append({"event": event, "data": data})
    return events


def stream_chat(query: str, session_id: str = "test-sse-1", org_id: str = "1000"):
    payload = json.dumps(
        {"sessionID": session_id, "query": query, "organization_id": org_id}
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/chat/stream",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.time()
    answer_parts = []
    statuses = []
    blocks = []
    activities = []
    elapsed_reported = None

    with urllib.request.urlopen(req, timeout=300) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    events = parse_sse_stream(raw)
    for ev in events:
        name = ev["event"]
        data = ev["data"]
        if name == "status":
            statuses.append(f"[{data.get('phase')}] {data.get('label')}")
        elif name == "activity":
            activities.append(
                f"  {data.get('step_id')} ({data.get('status')}): {data.get('title')}"
            )
        elif name == "block":
            blocks.append(
                f"  {data.get('tool')} → {data.get('status')}: {data.get('summary') or data.get('label')}"
            )
        elif name == "text_delta":
            answer_parts.append(data.get("delta") or data.get("content") or "")
        elif name == "done":
            elapsed_reported = data.get("elapsed_seconds")

    wall = round(time.time() - start, 2)
    return {
        "wall_seconds": wall,
        "elapsed_reported": elapsed_reported,
        "answer": "".join(answer_parts),
        "statuses": statuses,
        "activities": activities,
        "blocks": blocks,
        "event_count": len(events),
    }


def sync_chat(query: str, session_id: str = "test-sync-1", org_id: str = "1000"):
    payload = json.dumps(
        {"sessionID": session_id, "query": query, "organization_id": org_id}
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.time()
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode())
    wall = round(time.time() - start, 2)
    return {"wall_seconds": wall, **data}


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else QUERY
    print("=" * 72)
    print(f"Query: {query}")
    print("=" * 72)

    # Health check
    try:
        urllib.request.urlopen(f"{BASE}/health", timeout=5)
    except Exception as e:
        print(f"ERROR: Server not reachable at {BASE}/health — {e}")
        print("\nStart the server first:")
        print("  cd fastapi_service && bash start.sh")
        sys.exit(1)

    print("\n--- SSE stream (/chat/stream) ---\n")
    try:
        result = stream_chat(query)
    except Exception as e:
        print(f"Stream failed: {e}")
        sys.exit(1)

    print("Progress (status events):")
    for s in result["statuses"]:
        print(f"  • {s}")

    if result["activities"]:
        print("\nActivity steps:")
        for a in result["activities"]:
            print(a)

    if result["blocks"]:
        print("\nTool blocks:")
        for b in result["blocks"]:
            print(b)

    print(f"\nTiming:")
    print(f"  Wall clock:     {result['wall_seconds']}s")
    print(f"  Server elapsed: {result['elapsed_reported']}s")
    print(f"  SSE events:     {result['event_count']}")

    print("\n--- Answer ---\n")
    print(result["answer"] or "(empty)")
    print("\n" + "=" * 72)


if __name__ == "__main__":
    main()
