---
name: analytics-kpi-query
description: Certified Contact Center KPI numbers via run_kpi. Grain is conversations, calls, contacts, or messages as named.
license: Proprietary
compatibility: Contact Center Three-Layer Harness MAS
metadata:
  version: "2.1.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.kpi.query"
  schema-ref: "analytics.kpi.query"
  approval-policy: "none"
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_kpi return_to_domain
---

# Purpose

Run one certified KPI template. Do not rewrite it as free SQL.

# When to use

`task.kpi` is set.

# Procedure

1. Call `run_kpi` with `kpi_id` = `task.kpi`. Copy `task.dimension` only when present.
2. If the template cannot satisfy the task, return `error_type: REPLAN`.
3. Durations in the certified SQL are already minutes.

# Validation requirements

- Tenant and role come from runtime identity only.
- `conversation_count` is all channels. `call_count` is channel `call`/`voice` only.
- `contacts_served` is people. `message_count` is messages.
- `avg_wait_time` is historical. `avg_wait_time_live` is queued-now (no date window).
- `abandonment_rate` is left-queue. Missed offers are `missed_contact_*`.
- `transfer_count` / `escalation_count` are distinct conversations.
- `active_agents` is roster `status = 'active'`. Ready/online now is not this KPI (use presence via report-list).
- `is_active` on conversations means `status = 'active'` only.
