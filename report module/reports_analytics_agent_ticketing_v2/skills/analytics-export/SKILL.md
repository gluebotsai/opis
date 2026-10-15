---
name: analytics-export
description: Output formatting for reporting exports using run_sql or run_kpi.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "2.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.export"
  schema-ref: "analytics.export"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_kpi run_sql return_to_domain
---

# Purpose

Execute an analytics job via `run_sql` or `run_kpi` and format rows for export.

# When to use

The user specifically asks to export, download, or dump report records.

# Procedure

1. Run the query via `run_sql` or `run_kpi`.
2. Format the tabular result for download/export.
