---
name: analytics-count-breakdown
description: Grouped counts, rankings, and trends on the operational catalog.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.count.breakdown"
  schema-ref: "analytics.count.breakdown"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: execute_frame return_to_domain
---

# Purpose

Breakdown, ranking, and trend questions that the Domain sent as catalog frames.

# When to use

Shape is breakdown, ranking, or trend.

# Procedure

1. Run `execute_frame` with the Domain frame.
2. Group only on dimensions the catalog marks groupable.
3. One compile repair if needed.
4. Echo scope and UTC window in the answer.
