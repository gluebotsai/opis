---
name: analytics-count-breakdown
description: Grouped counts, rankings, and breakdowns using run_sql against virtual rpt.* views.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "2.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.count.breakdown"
  schema-ref: "analytics.count.breakdown"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_kpi run_sql return_to_domain
---

# Purpose

Grouped breakdowns and ranking reports through `sql_analytics_executor` querying `rpt.*` views.

# When to use

The Domain task answer_type is `breakdown` or `ranking`.

# Procedure

1. Write a read-only grouped SQL query against `rpt.*` views and call `run_sql`.
2. Apply `LIMIT` for rankings (e.g. `LIMIT 10`) or breakdowns (e.g. `LIMIT 20`).
3. One repair if rejected by `sql_guard`.
