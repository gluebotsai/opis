---
name: analytics-graph-path
description: Why, journey, and disconnect paths on the Contact Center graph via run_cypher.
license: Proprietary
compatibility: Contact Center Three-Layer Harness MAS
metadata:
  version: "2.1.0"
  domain: "reports_analytics_domain"
  executors: "kg_analytics_executor"
  task-ids: "analytics.graph.path"
  schema-ref: "analytics.graph.path"
  approval-policy: "none"
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_cypher return_to_domain
---

# Purpose

Graph paths for why / root cause / journey only.

# When to use

`task.executor` is `kg`.

# Procedure

1. Prefer a certified why template in `task.goal` when it matches: `unresolved_conversations_root_cause`, `abandonment_and_disconnect_analysis`, `channel_comparison_root_cause`, `transfer_loops_and_chained_sessions`, `bot_escalation_and_missed_contacts`, `customer_contact_journey`.
2. Otherwise read-only Cypher from the schema registry. `LIMIT` 20–50.
3. Durations in minutes. Channel value is `call` not `voice`.
4. One repair on `cypher_guard` reject.

# Validation requirements

- Do not answer how-many / average volume / AHT / wait / resolution totals on the graph.
- No `organization_id` property filter.
- No writes.
