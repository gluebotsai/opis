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

- How many **leads** → `lead_count` (all active contacts). **Not** `unassigned_leads` unless they said unassigned/unowned.
- **Contacted** leads → `lead_count` + `"status_filter": "contacted"` + `"dimension": "owner"` if they named reps. **Not** deals. **Not** `activity_volume`. **Not** `unassigned_leads`.
- One named person on a count, list, or money KPI → `"owner_name"` (Python
  `owner_name ILIKE`). That result is only that person. Do not include deals
  or rows with a blank owner, and do not add an Unassigned bucket.
- Two or more named people in a comparison → `"owner_names": ["Name A",
  "Name B"]` plus `"dimension": "owner"` so the result contains only those
  people. Still no blank-owner rows.
- Dimension `owner` with no name is a team breakdown of people who have a
  name. It is not a place to list unassigned deals. Unassigned only when the
  user said unassigned, unowned, or orphan.
- Unassigned **list** → `"kpi": null`, list rows. Unassigned **how many** → `unassigned_leads`.
- Pipeline $ → `total_pipeline`. Booked / won $ → `won_revenue`. Paid invoices → `collected_revenue`. AR → `invoice_outstanding`.
- Win rate → decided deals. Quote acceptance → quotes.
- Aging (one number) → `average_aging`. Bands → `aging_bands`.
- Logged calls/meetings → `activity_volume`. `agent_operations` is agent **jobs**, not talk time.
- “Sales rep”, “salesperson”, “rep”, or “agent” with pipeline, deals,
  revenue, win rate, closing, or performance means a human CRM owner. Use
  owner-based sales KPIs. Use `agent_operations` only for explicit automation
  jobs, background runs, enrichment/scoring jobs, or execution status.
- Open/active/pipeline → open deal KPIs. Bare “how many deals” → `total_opportunities`. Hot / negotiate → `high_probability_deals`.
- How-many stays the SQL KPI above. Why / explain / compare on that object still adds a KG task (see `crm-plan-kg`).
