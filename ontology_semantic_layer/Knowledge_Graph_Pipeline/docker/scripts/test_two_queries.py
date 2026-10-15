#!/usr/bin/env python3
"""Run 2 test queries and print full results for validation."""

from __future__ import annotations

import json
import time
import urllib.request

BASE = "http://127.0.0.1:8000"
ORG = "1000"

QUERIES = [
    ("q1-missed-week", "why did missed contact increase this week?"),
    ("q2-queue-missed", "which queue has the most missed contacts this week?"),
]


def run_chat(session_id: str, query: str) -> dict:
    payload = json.dumps(
        {"sessionID": session_id, "query": query, "organization_id": ORG}
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode())
    data["_wall_seconds"] = round(time.time() - t0, 2)
    return data


def main():
    for sid, query in QUERIES:
        print("=" * 80)
        print(f"Query: {query}")
        print("=" * 80)
        try:
            r = run_chat(sid, query)
            print(f"Time: {r.get('_wall_seconds')}s (server: {r.get('elapsed_seconds')}s)")
            print(f"Error: {r.get('error')}")
            print("\nAnswer:\n")
            print(r.get("answer") or "(empty)")
        except Exception as e:
            print(f"FAILED: {e}")
        print()


if __name__ == "__main__":
    main()
