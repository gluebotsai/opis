---
name: crm-kpi-query
description: Honor Domain certified KPI via run_kpi.
metadata:
  version: "1.0.0"
  executors: "sql_analytics_executor"
  allowed-tools: "run_kpi"
  status: "active"
---

# When to use

`task.kpi` is a non-empty string.

# Procedure

Output only `{"tool":"run_kpi","kpi_id":"<that exact id>","dimension": <task.dimension or null>}`.

Copy `task.dimension` when set. Do not pick a neighbour KPI. Do not drop dimension.

Prebaked reports (`pipeline_by_owner`, `pipeline_by_stage`, `lost_reasons`, `aging_bands`, `top_open_opportunities`, …) keep `"dimension": null` unless Domain set one.

`won_revenue` / `won_revenue_trend` stay on deals. `collected_revenue` stays on invoices. Do not remap by role.

`deals_by_product` / `invoice_amount_by_product` / `product_revenue` stay those ids. Copy `dimension` (`owner` when Domain set it).

Top/largest/biggest open opportunities: `run_kpi` `top_open_opportunities`, not free SQL.
