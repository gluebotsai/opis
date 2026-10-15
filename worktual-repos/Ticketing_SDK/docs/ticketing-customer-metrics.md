# Ticketing customer metrics — keep / drop catalog

Grain: **`organization_id` + `customer_id`** on `ticketing.contact_profile` (never mix tenants).  
Person display fields (name/email/phone) come from **CDP** via `cdp_id` — not columns on `contact_profile`.  
Purpose: CDP / campaign / account-health signals from Ticketing.

See [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md).

This document replaces the mixed **34-row** list (plain names 1–16 + `tkt_*` 17–34). Many rows were **duplicates**. Some were **wrong grain** for “customer metrics.”

Related: [ticketing-schema.md](./ticketing-schema.md) · [ticketing-tables-and-labels.md](./ticketing-tables-and-labels.md) · [ticketing-metric-catalog-calculations.md](./ticketing-metric-catalog-calculations.md) (org-wide catalog)

---

## Verdict on the 34 submitted metrics

| S.No | Submitted name | Verdict | Why |
|-----:|----------------|---------|-----|
| 1 | `tickets_created_count` | **MERGE → keep `tkt_total_tickets`** | Same as lifetime ticket count |
| 2 | `tickets_open_count` | **MERGE → keep `tkt_tickets_open`** | Duplicate of #17 |
| 3 | `tickets_resolved_count` | **MERGE → keep `tkt_tickets_resolved`** | Duplicate of #18 |
| 4 | `reopen_count` | **MERGE → keep `tkt_tickets_reopened`** | Duplicate of #19 |
| 5 | `resolution_rate` | **MERGE → keep `tkt_resolution_rate`** | Duplicate of #28 |
| 6 | `avg_resolution_hours` | **MERGE → keep `tkt_avg_resolution_hours`** | Duplicate of #25 |
| 7 | `avg_first_response_hours` | **KEEP** (as `tkt_avg_first_response_hours`) | No `tkt_*` twin; needed for service quality |
| 8 | `priority_mix` | **KEEP** (as `tkt_priority_mix`) | VIP / severity profile |
| 9 | `channel_mix` | **KEEP** (as `tkt_channel_mix`) | Preferred contact channel |
| 10 | `top_issue_category` | **MERGE → keep `tkt_dominant_ticket_category`** | Duplicate of #31 |
| 11 | `avg_csat_score` | **MERGE → keep `tkt_avg_csat_score`** | Duplicate of #26 |
| 12 | `last_csat_score` | **MERGE → keep `tkt_last_csat_score`** | Duplicate of #27 |
| 13 | `csat_response_rate` | **KEEP** (as `tkt_csat_response_rate`) | Feedback willingness |
| 14 | `portal_login_count` | **MERGE → keep `tkt_portal_logins`** | Duplicate of #22 |
| 15 | `last_ticket_at` | **KEEP** (as `tkt_last_ticket_at`) | Recency timestamp |
| 16 | `days_since_last_ticket` | **MERGE → keep `tkt_days_since_last_ticket`** | Duplicate of #33 |
| 17 | `tkt_tickets_open` | **KEEP** | Current support load |
| 18 | `tkt_tickets_resolved` | **KEEP** | Closure volume |
| 19 | `tkt_tickets_reopened` | **KEEP** | Recurring-issue count |
| 20 | `tkt_tickets_overdue` | **KEEP** | Live SLA risk |
| 21 | `tkt_tickets_by_priority_urgent` | **KEEP** | Critical volume (also covered partly by mix) |
| 22 | `tkt_portal_logins` | **KEEP** | Self-service engagement |
| 23 | `tkt_proactive_recommendations_received` | **DROP** | Staff Approvals AI suggestions, not customer outreach; join is via `ticket_id`, not a customer “exposure” KPI |
| 24 | `tkt_proactive_recommendations_accepted` | **DROP** | Same — agent effectiveness, not customer health |
| 25 | `tkt_avg_resolution_hours` | **KEEP** | Support efficiency |
| 26 | `tkt_avg_csat_score` | **KEEP** | Satisfaction trend |
| 27 | `tkt_last_csat_score` | **KEEP** | Latest satisfaction |
| 28 | `tkt_resolution_rate` | **KEEP** | Resolved / created |
| 29 | `tkt_reopen_rate` | **KEEP** | Fix quality (better signal than count alone) |
| 30 | `tkt_sla_breach_rate` | **KEEP** | Historical SLA health (resolved late / created) |
| 31 | `tkt_dominant_ticket_category` | **KEEP** | Primary pain point |
| 32 | `tkt_last_resolved_at` | **KEEP** | Recency of successful close |
| 33 | `tkt_days_since_last_ticket` | **KEEP** | Quiet period / safe to market |
| 34 | `tkt_total_tickets` | **KEEP** | Lifetime volume — **prefer live `COUNT`**, not only `customers.total_tickets` cache |

### Also add (missing from the 34, still required)

| Metric | Why |
|--------|-----|
| `tkt_tickets_last_30_days` | Recent burden for campaigns (volume ≠ lifetime total) |
| `tkt_sla_compliance_rate` | % of **resolved** tickets that met `due_at` (pairs with breach rate) |

