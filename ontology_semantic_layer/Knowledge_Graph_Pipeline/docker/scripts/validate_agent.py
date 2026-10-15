#!/usr/bin/env python3
"""Test 2 agent queries and validate against Neo4j ground truth."""

from __future__ import annotations

import json
import re
import time
import urllib.request
from neo4j import GraphDatabase

from src.tools import compute_period_params

BASE = "http://127.0.0.1:8000"
ORG = "1000"
DB = "org1000"
NEO4J_URI = "neo4j://10.180.0.126:7687"
NEO4J_AUTH = ("neo4j", "Neo4j@789")
REF_DATE = "2026-08-24"

QUERIES = [
    ("valid-test-1", "why did missed contact increase this week?"),
    ("valid-test-2", "which queue has the most missed contacts this week?"),
]


def ground_truth(periods: dict) -> dict:
    driver = GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)
    diag = """
    MATCH (c:Conversation)-[:HAS_ROUTING_ATTEMPT]->(ra:RoutingAttempt)-[:TARGETED_QUEUE]->(q:Queue)
    WHERE ra.outcome IN ['no_ready_agents','no_shift_coverage']
    WITH q.name AS dimension,
      sum(CASE WHEN ra.created_at >= datetime($period_start) AND ra.created_at < datetime($period_end) THEN 1 ELSE 0 END) AS current,
      sum(CASE WHEN ra.created_at >= datetime($compare_start) AND ra.created_at < datetime($compare_end) THEN 1 ELSE 0 END) AS previous
    RETURN dimension, current, previous, current - previous AS delta
    ORDER BY current DESC, abs(delta) DESC LIMIT 5
    """
    totals = """
    MATCH (ra:RoutingAttempt)
    WHERE ra.outcome IN ['no_ready_agents','no_shift_coverage']
    RETURN
      sum(CASE WHEN ra.created_at >= datetime($period_start) AND ra.created_at < datetime($period_end) THEN 1 ELSE 0 END) AS current_total,
      sum(CASE WHEN ra.created_at >= datetime($compare_start) AND ra.created_at < datetime($compare_end) THEN 1 ELSE 0 END) AS previous_total
    """
    with driver.session(database=DB) as s:
        by_queue = [dict(r) for r in s.run(diag, periods)]
        tot = dict(s.run(totals, periods).single())
    driver.close()
    top_queue = by_queue[0] if by_queue else None
    return {
        "periods": periods,
        "current_total": tot["current_total"],
        "previous_total": tot["previous_total"],
        "delta_total": tot["current_total"] - tot["previous_total"],
        "by_queue": by_queue,
        "top_queue": top_queue,
    }


def run_agent(session_id: str, query: str) -> dict:
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
    data["_wall"] = round(time.time() - t0, 2)
    return data


def extract_numbers(text: str) -> list[int]:
    return [int(x) for x in re.findall(r"\b(\d+)\b", text)]


def validate_q1(answer: str, gt: dict) -> tuple[bool, str]:
    nums = extract_numbers(answer)
    cur, prev = gt["current_total"], gt["previous_total"]
    mentions_support = "support" in answer.lower()
    has_cur = cur in nums
    has_prev = prev in nums

    if cur > prev:
        direction_ok = any(w in answer.lower() for w in ("increase", "rose", "up", "higher", "more"))
    elif cur < prev:
        direction_ok = any(w in answer.lower() for w in ("decrease", "drop", "down", "lower", "not increase", "did not increase"))
    else:
        direction_ok = True

    valid = direction_ok and (has_cur or has_prev or cur == 0)
    notes = []
    if not direction_ok:
        notes.append(f"direction wrong (current={cur}, previous={prev})")
    if not (has_cur or has_prev) and (cur or prev):
        notes.append(f"expected numbers {cur}/{prev} in answer")
    if gt["top_queue"] and not mentions_support and gt["top_queue"]["previous"] > 0:
        notes.append("expected support queue mentioned")
    return valid, "; ".join(notes) if notes else "matches ground truth"


def validate_q2(answer: str, gt: dict) -> tuple[bool, str]:
    top = gt["top_queue"]
    if not top or top["current"] == 0:
        # current week may be empty on Monday — valid if agent says no/zero or names support with context
        if top and top["previous"] > 0:
            ok = "support" in answer.lower() and any(
                w in answer.lower() for w in ("0", "no", "none", "incomplete", "just started")
            )
            return ok, "current week empty — support had data last week only" if ok else "should mention support + current week empty"
        return True, "no missed contacts this week in data"

    queue_name = top["dimension"].lower()
    count = top["current"]
    name_ok = queue_name in answer.lower()
    count_ok = count in extract_numbers(answer)
    valid = name_ok and count_ok
    return valid, f"expected {top['dimension']} with {count} missed" if not valid else "matches ground truth"


def main():
    periods = compute_period_params(REF_DATE)
    gt = ground_truth(periods)

    print("=" * 72)
    print("GROUND TRUTH (Neo4j org1000)")
    print("=" * 72)
    print(f"Periods: current {periods['period_start']} → {periods['period_end']}")
    print(f"         previous {periods['compare_start']} → {periods['compare_end']}")
    print(f"Missed totals: current={gt['current_total']}, previous={gt['previous_total']}, delta={gt['delta_total']}")
    print(f"By queue: {json.dumps(gt['by_queue'], indent=2)}")
    print()

    results = []
    for sid, query in QUERIES:
        print("=" * 72)
        print(f"AGENT Q: {query}")
        print("=" * 72)
        r = run_agent(sid, query)
        answer = r.get("answer") or ""
        print(f"Time: {r.get('_wall')}s")
        print(f"\nAnswer:\n{answer}\n")

        if "increase this week" in query:
            valid, note = validate_q1(answer, gt)
        else:
            valid, note = validate_q2(answer, gt)

        status = "VALID" if valid else "INVALID"
        print(f"Validation: {status} — {note}")
        results.append((query, valid, note, r.get("_wall")))

    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    for q, valid, note, wall in results:
        print(f"  [{'PASS' if valid else 'FAIL'}] ({wall}s) {q[:50]}...")
        print(f"         {note}")


if __name__ == "__main__":
    main()
