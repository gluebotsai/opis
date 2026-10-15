---
name: analytics-report-list
description: List or find operational rows as a report. Not for acting on a ticket.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.report.list"
  schema-ref: "analytics.report.list"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: execute_frame return_to_domain
---

# Purpose

List or find rows (tickets, notes, articles) as a report through `sql_analytics_executor`.

# When to use

The Domain frame shape is list or find. Path is catalog.

# Procedure

1. Run the Domain frame with `execute_frame`.
2. One repair if the job fails to compile.
3. If a name did not resolve, say no match was found. Do not say zero rows.
4. If the query ran and there are no rows, say zero and repeat what was searched.
