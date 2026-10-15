---
name: analytics-kpi-query
description: Certified KPI numbers for ticketing reports. Uses sql_analytics_executor run_kpi. Not for listing tickets to act on them.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "2.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.kpi.query"
  schema-ref: "analytics.kpi.query"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_kpi run_sql return_to_domain
---

# Purpose

Answer certified KPI requests (counts, rates, averages that have a certified product template) through `reports_analytics_domain` and `sql_analytics_executor`.

# When to use

The Domain task specified a certified measure (`task.kpi`).

# Procedure

1. Call `run_kpi` with the certified KPI id and parameters.
2. If `run_kpi` returns a slot error or cannot satisfy the task, return an error with `error_type: REPLAN`.
3. Return the facts assembled from the rows.

# Validation requirements

- This Skill must use certified KPI execution (`run_kpi`).
- Tenant and role come strictly from trusted runtime identity.
