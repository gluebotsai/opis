---
name: crm-terms
description: Term ids the planner may return. Code binds the slot. Do not write the filter.
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  status: "active"
---

# When to use

Domain plan. Return one `"term"` id when the question uses one of these words. Omit `term` when none fit. Do not invent a filter, a timestamp, or a WHERE clause.

A person's name, a region, a country, or a company is not a term. Put a region or country on `"region"` or `"country"`. Put a row cap they already named on `"limit"`.

# Ids

- `recent` — no duration given. Code uses the last 1 hour. If they named a window, put that window on `time` and do not send `recent`.
- `latest` — no number given. Code returns the 10 newest rows. If they named a number, put it on `limit`. Do not put `latest` on a count.
- `not_high` — open deals with stage weight below 0.75. KPI `high_probability_deals`.
- `high` — open deals with stage weight at least 0.75. KPI `high_probability_deals`.
- `not_good` — do not pick a KPI. Code asks: lost, stalled, or flagged.
- `cold` — days since last touch. Not `high_probability_deals`.
- `overdue` — overdue money or open tasks already past due.
- `top` — largest open deals. KPI `top_open_opportunities`.
- `open` — open deals. `closed` — won and lost together only when they said closed.
- `won` — won count or won amount. `lost` — lost count, lost amount, or lost reasons.
- `lead` — `lead_count` (contact type lead). `contact`, `prospect`, and `customer` are not `lead_count`.
- `unassigned` — `unassigned_leads`, only when they said unassigned.
- `mine` — for a sales user, rows they own or created. An admin stays on the organization.
- `new`, `contacted`, `qualified`, `disqualified`, `converted` — `lead_count` plus that status.
- `stale` — days since last touch.
- `aging` — `average_aging` or `aging_bands`. If they did not say which, omit the KPI.
- `stuck` — `average_aging` plus a graph task.
- `large` or `small` — `deal_size_bands`. Do not invent a cutoff.
- `rate` — the percent KPI for that object. “How many” stays the count.

# Place

“By region” or “by country” is `lead_count` with that `dimension`. A named place goes on `region` or `country` as they said it. Do not use `territory_performance` for a person’s region or country. That metric is deal city.
