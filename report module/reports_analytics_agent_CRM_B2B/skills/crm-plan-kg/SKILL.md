---
name: crm-plan-kg
description: Attach KG on why and analytical asks. SQL still holds certified numbers.
metadata:
  version: "1.1.0"
  domain: "reports_analytics_domain"
  status: "active"
---

# When to use

Domain plan. Meaning: is this a number, a list, or an explanation?

# Procedure

- **How many / how much / list / find** with no why → SQL only (`run_kpi` or free SQL).
- **Why, explain, compare, vs, more than, less than, blocking, stall, 360, root cause, analytical** → always `executor: kg` on the **same locked object**. Write a reasoning `goal` (walk contacts, activities, deals, quotes, invoices). Do not put “count X” in the KG goal.
- They asked both a number and why → t1 SQL (catalog KPI + dimension) then t2 KG (`depends_on: t1`).
- Named account 360 / blocking / BANT with no volume ask → kg only.
- SQL still owns certified KPI arithmetic. KG explains graph rows (including empty or $0). Do not skip KG because the object is a lead, quote, invoice, or activity.

# Examples of KG goals (copy the spirit, not a closed list)

- Unassigned leads → contacts with no owner: source, status, company, BANT.
- Email vs other activities → ContactActivity labels and who was reached.
- More deals for a rep → that owner’s deals: stage, amount, lost_reason, stall.
- Quotes not accepted → Quote status and deal links.
- AR is zero → Invoice status and deal links.
- Pipeline is one deal / $0 amounts → Deal to Quote to LineItem.