### Optional derived (not required in CDP export)

| Metric | Why |
|--------|-----|
| `tkt_support_risk_score` | Composite health score for UI; can be computed later from the kept metrics |

---

## Final catalog (required) — 22 metrics

Use **`tkt_*` names** as the single export vocabulary. Drop the duplicate plain aliases.

| # | Metric | Description | Decision use | Core formula |
|--:|--------|-------------|--------------|--------------|
| 1 | `tkt_total_tickets` | All tickets for this customer | Lifetime support volume | `COUNT(tickets.id)` |
| 2 | `tkt_tickets_last_30_days` | Created in last 30 days | Recent burden / product heat | `COUNT` where `created_at ≥ now() − 30 days` |
| 3 | `tkt_tickets_open` | Non-terminal tickets | Don’t ignore in campaigns; current load | `COUNT` where `NOT ticket_statuses.is_terminal` |
| 4 | `tkt_tickets_resolved` | Status = Resolved (or terminal resolved) | Throughput / recovery | `COUNT` where status is Resolved / `resolved_at IS NOT NULL` |
| 5 | `tkt_tickets_reopened` | Status = Reopened | Recurring issue volume | `COUNT` where `status = 'Reopened'` |
| 6 | `tkt_tickets_overdue` | Overdue now | Escalation / SLA risk | `due_at < now()` ∧ unresolved ∧ not terminal |
| 7 | `tkt_tickets_by_priority_urgent` | Priority = urgent | Critical account flag | `COUNT` where `priority = 'urgent'` |
| 8 | `tkt_priority_mix` | Share by priority | VIP / severity profile | counts (or %) per priority |
| 9 | `tkt_channel_mix` | Share by channel | Preferred ticket channel | counts (or %) per channel |
| 10 | `tkt_dominant_ticket_category` | Mode of `category` | Targeted content / fixes | `argmax COUNT(category)` |
| 11 | `tkt_resolution_rate` | Resolved / created | Support effectiveness | `resolved / NULLIF(created, 0)` |
| 12 | `tkt_reopen_rate` | Reopened / resolved | Fix quality | `reopened / NULLIF(resolved, 0)` |
| 13 | `tkt_sla_breach_rate` | Historically late / created | SLA compliance health | late-resolved (or ever-overdue) / created — define once below |
| 14 | `tkt_sla_compliance_rate` | Met deadline among resolved-with-due | SLA quality on closed work | `met / NULLIF(resolved_with_due_at, 0)` |
| 15 | `tkt_avg_resolution_hours` | Avg create → resolve | SLA expectation | `AVG(resolved_at − created_at)` hours |
| 16 | `tkt_avg_first_response_hours` | Avg create → first reply | Service quality | `AVG(first_response_at − created_at)` hours |
| 17 | `tkt_avg_csat_score` | Avg `csat_score` 1–5 | Health score input | `AVG(csat_score)` where rated |
| 18 | `tkt_last_csat_score` | Latest rated ticket’s CSAT | Immediate follow-up if low | score from `MAX(csat_rated_at)` ticket |
| 19 | `tkt_csat_response_rate` | Rated / resolved | Will they give feedback | `rated_resolved / NULLIF(resolved, 0)` |
| 20 | `tkt_portal_logins` | Portal session rows | Portal-first vs email | `COUNT(customer_portal_sessions)` |
| 21 | `tkt_last_ticket_at` | Latest ticket `created_at` | Active support relationship | `MAX(created_at)` |
| 22 | `tkt_days_since_last_ticket` | Days since last create | Safe to market again? | `CURRENT_DATE − DATE(last_ticket_at)` |
| 23 | `tkt_last_resolved_at` | Latest `resolved_at` | Recency of last fix | `MAX(resolved_at)` |

