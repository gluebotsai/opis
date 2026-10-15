#!/usr/bin/env python3
"""Live test script for CCaaS Knowledge Graph Agent against Neo4j org1012 and Meilisearch kg_ccaas."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.tools import execute_cypher, search_business_concepts, apply_product_scope


def test_scope_guard():
    print("--- 1. Testing Product Scope Guard ---")
    q = "MATCH (c:Conversation)-[:ROUTED_TO]->(q:ContactCentreQueue) RETURN count(c)"
    ok, scoped = apply_product_scope(q)
    print("Original:", q)
    print("Scoped  :", scoped)
    assert "!Marketing&!Sales&!Support&!WebTracking" in scoped
    print(" Scope guard correctly applied negation labels.\n")


def test_meilisearch():
    print("--- 2. Testing Meilisearch Concept Retrieval ---")
    queries = [
        "average handle time by channel",
        "why did missed calls increase",
        "agent workload and concurrency",
        "disconnect reasons",
    ]
    for q in queries:
        res = search_business_concepts(q, limit=2)
        hits = res.get("hits", [])
        print(f"Query: '{q}' -> Hits: {len(hits)}")
        for h in hits:
            print(f"  [{h.get('type')}] {h.get('name')}")
    print(" Meilisearch search working.\n")


def test_neo4j_ccaas_queries():
    print("--- 3. Testing Real CCaaS Cypher Queries on org1012 ---")
    test_cases = [
        (
            "AHT by Channel",
            """
            MATCH (c:Conversation)
            WHERE c.created_at IS NOT NULL AND c.ended_at IS NOT NULL
            RETURN c.channel AS channel, 
                   count(c) AS count,
                   round(avg(duration.between(c.created_at, c.ended_at).seconds), 1) AS aht_sec
            ORDER BY count DESC
            """
        ),
        (
            "Disconnect Trinity (End Actor & Reason)",
            """
            MATCH (c:Conversation)
            WHERE c.end_actor IS NOT NULL
            RETURN c.end_actor AS actor, c.end_reason AS reason, count(c) AS count
            ORDER BY count DESC LIMIT 5
            """
        ),
        (
            "Agent Workload",
            """
            MATCH (c:Conversation)-[:HANDLED_BY]->(a:ContactCentreAgent)
            RETURN a.display_name AS agent, count(c) AS handled
            ORDER BY handled DESC
            """
        ),
        (
            "Queue Routing Volume",
            """
            MATCH (c:Conversation)-[:ROUTED_TO]->(q:ContactCentreQueue)
            RETURN q.name AS queue, count(c) AS routed_count
            ORDER BY routed_count DESC
            """
        ),
        (
            "Missed Contacts Breakdown",
            """
            MATCH (m:MissedContact)
            RETURN m.reason AS reason, count(m) AS count
            ORDER BY count DESC
            """
        ),
        (
            "Bot Failure Telemetry",
            """
            MATCH (c:Conversation)
            WHERE any(f IN c.facts WHERE f IN ['no_ready_agents', 'live_agent_unavailable'])
            RETURN count(c) AS total_failures
            """
        ),
        (
            "Business Hours & Shifts",
            """
            MATCH (b:BusinessHours)-[:HAS]->(s:Shift)
            RETURN b.name AS hours, b.timezone AS tz, count(s) AS shifts
            """
        ),
    ]

    for name, cypher in test_cases:
        res = execute_cypher(cypher, params={}, db_name="org1012")
        if res.get("error"):
            print(f"❌ {name}: ERROR -> {res['error']}")
        else:
            data = res.get("data", [])
            print(f" {name}: SUCCESS ({len(data)} records returned)")
            for r in data[:2]:
                print(f"    {r}")
    print("\nAll live queries completed.")


def main():
    test_scope_guard()
    test_meilisearch()
    test_neo4j_ccaas_queries()


if __name__ == "__main__":
    main()
