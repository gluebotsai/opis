---
name: analytics-export
description: Same analytics job with output export. Still read-only SQL.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.export"
  schema-ref: "analytics.export"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: execute_frame return_to_domain
---

# Purpose

Return the same analytics result shaped for export.

# When to use

The Domain frame has output export, or the user asked to download / export the report.

# Procedure

1. Keep the Domain frame. Set output to export.
2. Call `execute_frame`.
3. Do not invent a file. Use the tool result.