*(Table has 23 rows including the two adds; treat as the **required set**. If you need a strict “22”, fold urgent into `tkt_priority_mix` and drop #7.)*

---

## Explicitly not required (for this customer export)

| Metric | Reason |
|--------|--------|
| Plain aliases (#1–16 names) | Same math as `tkt_*` — keep one vocabulary |
| `tkt_proactive_recommendations_received` | Staff AI Approvals cards, not customer behavior |
| `tkt_proactive_recommendations_accepted` | Agent/ops KPI — put in org automation metrics if needed |
| `customers.total_tickets` as sole source | Cache only; analytics must use live `COUNT` |
| Hardcoded status lists without `is_terminal` | Orgs can customize statuses — prefer `ticket_statuses.is_terminal` for “open” |

---

## Rules

| Rule | Detail |
|------|--------|
| Group by | `organization_id`, `customer_id` |
| Open tickets | Prefer `ticket_statuses.is_terminal = false` (not only `Open/Pending/Reopened/Overdue` literals) |
| Ratios | Use `NULLIF(denominator, 0)`; return `NULL` when undefined |
| Time | Wall-clock on `tickets` (`created_at`, `first_response_at`, `resolved_at`, `due_at`, `csat_rated_at`) |
| Portal | `ticketing.customer_portal_sessions` filtered by `customer_id` |

**Base join**

```sql
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id
 AND ts.status = t.status
WHERE t.organization_id = :organization_id
  AND t.customer_id = :customer_id   -- ticketing.contact_profile.id
```

Display name/email/phone for the contact (when needed) join CDP via `contact_profile.cdp_id` — see [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md).

---

## Formulas (canonical)

### Volume & status

```sql
COUNT(t.id) AS tkt_total_tickets,

COUNT(t.id) FILTER (
  WHERE t.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
) AS tkt_tickets_last_30_days,

COUNT(t.id) FILTER (
  WHERE COALESCE(ts.is_terminal, FALSE) = FALSE
) AS tkt_tickets_open,

COUNT(t.id) FILTER (
  WHERE t.resolved_at IS NOT NULL OR t.status = 'Resolved'
) AS tkt_tickets_resolved,

COUNT(t.id) FILTER (WHERE t.status = 'Reopened') AS tkt_tickets_reopened,

COUNT(t.id) FILTER (
  WHERE t.due_at IS NOT NULL
    AND t.due_at < CURRENT_TIMESTAMP
    AND t.resolved_at IS NULL
    AND COALESCE(ts.is_terminal, FALSE) = FALSE
) AS tkt_tickets_overdue,

COUNT(t.id) FILTER (WHERE lower(t.priority) = 'urgent') AS tkt_tickets_by_priority_urgent
```

### Rates

```sql
COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL)::numeric
  / NULLIF(COUNT(*), 0) AS tkt_resolution_rate,

COUNT(*) FILTER (WHERE t.status = 'Reopened')::numeric
  / NULLIF(COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL), 0) AS tkt_reopen_rate,

-- Historical breach among tickets that had a due date and resolved late
COUNT(*) FILTER (
  WHERE t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at > t.due_at
)::numeric / NULLIF(COUNT(*), 0) AS tkt_sla_breach_rate,

COUNT(*) FILTER (
  WHERE t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at <= t.due_at
)::numeric
  / NULLIF(
      COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL),
      0
    ) AS tkt_sla_compliance_rate
```

### Timing

```sql
AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0)
  FILTER (WHERE t.resolved_at IS NOT NULL) AS tkt_avg_resolution_hours,

AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 3600.0)
  FILTER (WHERE t.first_response_at IS NOT NULL) AS tkt_avg_first_response_hours,

MAX(t.created_at) AS tkt_last_ticket_at,
CURRENT_DATE - MAX(t.created_at)::date AS tkt_days_since_last_ticket,
MAX(t.resolved_at) AS tkt_last_resolved_at
```

### CSAT

```sql
AVG(t.csat_score::numeric) FILTER (WHERE t.csat_score IS NOT NULL) AS tkt_avg_csat_score,

-- last score: from ticket with latest csat_rated_at (subquery / DISTINCT ON in full query)
COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL AND t.csat_score IS NOT NULL)::numeric
  / NULLIF(COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL), 0) AS tkt_csat_response_rate
```

### Mix / category / portal

```sql
-- tkt_priority_mix / tkt_channel_mix: GROUP BY priority|channel → JSON object of counts or shares
-- tkt_dominant_ticket_category: category with highest COUNT (exclude NULL)

SELECT COUNT(*) FROM ticketing.customer_portal_sessions s
WHERE s.customer_id = :customer_id
-- (+ org scope if column present)
AS tkt_portal_logins
```

---

## Recommended export row

| Column | Type |
|--------|------|
| `organization_id` | text/bigint |
| `customer_id` | text/bigint |
| `tkt_total_tickets` | int |
| `tkt_tickets_last_30_days` | int |
| `tkt_tickets_open` | int |
| `tkt_tickets_resolved` | int |
| `tkt_tickets_reopened` | int |
| `tkt_tickets_overdue` | int |
| `tkt_tickets_by_priority_urgent` | int |
| `tkt_priority_mix` | jsonb |
| `tkt_channel_mix` | jsonb |
| `tkt_dominant_ticket_category` | text |
| `tkt_resolution_rate` | numeric |
| `tkt_reopen_rate` | numeric |
| `tkt_sla_breach_rate` | numeric |
| `tkt_sla_compliance_rate` | numeric |
| `tkt_avg_resolution_hours` | numeric |
| `tkt_avg_first_response_hours` | numeric |
| `tkt_avg_csat_score` | numeric |
| `tkt_last_csat_score` | numeric |
| `tkt_csat_response_rate` | numeric |
| `tkt_portal_logins` | int |
| `tkt_last_ticket_at` | timestamptz |
| `tkt_days_since_last_ticket` | int |
| `tkt_last_resolved_at` | timestamptz |
| `calculated_at` | timestamptz |

---

## Summary

| | Count |
|--|------:|
| Submitted | 34 |
| Dropped as duplicate aliases | 14 (plain names merged into `tkt_*`) |
| Dropped as not customer KPIs | 2 (proactive recommendation received/accepted) |
| Added | 2 (`tkt_tickets_last_30_days`, `tkt_sla_compliance_rate`) |
| **Required export set** | **~22–23 `tkt_*` metrics** |
