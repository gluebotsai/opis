---
name: analytics-threshold-check
description: Compare a certified KPI value to configured tenant thresholds.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "2.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.threshold.check"
  schema-ref: "analytics.threshold.check"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_kpi run_sql return_to_domain
---

# Purpose

Run a certified KPI via `run_kpi` and evaluate against tenant threshold bands.

# When to use

The user asks whether a metric is warning, critical, or within expected thresholds.

# Procedure

1. Call `run_kpi` with the certified KPI id.
2. Evaluate resulting value against threshold specifications using `core.thresholds.evaluate`.
3. Report the level (ok, warning, critical) and bounds in the response.
