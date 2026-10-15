#!/usr/bin/env python3
"""Ground-truth counts from Neo4j org1000 for validation."""

import json
from datetime import date, timedelta

from neo4j import GraphDatabase

URI = "neo4j://10.180.0.126:7687"
USER = "neo4j"
PASSWORD = "Neo4j@789"
DB = "org1000"

today = date(2026, 8, 24)  # matches agent context date
week_start = today - timedelta(days=today.weekday())  # Mon Aug 18
week_end = today + timedelta(days=1)

QUERIES = {
    "routing_attempt_total": """
        MATCH (ra:RoutingAttempt) RETURN count(ra) AS n
    """,
    "missed_this_week": """
        MATCH (c:Conversation)-[:HAS_ROUTING_ATTEMPT]->(ra:RoutingAttempt)
        WHERE ra.outcome IN ['rejected', 'expired', 'no_agent']
          AND ra.created_at >= datetime($week_start)
          AND ra.created_at < datetime($week_end)
        RETURN count(ra) AS missed_count
    """,
    "missed_by_queue_this_week": """
        MATCH (c:Conversation)-[:HAS_ROUTING_ATTEMPT]->(ra:RoutingAttempt)-[:TARGETED_QUEUE]->(q:Queue)
        WHERE ra.outcome IN ['rejected', 'expired', 'no_agent']
          AND ra.created_at >= datetime($week_start)
          AND ra.created_at < datetime($week_end)
        RETURN q.name AS queue, count(ra) AS missed
        ORDER BY missed DESC LIMIT 5
    """,
    "distinct_outcomes": """
        MATCH (ra:RoutingAttempt) RETURN DISTINCT ra.outcome AS outcome LIMIT 20
    """,
    "date_range": """
        MATCH (ra:RoutingAttempt)
        RETURN min(ra.created_at) AS earliest, max(ra.created_at) AS latest
    """,
}

params = {
    "week_start": f"{week_start.isoformat()}T00:00:00",
    "week_end": f"{week_end.isoformat()}T00:00:00",
}

driver = GraphDatabase.driver(URI, auth=(USER, PASSWORD))
print(f"Database: {DB}")
print(f"Week: {week_start} to {week_end}")
print("=" * 60)

with driver.session(database=DB) as session:
    for name, cypher in QUERIES.items():
        try:
            rows = [dict(r) for r in session.run(cypher, params)]
            print(f"\n{name}:")
            print(json.dumps(rows, indent=2, default=str))
        except Exception as e:
            print(f"\n{name}: ERROR {e}")

driver.close()
