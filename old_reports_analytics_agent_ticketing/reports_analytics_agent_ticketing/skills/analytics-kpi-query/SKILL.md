---
name: analytics-kpi-query
description: Certified KPI numbers for ticketing reports. Uses sql_analytics_executor execute_frame. Not for listing tickets to act on them.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.kpi.query"
  schema-ref: "analytics.kpi.query"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: execute_frame return_to_domain
---

# Purpose

Answer certified KPI asks (counts, rates, averages that have a product template) through `reports_analytics_domain` and `sql_analytics_executor`.

# When to use

The Domain named a certified measure from the KPI index and the frame path is certified.

# Procedure

1. Keep the Domain JSON frame. Do not rebuild the question from scratch.
2. Call `execute_frame` with that frame.
3. If the job is invalid, repair the frame once, then call `execute_frame` again.
4. Return the number plus the echo (scope, UTC window, status reading).

# Validation requirements

- This Skill may only use certified KPI execution. It must not fall through to free-form catalog counts.
- Tenant and role come only from trusted runtime identity.
