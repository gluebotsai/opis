---
name: crm-kpi-query
description: Pick and run a certified KPI whose meaning matches the task.
metadata:
  version: "1.1.0"
  executors: "sql_analytics_executor"
  allowed-tools: "run_kpi"
  status: "active"
---

# When to use

A certified KPI card covers `task.goal` (and Domain `end_goal`).

# Procedure

1. Read the KPI cards (id, definition, synonyms, allowed dimensions, date columns).
2. Choose the id whose **meaning** answers the goal.
3. Keep Domain’s `task.kpi` when it is that same meaning. Replace it when Domain named a neighbour (example: unassigned vs all leads).
4. Output only `{"tool":"run_kpi","kpi_id":"<chosen id>","dimension": <slice or null>}`.
5. Copy `task.dimension` when set and allowed. If the goal is by owner/rep/agent and the card allows `owner`, set `"dimension":"owner"`.

Prebaked reports (`pipeline_by_owner`, `pipeline_by_stage`, `lost_reasons`, `aging_bands`, `top_open_opportunities`, …) keep `"dimension": null` unless Domain set one.

`won_revenue` / `won_revenue_trend` stay on deals. `collected_revenue` stays on invoices. Do not remap by role.

Top/largest/biggest open opportunities: `run_kpi` `top_open_opportunities`, not free SQL.

If no card matches, leave this skill and write free SQL.
