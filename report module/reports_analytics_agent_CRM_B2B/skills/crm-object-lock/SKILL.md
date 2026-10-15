---
name: crm-object-lock
description: Lead vs deal vs quote lookalikes. Domain plan only.
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  status: "active"
---

# When to use

Domain plan. Lock one object. Do not nearest-match a neighbour KPI.

# Procedure

- How many **leads** → `lead_count` (active `rpt.contacts` with `contact_type = 'lead'`). **Not** all contacts. **Not** `unassigned_leads` unless they said unassigned/unowned.
- **Contacted** leads → `lead_count` + `"status_filter": "contacted"` + `"dimension": "owner"` if they named reps. **Not** deals. **Not** `activity_volume`. **Not** `unassigned_leads`.
- How many **contacts** (people, not “leads”) → `"kpi": null` on `rpt.contacts` (do not use `lead_count`).
- Named person on a count or money KPI → `"owner_name"` (Python `owner_name ILIKE`). Also `"dimension": "owner"` when they asked who/compare.
- Unassigned **list** → `"kpi": null`, list rows. Unassigned **how many** → `unassigned_leads`.
- Pipeline $ → `total_pipeline`. Booked / won $ → `won_revenue`. Paid invoices → `collected_revenue`. AR → `invoice_outstanding`.
- Win rate → decided deals. Quote acceptance → quotes.
- Aging (one number) → `average_aging`. Bands → `aging_bands`.
- Logged calls/meetings → `activity_volume`. `agent_operations` is agent **jobs**, not talk time.
- Open/active/pipeline → open deal KPIs. Bare “how many deals” → `total_opportunities`. Hot / negotiate → `high_probability_deals`.
- Product catalog list/count → `rpt.products` (kpi null). Deal count by product → `deals_by_product`. Invoice $ by product or sales-rep $ by product → `invoice_amount_by_product`. Paid mix only → `product_revenue`. Not a deal-only KPI.
- How-many stays the SQL KPI above. Why / explain / compare on that object still adds a KG task (see `crm-plan-kg`).
