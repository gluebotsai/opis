#!/usr/bin/env python3
"""Step 8 benchmark — 5 queries via FastAPI /chat with organization_id=1000."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
ORG_ID = "1000"

BENCHMARK_QUERIES = [
    "why did missed contact increase in the past week?",
    "which queue has the most missed contacts this week?",
    "what is the abandonment rate compared to last week?",
    "how many conversations were handled today?",
    "why did missed contact increase in past days?",
]


def run_chat(query: str, session_id: str) -> dict:
    payload = json.dumps(
        {
            "sessionID": session_id,
            "query": query,
            "organization_id": ORG_ID,
        }
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    wall_start = time.time()
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode())
    wall = round(time.time() - wall_start, 2)
    answer = (data.get("answer") or "").strip()
    return {
        "query": query,
        "wall_seconds": wall,
        "server_seconds": data.get("elapsed_seconds"),
        "answer_preview": answer[:280] + ("…" if len(answer) > 280 else ""),
        "answer_len": len(answer),
        "error": data.get("error"),
        "uses_org1000": "org1000" in answer or "org1000" in json.dumps(data),
        "uses_wrong_org": "org_001" in answer,
        "empty_answer": not answer,
    }


def main():
    try:
        urllib.request.urlopen(f"{BASE}/health", timeout=5)
    except Exception as e:
        print(f"ERROR: server not reachable at {BASE}/health — {e}")
        print("Start with: cd fastapi_service && uvicorn main:app --host 127.0.0.1 --port 8000")
        return 1

    print("=" * 80)
    print(f"Step 8 Benchmark — organization_id={ORG_ID} → Neo4j db org1000")
    print("=" * 80)

    results = []
    for i, query in enumerate(BENCHMARK_QUERIES, 1):
        sid = f"bench-{ORG_ID}-{i}"
        print(f"\n[{i}/5] {query}")
        try:
            r = run_chat(query, sid)
            results.append(r)
            ok_time = r["wall_seconds"] <= 30
            ok_org = not r["uses_wrong_org"]
            status = "PASS" if ok_time and ok_org and not r["empty_answer"] else "WARN"
            if r["error"]:
                status = "FAIL"
            print(f"  Status:   {status}")
            print(f"  Time:     {r['wall_seconds']}s (server: {r['server_seconds']}s) {'✓ <30s' if ok_time else '✗ >30s'}")
            print(f"  Org:      {'✓ mentions org1000' if r['uses_org1000'] else '— no org1000 in answer'} | {'✗ org_001 leak' if r['uses_wrong_org'] else '✓ no org_001'}")
            if r["error"]:
                print(f"  Error:    {r['error']}")
            print(f"  Answer:   {r['answer_preview']}")
        except Exception as e:
            print(f"  FAIL: {e}")
            results.append({"query": query, "error": str(e), "wall_seconds": None})

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    timed = [r for r in results if r.get("wall_seconds") is not None]
    if timed:
        times = [r["wall_seconds"] for r in timed]
        under_30 = sum(1 for t in times if t <= 30)
        print(f"  Queries run:     {len(timed)}/5")
        print(f"  Under 30s:       {under_30}/{len(timed)}")
        print(f"  Avg time:        {round(sum(times)/len(times), 2)}s")
        print(f"  Max time:        {max(times)}s")
        print(f"  Wrong org_001:   {sum(1 for r in timed if r.get('uses_wrong_org'))} queries")
        print(f"  Empty answers:   {sum(1 for r in timed if r.get('empty_answer'))} queries")
        all_pass = under_30 == len(timed) and not any(r.get("uses_wrong_org") for r in timed)
        print(f"\n  Overall:         {'PASS' if all_pass else 'NEEDS ATTENTION'}")
    print("=" * 80)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
