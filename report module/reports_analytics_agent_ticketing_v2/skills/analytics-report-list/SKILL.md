---
name: analytics-report-list
description: List or find operational rows as a report using run_sql against virtual rpt.* views.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "2.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.report.list"
  schema-ref: "analytics.report.list"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_kpi run_sql return_to_domain
---


# Purpose

List or find rows (tickets, notes, articles, agents) as a report through `sql_analytics_executor` querying `rpt.*` views.

# When to use

The Domain task answer_type is `list`.

# Procedure

1. Write a read-only SELECT against `rpt.*` views and call `run_sql`.
2. One repair if the query is rejected by `sql_guard`.
3. If the query ran and there are no rows, report zero matching records for that scope.
