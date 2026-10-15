---
name: crm-money
description: Bookings vs collections vs pipeline vs AR. Domain plan and brief.
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  status: "active"
---

# When to use

Any money or “revenue” ask. Read `Identity: role=`. Explicit wording always wins.

# Procedure

- Won / booked / closed-won $ → **one** `won_revenue`.
- Paid / collected / receipts → **one** `collected_revenue`.
- AR / outstanding → **one** `invoice_outstanding`.
- Pipeline $ → **one** `total_pipeline`.
- Never add bookings and collections.

Bare “revenue” / “our revenue” with **no** won, collected, pipeline, or AR word:

- sales_rep / sales_manager / presales → **one** `won_revenue` (scope own for rep/presales, org for manager).
- finance → **one** `collected_revenue`.
- **admin only** → two SQL tasks (`won_revenue` then `collected_revenue`), both labeled.
- If role is not admin and the plan has both money KPIs, drop collections.

Admin “what is won revenue?” (explicit bookings — **not** the pair):

```json
{
  "kind": "plan",
  "depth": "quick",
  "tasks": [
    {
      "id": "t1",
      "executor": "sql",
      "kpi": "won_revenue",
      "goal": "Booked closed-won deal amount",
      "time": "all time",
      "scope": "org",
      "dimension": null,
      "answer_type": "kpi",
      "depends_on": []
    }
  ]
}
```

Admin “collected revenue” (explicit collections — **not** the pair):

```json
{
  "kind": "plan",
  "depth": "quick",
  "tasks": [
    {
      "id": "t1",
      "executor": "sql",
      "kpi": "collected_revenue",
      "goal": "Paid invoice receipts",
      "time": "all time",
      "scope": "org",
      "dimension": null,
      "answer_type": "kpi",
      "depends_on": []
    }
  ]
}
```

# Brief

If facts have only `won_revenue`, that is booked. Only `collected_revenue` is paid invoices. If both (admin), name both; never add.

Zero pipeline / zero won with open or won deals still in the rows: say the money is 0 and that most deals have blank amount. Example: “Pipeline is 10,000 on Yaswanth / Zepto; the other open deals have amount 0.” Do not invent a total.

Invoice facts with `outstanding_amount = 0` and `invoice_count = 0`: say there is no sent/overdue AR. Do not treat that as “the warehouse failed.” Draft invoices are not outstanding.
