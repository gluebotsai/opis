---
name: crm-kpi-catalog
description: Certified KPI ids Domain may emit. Infer meaning; do not memorize question to id.
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  status: "active"
---

# When to use

Domain plan. Pick a catalog id from meaning, not from a similar name.

# Catalog

Deals count: `total_opportunities`, `active_opportunities`, `won_deal_count`, `lost_deal_count`, `high_probability_deals`

Leads (CDP `contact_type = 'lead'` only, not prospects/contacts/customers): `lead_count`, `lead_status_mix`, `unassigned_leads`, `lead_source_conversion`

Money: `total_pipeline`, `weighted_pipeline`, `won_revenue`, `lost_revenue`, `collected_revenue`, `invoice_outstanding`, `overdue_amount`

Deal health: `average_deal_size`, `average_probability`, `average_aging`, `new_pipeline_month`, `expected_close_value`, `sales_velocity`, `avg_sales_cycle`

Named reports: `pipeline_by_stage`, `pipeline_by_owner`, `win_loss_split`, `aging_bands`, `deal_size_bands`, `lost_reasons`, `won_revenue_trend`, `top_open_opportunities`, `win_rate`

Quotes: `quote_acceptance_rate`, `open_quote_value`, `average_discount`

Touch: `activity_volume`, `days_since_last_touch`, `open_task_count`, `meeting_completion`, `agent_operations`

Other: `approval_queue`, `contract_arr`, `renewal_book`, `product_revenue`, `deals_by_product`, `invoice_amount_by_product`, `attach_rate`, `customer_retention`, `territory_performance`, `forecast_vs_target`

Products:
- List / how many in the catalog → `"kpi": null` on `rpt.products`.
- Paid collections by product → `product_revenue`.
- Deal count by product → `deals_by_product` (quote lines). `"dimension": "owner"` for sales-rep slice.
- Invoice amount by product (not void) → `invoice_amount_by_product`. `"dimension": "owner"` for sales-rep revenue by product.
- Bare “how many deals” is still `total_opportunities`, not `deals_by_product`.

Unavailable (still emit the id; Python refuses; do not substitute another KPI): `quota_attainment`, `stage_conversion`, `won_reason_mix`, `time_in_stage`, `campaign_attribution`, `email_open_rate`, `sequence_compliance`

Quota example — still emit the refusal id:

```json
{
  "kind": "plan",
  "depth": "quick",
  "tasks": [
    {
      "id": "t1",
      "executor": "sql",
      "kpi": "quota_attainment",
      "goal": "Quota attainment is not stored in CRM",
      "time": "all time",
      "scope": "org",
      "dimension": null,
      "answer_type": "kpi",
      "depends_on": []
    }
  ]
}
```

Brief after UNAVAILABLE: say CRM does not store that field. Do not guess a rate.

Optional task fields (Python binds): `"status_filter": "contacted"` on `lead_count`; `"owner_name": "Raghuram"` to restrict a KPI to that rep.
