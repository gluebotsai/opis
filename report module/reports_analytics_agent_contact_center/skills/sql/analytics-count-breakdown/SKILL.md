---
name: analytics-count-breakdown
description: Grouped counts and rankings on rpt.* via run_sql, or run_kpi when task.kpi plus dimension is set.
license: Proprietary
compatibility: Contact Center Three-Layer Harness MAS
metadata:
  version: "2.1.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.count.breakdown"
  schema-ref: "analytics.count.breakdown"
  approval-policy: "none"
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_kpi run_sql return_to_domain
---

# Purpose

Breakdowns and rankings without folding conversation statuses.

# When to use

`answer_type` is breakdown or ranking, or `dimension` is set.

# Procedure

1. If `task.kpi` is set, `run_kpi` with that `dimension`.
2. Else one grouped `run_sql` on `rpt.*`, `LIMIT 10` for rankings, `LIMIT 50` for breakdowns.
3. A named agent or queue in the goal is a WHERE filter on `agent_name` / `queue_name`, not an org-wide dimension.
4. Count by status: `GROUP BY status`. Each status value stands alone.
