---
name: analytics-threshold-check
description: Compare a certified KPI to configured thresholds. Threshold math is in code, not in the model.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.threshold.check"
  schema-ref: "analytics.threshold.check"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: execute_frame return_to_domain
---

# Purpose

Run a certified KPI with `check_thresholds` on the frame. Python compares to threshold files.

# When to use

The user asks if a metric is warning or critical, or over a target.

# Procedure

1. Set frame.check_thresholds true. Keep the same measure.
2. Call `execute_frame`.
3. Report the value and the threshold result from the tool, not from mental arithmetic.
