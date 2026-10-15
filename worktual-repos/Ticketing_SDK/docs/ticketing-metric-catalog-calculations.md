# Metric catalog — calculation guide

Source catalog: `metric_catlog_updated.py` (**94 metrics**).

This document defines **how to calculate** each catalog metric against the `ticketing` Postgres schema.

> **Note:** Live chat tool `get_metrics` (`GET /api/metrics`) only returns dashboard KPIs
> (open, overdue, due today, created today, unassigned). Most catalog metrics require
> dedicated SQL (as below) or a future metrics/dbt layer — they are **not** all returned by `get_metrics`.

Related docs:

- [ticketing-tables-and-labels.md](./ticketing-tables-and-labels.md) — statuses, priorities, channels
- [ticketing-customer-metrics.md](./ticketing-customer-metrics.md) — customer-grain CDP metrics (`contact_profile` + CDP)
- [ticketing-schema.md](./ticketing-schema.md) — full schema (hub/spoke)
- [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md) — SoR rules

> **Hub/spoke:** Prefer `ticketing.contact_profile` (not dropped `customers`), `ticketing.agents` (not `users`), `ticketing.org_settings` / `accounts.organizations` (not `ticketing.organizations`). Product links tables are dropped.

---

## Common rules

| Rule | Detail |
|------|--------|
| Tenant scope | Always filter `organization_id = :org_id` |
| Active / open | Prefer `ticket_statuses.is_terminal = false` over hardcoding statuses |
| Closed | `is_terminal = true` (usually `Resolved`) |
| Unassigned | `assignee_id IS NULL` OR `assignee_name IS NULL` OR `assignee_name = 'Unassigned'` |
| Time window | Apply optional `created_at` / `resolved_at` range filters as needed |
| Org timezone | Use `organizations.display_timezone` for “today” metrics |
| Ratios | Use `NULLIF(denominator, 0)` to avoid divide-by-zero; return `NULL` when undefined |
| Units | Ratios are 0–1 (multiply by 100 for % display) |

**Base ticket join for status flags:**

```sql
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id
 AND ts.status = t.status
WHERE t.organization_id = :org_id
```

---

## Index by category

### ai_automation (14)

- [`recommendation_volume`](#recommendation_volume) — Proactive Recommendation Volume
- [`accepted_recommendations_metric`](#accepted_recommendations_metric) — Accepted Recommendation Count
- [`dismissed_recommendations_metric`](#dismissed_recommendations_metric) — Dismissed Recommendation Count
- [`open_recommendations_metric`](#open_recommendations_metric) — Open (Undecided) Recommendation Count
- [`recommendation_acceptance_rate`](#recommendation_acceptance_rate) — Recommendation Acceptance Rate
- [`approval_volume`](#approval_volume) — Proactive Approval Volume
- [`approved_metric`](#approved_metric) — Approved Action Count
- [`rejected_metric`](#rejected_metric) — Rejected Action Count
- [`approval_rate`](#approval_rate) — Approval Rate
- [`decision_hours_total`](#decision_hours_total) — Approval Decision Hours (sum)
- [`decided_approvals_metric`](#decided_approvals_metric) — Decided Approval Count
- [`average_decision_hours`](#average_decision_hours) — Average Approval Decision Time (hours)
- [`pending_approvals_metric`](#pending_approvals_metric) — Pending (Undecided) Approval Count
- [`proactive_audit_volume`](#proactive_audit_volume) — Proactive Agent Audit Event Volume

### engagement (8)

- [`note_volume`](#note_volume) — Ticket Note Volume
- [`internal_note_volume`](#internal_note_volume) — Internal Note Volume
- [`customer_reply_volume`](#customer_reply_volume) — Customer-Visible Reply Volume
- [`internal_note_ratio`](#internal_note_ratio) — Internal Note Ratio (internal / total notes)
- [`average_notes_per_ticket`](#average_notes_per_ticket) — Average Notes Per Ticket (cross-model: ticket_note vs ticket)
- [`notification_volume`](#notification_volume) — Staff Notification Volume
- [`unread_notifications_metric`](#unread_notifications_metric) — Unread Notification Count
- [`outbound_email_volume`](#outbound_email_volume) — Outbound Email Volume

### governance (4)

- [`audit_event_volume`](#audit_event_volume) — Audit Event Volume
- [`escalation_volume`](#escalation_volume) — Escalation Volume
- [`reassignment_volume`](#reassignment_volume) — Reassignment (Assignment-Change) Volume
- [`escalation_rate`](#escalation_rate) — Escalation Rate (cross-model: audit_event vs ticket)

### knowledge (4)

- [`kb_article_volume`](#kb_article_volume) — Knowledge Base Article Count
- [`kb_published_article_metric`](#kb_published_article_metric) — Published KB Article Count
- [`kb_views_total`](#kb_views_total) — KB Article Views (sum)
- [`macro_volume`](#macro_volume) — Macro Template Count

### quality (10)

- [`csat_score_total`](#csat_score_total) — CSAT Score (sum)
- [`csat_rated_metric`](#csat_rated_metric) — CSAT Rated Ticket Count
- [`average_csat_score`](#average_csat_score) — Average CSAT Score
- [`csat_response_rate`](#csat_response_rate) — CSAT Response Rate (rated / resolved)
- [`csat_promoter_metric`](#csat_promoter_metric) — CSAT Promoter Count (score >= 4)
- [`csat_detractor_metric`](#csat_detractor_metric) — CSAT Detractor Count (score <= 2)
- [`csat_promoter_rate`](#csat_promoter_rate) — CSAT Promoter Rate
- [`csat_detractor_rate`](#csat_detractor_rate) — CSAT Detractor Rate
- [`reopen_rate`](#reopen_rate) — Reopen Rate
- [`csat_neutral_metric`](#csat_neutral_metric) — CSAT Neutral Count (score = 3)

### sla (24)

- [`breached_tickets_metric`](#breached_tickets_metric) — SLA Breached Ticket Count
- [`sla_breach_rate`](#sla_breach_rate) — SLA Breach Rate
- [`resolution_hours_total`](#resolution_hours_total) — Resolution Hours (sum)
- [`resolved_for_avg`](#resolved_for_avg) — Resolved Ticket Count (for averages)
- [`average_resolution_time_hours`](#average_resolution_time_hours) — Average Resolution Time (hours)
- [`first_response_hours_total`](#first_response_hours_total) — First Response Hours (sum)
- [`tickets_with_first_response_metric`](#tickets_with_first_response_metric) — Tickets With First Response Count
- [`average_first_response_hours`](#average_first_response_hours) — Average First Response Time (hours)
- [`first_response_sla_met_metric`](#first_response_sla_met_metric) — First-Response SLA Met Count
- [`tickets_with_first_response_sla_target_metric`](#tickets_with_first_response_sla_target_metric) — Tickets With First-Response SLA Target Count
- [`first_response_sla_compliance_rate`](#first_response_sla_compliance_rate) — First-Response SLA Compliance Rate
- [`resolution_hours_variance_total`](#resolution_hours_variance_total) — Resolution Hours Variance (sum, actual - target)
- [`tickets_with_sla_target_metric`](#tickets_with_sla_target_metric) — Tickets With SLA Target Count
- [`average_resolution_hours_variance`](#average_resolution_hours_variance) — Average Resolution Hours Variance vs SLA Target
- [`due_today_tickets_metric`](#due_today_tickets_metric) — Tickets Due Today
- [`current_overdue_tickets_metric`](#current_overdue_tickets_metric) — Current Overdue Ticket Count
- [`unanswered_tickets_metric`](#unanswered_tickets_metric) — Unanswered Ticket Count (no first response)
- [`resolution_sla_met_metric`](#resolution_sla_met_metric) — Resolution SLA Met Count
- [`resolution_sla_compliance_rate`](#resolution_sla_compliance_rate) — Resolution SLA Compliance Rate
- [`average_first_response_minutes`](#average_first_response_minutes) — Average First Response Time (minutes)
- [`first_response_coverage_rate`](#first_response_coverage_rate) — First Response Coverage Rate
- [`sla_at_risk_tickets_metric`](#sla_at_risk_tickets_metric) — SLA At-Risk Ticket Count (due soon)
- [`average_overdue_hours`](#average_overdue_hours) — Average Overdue Hours
- [`queues_at_risk_metric`](#queues_at_risk_metric) — Queues At Risk Count

### staffing (7)

- [`queue_coverage_count`](#queue_coverage_count) — Queue Membership Count
- [`distinct_agents_in_queues`](#distinct_agents_in_queues) — Distinct Agents Covering Queues
- [`distinct_queues_covered`](#distinct_queues_covered) — Distinct Queues Covered
- [`tickets_with_resolver_metric`](#tickets_with_resolver_metric) — Tickets With Resolver Assigned Count
- [`tickets_without_resolver_metric`](#tickets_without_resolver_metric) — Tickets Without Resolver Count
- [`active_agents_metric`](#active_agents_metric) — Active Agent Headcount
- [`queue_count`](#queue_count) — Support Queue Count

### volume (23)

- [`ticket_volume`](#ticket_volume) — Ticket Volume
- [`resolved_tickets_metric`](#resolved_tickets_metric) — Resolved Ticket Count
- [`open_tickets_metric`](#open_tickets_metric) — Open / Active Ticket Count (not closed)
- [`active_tickets_metric`](#active_tickets_metric) — Active Ticket Count (status not closed)
- [`resolution_rate`](#resolution_rate) — Resolution Rate
- [`unassigned_tickets_metric`](#unassigned_tickets_metric) — Unassigned Ticket Count
- [`unassignment_rate`](#unassignment_rate) — Unassignment Rate
- [`customers_served`](#customers_served) — Distinct Customers Served
- [`accounts_served`](#accounts_served) — Distinct B2B Accounts Served
- [`open_ticket_age_days_total`](#open_ticket_age_days_total) — Open Ticket Age Days (sum)
- [`average_open_ticket_age_days`](#average_open_ticket_age_days) — Average Open Ticket Age (days)
- [`tickets_created_today_metric`](#tickets_created_today_metric) — Tickets Created Today
- [`tickets_last_30_days`](#tickets_last_30_days) — Tickets in Last 30 Days
- [`days_since_last_ticket`](#days_since_last_ticket) — Days Since Last Ticket
- [`reopened_tickets_metric`](#reopened_tickets_metric) — Reopened Ticket Count
- [`high_priority_open_tickets_metric`](#high_priority_open_tickets_metric) — High/Urgent Open Ticket Count
- [`closed_tickets_metric`](#closed_tickets_metric) — Closed Ticket Count
- [`pending_tickets_metric`](#pending_tickets_metric) — Pending / In-Progress Ticket Count
- [`assigned_tickets_metric`](#assigned_tickets_metric) — Assigned Ticket Count
- [`assignment_rate`](#assignment_rate) — Assignment Rate
- [`tickets_last_7_days`](#tickets_last_7_days) — Tickets in Last 7 Days
- [`average_tickets_per_day`](#average_tickets_per_day) — Average Tickets Per Day
- [`active_customers_metric`](#active_customers_metric) — Active Customers in Directory

---

## Metrics & formulas

<a id="ticket_volume"></a>

### `ticket_volume`

**Ticket Volume**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `id`, `organization_id`, `created_at` |

**Description:** Count of all tickets created in the selected scope and time window, regardless of status, priority, channel, or assignee. Primary intake/demand volume KPI from ticketing.tickets.

**Formula:** `COUNT(tickets.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS ticket_volume
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  /* optional: AND t.created_at >= :range_start AND t.created_at < :range_end */
```

---

<a id="resolved_tickets_metric"></a>

### `resolved_tickets_metric`

**Resolved Ticket Count**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `status`, `resolved_at`, `is_terminal` |

**Description:** Count of tickets that reached a resolved/terminal state (status Resolved or ticket_statuses.is_terminal = true), usually with resolved_at set.

**Formula:** `COUNT(*) WHERE status = 'Resolved' OR is_terminal = true`

**SQL:**

```sql
SELECT COUNT(*)::int AS resolved_tickets_metric
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND (COALESCE(ts.is_terminal, false) = true OR t.status = 'Resolved')
```

---

<a id="open_tickets_metric"></a>

### `open_tickets_metric`

**Open / Active Ticket Count (not closed)**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `status`, `is_terminal` |

**Description:** Count of active tickets — tickets whose status is not closed/terminal (is_closed_by_status = false, or status not Resolved). Includes Open, Pending, Reopened, Overdue, and similar non-closed states. Live unfinished workload from ticketing.tickets; same concept users mean by "active tickets".

**Formula:** `COUNT(*) WHERE NOT is_terminal (Open/Pending/Reopened/Overdue)`

**SQL:**

```sql
SELECT COUNT(*)::int AS open_tickets_metric
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND COALESCE(ts.is_terminal, false) = false
```

---

<a id="active_tickets_metric"></a>

### `active_tickets_metric`

**Active Ticket Count (status not closed)**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `status`, `is_terminal` |

**Description:** Count of tickets that are still active because their status is not closed. Uses ticket_statuses.is_terminal / is_closed_by_status = false (or status not in a closed/Resolved terminal set). Equivalent to the open/active unfinished workload — not limited to status value "Open" alone; Pending, Reopened, and Overdue count as active when not closed.

**Formula:** `Same as open_tickets_metric — status not closed/terminal`

**SQL:**

```sql
-- Same calculation as open_tickets_metric
SELECT COUNT(*)::int AS active_tickets_metric
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND COALESCE(ts.is_terminal, false) = false
```

---

<a id="resolution_rate"></a>

### `resolution_rate`

**Resolution Rate**

| | |
|--|--|
| Category | `volume` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `id`, `status`, `is_terminal` |

**Description:** Share of tickets that are resolved: resolved_tickets / ticket_volume. Expressed as a ratio (0–1) or percentage.

**Formula:** `resolved_tickets_metric / NULLIF(ticket_volume, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE COALESCE(ts.is_terminal, false) OR t.status = 'Resolved')::float
  / NULLIF(COUNT(*), 0) AS resolution_rate
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
```

---

<a id="unassigned_tickets_metric"></a>

### `unassigned_tickets_metric`

**Unassigned Ticket Count**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `assignee_name`, `assignee_id`, `status` |

**Description:** Count of unresolved tickets with no agent owner (assignee_name is null or Unassigned). Matches the dashboard unassigned KPI.

**Formula:** `COUNT(*) WHERE status <> Resolved AND (assignee_name IS NULL OR assignee_name = 'Unassigned')`

**SQL:**

```sql
SELECT COUNT(*)::int AS unassigned_tickets_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.status <> 'Resolved'
  AND (t.assignee_id IS NULL OR t.assignee_name IS NULL OR t.assignee_name = 'Unassigned')
```

---

<a id="unassignment_rate"></a>

### `unassignment_rate`

**Unassignment Rate**

| | |
|--|--|
| Category | `volume` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `assignee_name`, `id` |

**Description:** Share of tickets that are unassigned: unassigned_tickets / ticket_volume (or vs open tickets depending on semantic definition). Signals routing/staffing gaps.

**Formula:** `unassigned_tickets_metric / NULLIF(ticket_volume, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (
    WHERE t.status <> 'Resolved'
      AND (t.assignee_id IS NULL OR t.assignee_name IS NULL OR t.assignee_name = 'Unassigned')
  )::float / NULLIF(COUNT(*), 0) AS unassignment_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="customers_served"></a>

### `customers_served`

**Distinct Customers Served**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `customer_id`, `customer_email` |

**Description:** Count of distinct customers (ticketing.customers / tickets.customer_id) who have at least one ticket in scope — unique people helped, not ticket volume.

**Formula:** `COUNT(DISTINCT customer_id) — or DISTINCT lower(customer_email) if id null`

**SQL:**

```sql
SELECT COUNT(DISTINCT COALESCE(t.customer_id::text, lower(t.customer_email)))::int AS customers_served
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND (t.customer_id IS NOT NULL OR NULLIF(trim(t.customer_email), '') IS NOT NULL)
```

---

<a id="accounts_served"></a>

### `accounts_served`

**Distinct B2B Accounts Served**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.customers`, `ticketing.accounts` |
| Key fields | `customer_id`, `account_id` |

**Description:** Count of distinct B2B accounts linked to tickets in scope — unique companies helped.

**Formula:** `COUNT(DISTINCT customers.account_id) WHERE account_id IS NOT NULL`

**SQL:**

```sql
SELECT COUNT(DISTINCT c.account_id)::int AS accounts_served
FROM ticketing.tickets t
JOIN ticketing.customers c ON c.id = t.customer_id
WHERE t.organization_id = :org_id
  AND c.account_id IS NOT NULL
```

---

<a id="open_ticket_age_days_total"></a>

### `open_ticket_age_days_total`

**Open Ticket Age Days (sum)**

| | |
|--|--|
| Category | `volume` |
| Unit | `days` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `created_at`, `status` |

**Description:** The combined age, in days, of every ticket that's currently open — a raw sum, used only as the numerator behind the average backlog age.

**Formula:** `SUM(EXTRACT(EPOCH FROM (now() - created_at))/86400) for open tickets`

**SQL:**

```sql
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 86400.0), 0)
  AS open_ticket_age_days_total
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND COALESCE(ts.is_terminal, false) = false
```

---

<a id="average_open_ticket_age_days"></a>

### `average_open_ticket_age_days`

**Average Open Ticket Age (days)**

| | |
|--|--|
| Category | `volume` |
| Unit | `days` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `created_at` |

**Description:** Mean age in days of currently open (non-terminal) tickets: average of (now − created_at) for open tickets. Measures backlog staleness.

**Formula:** `open_ticket_age_days_total / NULLIF(open_tickets_metric, 0)  OR  AVG(age_days)`

**SQL:**

```sql
SELECT AVG(EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 86400.0)
  AS average_open_ticket_age_days
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND COALESCE(ts.is_terminal, false) = false
```

---

<a id="breached_tickets_metric"></a>

### `breached_tickets_metric`

**SLA Breached Ticket Count**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `due_at`, `resolved_at` |

**Description:** Count of tickets that historically missed their resolution SLA deadline (resolved_at > due_at, or unresolved past due_at counted as breach). Distinct from current Overdue status stock — use current_overdue_tickets_metric for live overdue workload.

**Formula:** `COUNT where (resolved_at > due_at) OR (resolved_at IS NULL AND due_at < now())`

**SQL:**

```sql
SELECT COUNT(*)::int AS breached_tickets_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.due_at IS NOT NULL
  AND (
    (t.resolved_at IS NOT NULL AND t.resolved_at > t.due_at)
    OR (t.resolved_at IS NULL AND t.due_at < NOW())
  )
```

---

<a id="sla_breach_rate"></a>

### `sla_breach_rate`

**SLA Breach Rate**

| | |
|--|--|
| Category | `sla` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `due_at`, `resolved_at` |

**Description:** Share of SLA-eligible tickets that breached resolution SLA: breached_tickets / tickets_with_sla_target. Higher means worse compliance.

**Formula:** `breached_tickets_metric / NULLIF(tickets_with_sla_target_metric, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (
    WHERE (t.resolved_at IS NOT NULL AND t.resolved_at > t.due_at)
       OR (t.resolved_at IS NULL AND t.due_at < NOW())
  )::float
  / NULLIF(COUNT(*) FILTER (WHERE t.due_at IS NOT NULL), 0)
  AS sla_breach_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="resolution_hours_total"></a>

### `resolution_hours_total`

**Resolution Hours (sum)**

| | |
|--|--|
| Category | `sla` |
| Unit | `hours` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at`, `resolved_at` |

**Description:** The combined hours spent resolving tickets, summed across every resolved case — a raw building block, not an average.

**Formula:** `SUM(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) WHERE resolved_at IS NOT NULL`

**SQL:**

```sql
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0), 0)
  AS resolution_hours_total
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.resolved_at IS NOT NULL
```

---

<a id="resolved_for_avg"></a>

### `resolved_for_avg`

**Resolved Ticket Count (for averages)**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `resolved_at` |

**Description:** The denominator used when averaging resolution time — a count of resolved tickets specifically for that calculation.

**Formula:** `COUNT(*) WHERE resolved_at IS NOT NULL`

**SQL:**

```sql
SELECT COUNT(*)::int AS resolved_for_avg
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.resolved_at IS NOT NULL
```

---

<a id="average_resolution_time_hours"></a>

### `average_resolution_time_hours`

**Average Resolution Time (hours)**

| | |
|--|--|
| Category | `sla` |
| Unit | `hours` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at`, `resolved_at` |

**Description:** Mean hours from ticket created_at to resolved_at for tickets with resolved_at set. Also known as MTTR (mean time to resolution).

**Formula:** `AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) WHERE resolved_at IS NOT NULL`

**SQL:**

```sql
SELECT AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0)
  AS average_resolution_time_hours
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.resolved_at IS NOT NULL
```

---

<a id="first_response_hours_total"></a>

### `first_response_hours_total`

**First Response Hours (sum)**

| | |
|--|--|
| Category | `sla` |
| Unit | `hours` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at`, `first_response_at` |

**Description:** The combined hours across every ticket's first agent reply, summed — a raw building block behind average first-response time.

**Formula:** `SUM(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) WHERE first_response_at IS NOT NULL`

**SQL:**

```sql
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 3600.0), 0)
  AS first_response_hours_total
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.first_response_at IS NOT NULL
```

---

<a id="tickets_with_first_response_metric"></a>

### `tickets_with_first_response_metric`

**Tickets With First Response Count**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `first_response_at` |

**Description:** Tickets that have gotten at least one reply from an agent — used as the denominator for average first-response time.

**Formula:** `COUNT(*) WHERE first_response_at IS NOT NULL`

**SQL:**

```sql
SELECT COUNT(*)::int AS tickets_with_first_response_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.first_response_at IS NOT NULL
```

---

<a id="average_first_response_hours"></a>

### `average_first_response_hours`

**Average First Response Time (hours)**

| | |
|--|--|
| Category | `sla` |
| Unit | `hours` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at`, `first_response_at` |

**Description:** Mean hours from ticket created_at to first_response_at for tickets that received a first staff response. Measures initial response speed (FRT).

**Formula:** `AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) WHERE first_response_at IS NOT NULL`

**SQL:**

```sql
SELECT AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 3600.0)
  AS average_first_response_hours
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.first_response_at IS NOT NULL
```

---

<a id="first_response_sla_met_metric"></a>

### `first_response_sla_met_metric`

**First-Response SLA Met Count**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.sla_policies` |
| Key fields | `created_at`, `first_response_at`, `priority`, `first_response_hours` |

**Description:** Tickets whose first agent reply landed within the promised response-time target.

**Formula:** `COUNT where first_response_at <= created_at + first_response_hours`

**SQL:**

```sql
SELECT COUNT(*)::int AS first_response_sla_met_metric
FROM ticketing.tickets t
JOIN ticketing.sla_policies sp
  ON sp.organization_id = t.organization_id
 AND sp.priority = t.priority
 AND COALESCE(sp.active, true) = true
WHERE t.organization_id = :org_id
  AND t.first_response_at IS NOT NULL
  AND t.first_response_at <= t.created_at + make_interval(hours => sp.first_response_hours)
```

---

<a id="tickets_with_first_response_sla_target_metric"></a>

### `tickets_with_first_response_sla_target_metric`

**Tickets With First-Response SLA Target Count**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.sla_policies` |
| Key fields | `priority`, `first_response_hours` |

**Description:** Tickets that actually have a first-response SLA target set — the eligible pool for measuring response-time compliance.

**Formula:** `COUNT tickets that join an active sla_policies row for their priority`

**SQL:**

```sql
SELECT COUNT(*)::int AS tickets_with_first_response_sla_target_metric
FROM ticketing.tickets t
JOIN ticketing.sla_policies sp
  ON sp.organization_id = t.organization_id
 AND sp.priority = t.priority
 AND COALESCE(sp.active, true) = true
WHERE t.organization_id = :org_id
```

---

<a id="first_response_sla_compliance_rate"></a>

### `first_response_sla_compliance_rate`

**First-Response SLA Compliance Rate**

| | |
|--|--|
| Category | `sla` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.sla_policies` |
| Key fields | `first_response_at`, `created_at`, `first_response_hours` |

**Description:** Share of tickets with a first-response SLA target where the first reply met the target (first_response_at within sla_policies.first_response_hours of created_at).

**Formula:** `first_response_sla_met / NULLIF(tickets_with_first_response among eligible, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (
    WHERE t.first_response_at IS NOT NULL
      AND t.first_response_at <= t.created_at + make_interval(hours => sp.first_response_hours)
  )::float
  / NULLIF(COUNT(*) FILTER (WHERE t.first_response_at IS NOT NULL), 0)
  AS first_response_sla_compliance_rate
FROM ticketing.tickets t
JOIN ticketing.sla_policies sp
  ON sp.organization_id = t.organization_id
 AND sp.priority = t.priority
 AND COALESCE(sp.active, true) = true
WHERE t.organization_id = :org_id
```

---

<a id="csat_score_total"></a>

### `csat_score_total`

**CSAT Score (sum)**

| | |
|--|--|
| Category | `quality` |
| Unit | `score` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score` |

**Description:** The combined satisfaction points across every rated ticket, summed — a raw building block behind the average CSAT score.

**Formula:** `SUM(csat_score) WHERE csat_score IS NOT NULL`

**SQL:**

```sql
SELECT COALESCE(SUM(t.csat_score), 0)::int AS csat_score_total
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.csat_score IS NOT NULL
```

---

<a id="csat_rated_metric"></a>

### `csat_rated_metric`

**CSAT Rated Ticket Count**

| | |
|--|--|
| Category | `quality` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score` |

**Description:** Tickets that a customer actually left a satisfaction rating on.

**Formula:** `COUNT(*) WHERE csat_score IS NOT NULL`

**SQL:**

```sql
SELECT COUNT(*)::int AS csat_rated_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.csat_score IS NOT NULL
```

---

<a id="average_csat_score"></a>

### `average_csat_score`

**Average CSAT Score**

| | |
|--|--|
| Category | `quality` |
| Unit | `score` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score` |

**Description:** Mean customer satisfaction rating (tickets.csat_score, scale 1–5) across rated tickets only.

**Formula:** `AVG(csat_score) WHERE csat_score IS NOT NULL (scale 1–5)`

**SQL:**

```sql
SELECT AVG(t.csat_score::numeric) AS average_csat_score
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.csat_score IS NOT NULL
```

---

<a id="csat_response_rate"></a>

### `csat_response_rate`

**CSAT Response Rate (rated / resolved)**

| | |
|--|--|
| Category | `quality` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score`, `resolved_at` |

**Description:** Share of resolved tickets that received a CSAT rating: csat_rated / resolved. Measures survey participation, not satisfaction level.

**Formula:** `COUNT(csat rated among resolved) / NULLIF(COUNT(resolved), 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL AND t.csat_score IS NOT NULL)::float
  / NULLIF(COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL), 0)
  AS csat_response_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="csat_promoter_metric"></a>

### `csat_promoter_metric`

**CSAT Promoter Count (score >= 4)**

| | |
|--|--|
| Category | `quality` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score` |

**Description:** Tickets rated 4 or higher on the satisfaction scale — the genuinely happy responses.

**Formula:** `COUNT(*) WHERE csat_score >= 4`

**SQL:**

```sql
SELECT COUNT(*)::int AS csat_promoter_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.csat_score >= 4
```

---

<a id="csat_detractor_metric"></a>

### `csat_detractor_metric`

**CSAT Detractor Count (score <= 2)**

| | |
|--|--|
| Category | `quality` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score` |

**Description:** Tickets rated 2 or lower on the satisfaction scale — the genuinely unhappy responses.

**Formula:** `COUNT(*) WHERE csat_score <= 2`

**SQL:**

```sql
SELECT COUNT(*)::int AS csat_detractor_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.csat_score IS NOT NULL
  AND t.csat_score <= 2
```

---

<a id="csat_promoter_rate"></a>

### `csat_promoter_rate`

**CSAT Promoter Rate**

| | |
|--|--|
| Category | `quality` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score` |

**Description:** Share of rated tickets with csat_score >= 4 (promoters / high satisfaction).

**Formula:** `csat_promoter_metric / NULLIF(csat_rated_metric, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE t.csat_score >= 4)::float
  / NULLIF(COUNT(*) FILTER (WHERE t.csat_score IS NOT NULL), 0)
  AS csat_promoter_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="csat_detractor_rate"></a>

### `csat_detractor_rate`

**CSAT Detractor Rate**

| | |
|--|--|
| Category | `quality` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score` |

**Description:** Share of rated tickets with csat_score <= 2 (detractors / low satisfaction).

**Formula:** `csat_detractor_metric / NULLIF(csat_rated_metric, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE t.csat_score IS NOT NULL AND t.csat_score <= 2)::float
  / NULLIF(COUNT(*) FILTER (WHERE t.csat_score IS NOT NULL), 0)
  AS csat_detractor_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="resolution_hours_variance_total"></a>

### `resolution_hours_variance_total`

**Resolution Hours Variance (sum, actual - target)**

| | |
|--|--|
| Category | `sla` |
| Unit | `hours` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.sla_policies` |
| Key fields | `created_at`, `resolved_at`, `due_at`, `resolution_hours` |

**Description:** The combined gap between actual and target resolution hours, summed across every SLA-eligible ticket — positive means running late overall.

**Formula:** `SUM(actual_resolution_hours - resolution_hours) for SLA-eligible resolved tickets`

**SQL:**

```sql
SELECT COALESCE(SUM(
  EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0 - sp.resolution_hours
), 0) AS resolution_hours_variance_total
FROM ticketing.tickets t
JOIN ticketing.sla_policies sp
  ON sp.organization_id = t.organization_id
 AND sp.priority = t.priority
 AND COALESCE(sp.active, true) = true
WHERE t.organization_id = :org_id
  AND t.resolved_at IS NOT NULL
```

---

<a id="tickets_with_sla_target_metric"></a>

### `tickets_with_sla_target_metric`

**Tickets With SLA Target Count**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `due_at` |

**Description:** Tickets that actually have a resolution-time SLA target assigned to them — the eligible pool for variance calculations.

**Formula:** `COUNT(*) WHERE due_at IS NOT NULL`

**SQL:**

```sql
SELECT COUNT(*)::int AS tickets_with_sla_target_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.due_at IS NOT NULL
```

---

<a id="average_resolution_hours_variance"></a>

### `average_resolution_hours_variance`

**Average Resolution Hours Variance vs SLA Target**

| | |
|--|--|
| Category | `sla` |
| Unit | `hours` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.sla_policies` |
| Key fields | `created_at`, `resolved_at`, `resolution_hours` |

**Description:** On average, how far off the SLA resolution target agents land — positive means typically resolving slower than promised.

**Formula:** `resolution_hours_variance_total / NULLIF(resolved SLA tickets, 0)`

**SQL:**

```sql
SELECT AVG(
  EXTRACT(EPOCH FROM (t.resolved_at - t.created_at)) / 3600.0 - sp.resolution_hours
) AS average_resolution_hours_variance
FROM ticketing.tickets t
JOIN ticketing.sla_policies sp
  ON sp.organization_id = t.organization_id
 AND sp.priority = t.priority
 AND COALESCE(sp.active, true) = true
WHERE t.organization_id = :org_id
  AND t.resolved_at IS NOT NULL
```

---

<a id="note_volume"></a>

### `note_volume`

**Ticket Note Volume**

| | |
|--|--|
| Category | `engagement` |
| Unit | `count` |
| Semantic model | `ticket_note` |
| Source tables | `ticketing.ticket_notes` |
| Key fields | `id`, `organization_id` |

**Description:** Count of rows in ticketing.ticket_notes — every note/reply on tickets in scope.

**Formula:** `COUNT(ticket_notes.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS note_volume
FROM ticketing.ticket_notes n
WHERE n.organization_id = :org_id
```

---

<a id="internal_note_volume"></a>

### `internal_note_volume`

**Internal Note Volume**

| | |
|--|--|
| Category | `engagement` |
| Unit | `count` |
| Semantic model | `ticket_note` |
| Source tables | `ticketing.ticket_notes` |
| Key fields | `visibility` |

**Description:** Notes marked internal-only — coordination and commentary agents leave that customers never see.

**Formula:** `COUNT(*) WHERE visibility = 'internal' OR visibility IS NULL`

**SQL:**

```sql
SELECT COUNT(*)::int AS internal_note_volume
FROM ticketing.ticket_notes n
WHERE n.organization_id = :org_id
  AND COALESCE(n.visibility, 'internal') = 'internal'
```

---

<a id="customer_reply_volume"></a>

### `customer_reply_volume`

**Customer-Visible Reply Volume**

| | |
|--|--|
| Category | `engagement` |
| Unit | `count` |
| Semantic model | `ticket_note` |
| Source tables | `ticketing.ticket_notes` |
| Key fields | `visibility` |

**Description:** Notes that were actually sent to the customer — the visible, outward-facing side of the conversation.

**Formula:** `COUNT(*) WHERE visibility = 'public'`

**SQL:**

```sql
SELECT COUNT(*)::int AS customer_reply_volume
FROM ticketing.ticket_notes n
WHERE n.organization_id = :org_id
  AND n.visibility = 'public'
```

---

<a id="internal_note_ratio"></a>

### `internal_note_ratio`

**Internal Note Ratio (internal / total notes)**

| | |
|--|--|
| Category | `engagement` |
| Unit | `ratio` |
| Semantic model | `ticket_note` |
| Source tables | `ticketing.ticket_notes` |
| Key fields | `visibility` |

**Description:** How much of the note activity is internal chatter versus customer-facing replies, as a ratio.

**Formula:** `internal_note_volume / NULLIF(note_volume, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE COALESCE(n.visibility, 'internal') = 'internal')::float
  / NULLIF(COUNT(*), 0) AS internal_note_ratio
FROM ticketing.ticket_notes n
WHERE n.organization_id = :org_id
```

---

<a id="average_notes_per_ticket"></a>

### `average_notes_per_ticket`

**Average Notes Per Ticket (cross-model: ticket_note vs ticket)**

| | |
|--|--|
| Category | `engagement` |
| Unit | `count` |
| Semantic model | `ticket_note (cross ticket)` |
| Source tables | `ticketing.ticket_notes`, `ticketing.tickets` |
| Key fields | `ticket_id`, `id` |

**Description:** On average, how many notes it takes to handle a single ticket start to finish — a cross-model measure of handling effort.

**Formula:** `note_volume / NULLIF(ticket_volume, 0)`

**SQL:**

```sql
SELECT
  (SELECT COUNT(*)::float FROM ticketing.ticket_notes n WHERE n.organization_id = :org_id)
  / NULLIF((SELECT COUNT(*) FROM ticketing.tickets t WHERE t.organization_id = :org_id), 0)
  AS average_notes_per_ticket
```

---

<a id="queue_coverage_count"></a>

### `queue_coverage_count`

**Queue Membership Count**

| | |
|--|--|
| Category | `staffing` |
| Unit | `count` |
| Semantic model | `agent_queue_member` |
| Source tables | `ticketing.agent_queue_members` |
| Key fields | `id`, `queue_id`, `user_id` |

**Description:** Every agent-to-queue assignment on record, tallied up — the raw footprint of staffing across queues.

**Formula:** `COUNT(agent_queue_members.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS queue_coverage_count
FROM ticketing.agent_queue_members m
WHERE m.organization_id = :org_id
```

---

<a id="distinct_agents_in_queues"></a>

### `distinct_agents_in_queues`

**Distinct Agents Covering Queues**

| | |
|--|--|
| Category | `staffing` |
| Unit | `count` |
| Semantic model | `agent_queue_member` |
| Source tables | `ticketing.agent_queue_members` |
| Key fields | `user_id` |

**Description:** The number of unique agents actively covering at least one queue.

**Formula:** `COUNT(DISTINCT user_id)`

**SQL:**

```sql
SELECT COUNT(DISTINCT m.user_id)::int AS distinct_agents_in_queues
FROM ticketing.agent_queue_members m
WHERE m.organization_id = :org_id
```

---

<a id="distinct_queues_covered"></a>

### `distinct_queues_covered`

**Distinct Queues Covered**

| | |
|--|--|
| Category | `staffing` |
| Unit | `count` |
| Semantic model | `agent_queue_member` |
| Source tables | `ticketing.agent_queue_members` |
| Key fields | `queue_id` |

**Description:** The number of unique queues that have at least one agent assigned to them.

**Formula:** `COUNT(DISTINCT queue_id)`

**SQL:**

```sql
SELECT COUNT(DISTINCT m.queue_id)::int AS distinct_queues_covered
FROM ticketing.agent_queue_members m
WHERE m.organization_id = :org_id
```

---

<a id="audit_event_volume"></a>

### `audit_event_volume`

**Audit Event Volume**

| | |
|--|--|
| Category | `governance` |
| Unit | `count` |
| Semantic model | `audit_event` |
| Source tables | `ticketing.audit_events` |
| Key fields | `id` |

**Description:** Every action logged in the audit trail against tickets, tallied up — the full activity log.

**Formula:** `COUNT(audit_events.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS audit_event_volume
FROM ticketing.audit_events a
WHERE a.organization_id = :org_id
```

---

<a id="escalation_volume"></a>

### `escalation_volume`

**Escalation Volume**

| | |
|--|--|
| Category | `governance` |
| Unit | `count` |
| Semantic model | `audit_event` |
| Source tables | `ticketing.audit_events` |
| Key fields | `action` |

**Description:** Count of audit_events where action indicates escalation (e.g. ticket.escalated). How often tickets are escalated to a higher tier/resolver.

**Formula:** `COUNT(*) WHERE action = 'ticket.escalated'`

**SQL:**

```sql
SELECT COUNT(*)::int AS escalation_volume
FROM ticketing.audit_events a
WHERE a.organization_id = :org_id
  AND a.action = 'ticket.escalated'
```

---

<a id="reassignment_volume"></a>

### `reassignment_volume`

**Reassignment (Assignment-Change) Volume**

| | |
|--|--|
| Category | `governance` |
| Unit | `count` |
| Semantic model | `audit_event` |
| Source tables | `ticketing.audit_events` |
| Key fields | `action` |

**Description:** Audit trail entries specifically flagged as ownership/assignment changes.

**Formula:** `COUNT(*) WHERE action IN ('ticket.assigned', 'ticket.resolver_set')`

**SQL:**

```sql
SELECT COUNT(*)::int AS reassignment_volume
FROM ticketing.audit_events a
WHERE a.organization_id = :org_id
  AND a.action IN ('ticket.assigned', 'ticket.resolver_set')
```

---

<a id="escalation_rate"></a>

### `escalation_rate`

**Escalation Rate (cross-model: audit_event vs ticket)**

| | |
|--|--|
| Category | `governance` |
| Unit | `ratio` |
| Semantic model | `audit_event (cross ticket)` |
| Source tables | `ticketing.audit_events`, `ticketing.tickets` |
| Key fields | `action`, `id` |

**Description:** How often tickets get escalated, expressed as a share of total ticket volume.

**Formula:** `escalation_volume / NULLIF(ticket_volume, 0)`

**SQL:**

```sql
SELECT
  (SELECT COUNT(*)::float FROM ticketing.audit_events a
    WHERE a.organization_id = :org_id AND a.action = 'ticket.escalated')
  / NULLIF((SELECT COUNT(*) FROM ticketing.tickets t WHERE t.organization_id = :org_id), 0)
  AS escalation_rate
```

---

<a id="recommendation_volume"></a>

### `recommendation_volume`

**Proactive Recommendation Volume**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_recommendation` |
| Source tables | `ticketing.proactive_recommendations` |
| Key fields | `id` |

**Description:** Every proactive suggestion the AI has surfaced, tallied up.

**Formula:** `COUNT(proactive_recommendations.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS recommendation_volume
FROM ticketing.proactive_recommendations r
WHERE r.organization_id = :org_id
```

---

<a id="accepted_recommendations_metric"></a>

### `accepted_recommendations_metric`

**Accepted Recommendation Count**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_recommendation` |
| Source tables | `ticketing.proactive_recommendations` |
| Key fields | `status` |

**Description:** AI-generated suggestions that an agent chose to act on.

**Formula:** `COUNT(*) WHERE status = 'accepted'`

**SQL:**

```sql
SELECT COUNT(*)::int AS accepted_recommendations_metric
FROM ticketing.proactive_recommendations r
WHERE r.organization_id = :org_id
  AND r.status = 'accepted'
```

---

<a id="dismissed_recommendations_metric"></a>

### `dismissed_recommendations_metric`

**Dismissed Recommendation Count**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_recommendation` |
| Source tables | `ticketing.proactive_recommendations` |
| Key fields | `status` |

**Description:** AI-generated suggestions that an agent chose to pass on.

**Formula:** `COUNT(*) WHERE status = 'dismissed'`

**SQL:**

```sql
SELECT COUNT(*)::int AS dismissed_recommendations_metric
FROM ticketing.proactive_recommendations r
WHERE r.organization_id = :org_id
  AND r.status = 'dismissed'
```

---

<a id="open_recommendations_metric"></a>

### `open_recommendations_metric`

**Open (Undecided) Recommendation Count**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_recommendation` |
| Source tables | `ticketing.proactive_recommendations` |
| Key fields | `status` |

**Description:** AI-generated suggestions still sitting without a decision either way.

**Formula:** `COUNT(*) WHERE status = 'open'`

**SQL:**

```sql
SELECT COUNT(*)::int AS open_recommendations_metric
FROM ticketing.proactive_recommendations r
WHERE r.organization_id = :org_id
  AND r.status = 'open'
```

---

<a id="recommendation_acceptance_rate"></a>

### `recommendation_acceptance_rate`

**Recommendation Acceptance Rate**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `ratio` |
| Semantic model | `proactive_recommendation` |
| Source tables | `ticketing.proactive_recommendations` |
| Key fields | `status` |

**Description:** Share of proactive recommendations that agents accepted: accepted / total recommendations from proactive_recommendations.

**Formula:** `accepted / NULLIF(total recommendations, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE r.status = 'accepted')::float
  / NULLIF(COUNT(*), 0) AS recommendation_acceptance_rate
FROM ticketing.proactive_recommendations r
WHERE r.organization_id = :org_id
```

---

<a id="approval_volume"></a>

### `approval_volume`

**Proactive Approval Volume**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_approval` |
| Source tables | `ticketing.proactive_approvals` |
| Key fields | `id` |

**Description:** Every request the AI has made for permission to take an action, tallied up.

**Formula:** `COUNT(proactive_approvals.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS approval_volume
FROM ticketing.proactive_approvals a
WHERE a.organization_id = :org_id
```

---

<a id="approved_metric"></a>

### `approved_metric`

**Approved Action Count**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_approval` |
| Source tables | `ticketing.proactive_approvals` |
| Key fields | `status` |

**Description:** AI action requests that a human signed off on.

**Formula:** `COUNT(*) WHERE status = 'approved'`

**SQL:**

```sql
SELECT COUNT(*)::int AS approved_metric
FROM ticketing.proactive_approvals a
WHERE a.organization_id = :org_id
  AND a.status = 'approved'
```

---

<a id="rejected_metric"></a>

### `rejected_metric`

**Rejected Action Count**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_approval` |
| Source tables | `ticketing.proactive_approvals` |
| Key fields | `status` |

**Description:** AI action requests that a human turned down.

**Formula:** `COUNT(*) WHERE status = 'rejected'`

**SQL:**

```sql
SELECT COUNT(*)::int AS rejected_metric
FROM ticketing.proactive_approvals a
WHERE a.organization_id = :org_id
  AND a.status = 'rejected'
```

---

<a id="approval_rate"></a>

### `approval_rate`

**Approval Rate**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `ratio` |
| Semantic model | `proactive_approval` |
| Source tables | `ticketing.proactive_approvals` |
| Key fields | `status` |

**Description:** Share of proactive approval requests that humans approved: approved / total from proactive_approvals.

**Formula:** `approved / NULLIF(total approvals, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE a.status = 'approved')::float
  / NULLIF(COUNT(*), 0) AS approval_rate
FROM ticketing.proactive_approvals a
WHERE a.organization_id = :org_id
```

---

<a id="decision_hours_total"></a>

### `decision_hours_total`

**Approval Decision Hours (sum)**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `hours` |
| Semantic model | `proactive_approval` |
| Source tables | `ticketing.proactive_approvals` |
| Key fields | `created_at`, `decided_at` |

**Description:** The combined turnaround time across every approval decision, summed — a raw building block behind the average.

**Formula:** `SUM(EXTRACT(EPOCH FROM (decided_at - created_at))/3600) WHERE decided_at IS NOT NULL`

**SQL:**

```sql
SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (a.decided_at - a.created_at)) / 3600.0), 0)
  AS decision_hours_total
FROM ticketing.proactive_approvals a
WHERE a.organization_id = :org_id
  AND a.decided_at IS NOT NULL
```

---

<a id="decided_approvals_metric"></a>

### `decided_approvals_metric`

**Decided Approval Count**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_approval` |
| Source tables | `ticketing.proactive_approvals` |
| Key fields | `status`, `decided_at` |

**Description:** Approval requests that have reached a final decision, either way — the denominator for average turnaround.

**Formula:** `COUNT(*) WHERE status IN ('approved','rejected') OR decided_at IS NOT NULL`

**SQL:**

```sql
SELECT COUNT(*)::int AS decided_approvals_metric
FROM ticketing.proactive_approvals a
WHERE a.organization_id = :org_id
  AND a.decided_at IS NOT NULL
```

---

<a id="average_decision_hours"></a>

### `average_decision_hours`

**Average Approval Decision Time (hours)**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `hours` |
| Semantic model | `proactive_approval` |
| Source tables | `ticketing.proactive_approvals` |
| Key fields | `created_at`, `decided_at` |

**Description:** On average, how many hours it takes a human to approve or reject an AI action request.

**Formula:** `AVG(EXTRACT(EPOCH FROM (decided_at - created_at))/3600) WHERE decided_at IS NOT NULL`

**SQL:**

```sql
SELECT AVG(EXTRACT(EPOCH FROM (a.decided_at - a.created_at)) / 3600.0)
  AS average_decision_hours
FROM ticketing.proactive_approvals a
WHERE a.organization_id = :org_id
  AND a.decided_at IS NOT NULL
```

---

<a id="due_today_tickets_metric"></a>

### `due_today_tickets_metric`

**Tickets Due Today**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.organizations` |
| Key fields | `due_at`, `status`, `display_timezone` |

**Description:** Count of unresolved tickets whose due_at falls on the organization's local calendar today. Matches the dashboard_metrics.due_today KPI from ticketing.tickets.due_at.

**Formula:** `COUNT unresolved WHERE date(due_at AT TZ org) = date(now AT TZ org)`

**SQL:**

```sql
SELECT COUNT(*)::int AS due_today_tickets_metric
FROM ticketing.tickets t
JOIN ticketing.organizations o ON o.id = t.organization_id
WHERE t.organization_id = :org_id
  AND t.status <> 'Resolved'
  AND t.due_at IS NOT NULL
  AND (t.due_at AT TIME ZONE COALESCE(NULLIF(o.display_timezone, ''), 'UTC'))::date
    = (NOW() AT TIME ZONE COALESCE(NULLIF(o.display_timezone, ''), 'UTC'))::date
```

---

<a id="current_overdue_tickets_metric"></a>

### `current_overdue_tickets_metric`

**Current Overdue Ticket Count**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `due_at`, `resolved_at`, `status`, `is_terminal` |

**Description:** Count of currently unresolved tickets that are past their SLA deadline (status Overdue and/or due_at < now with resolved_at null and non-terminal status). Live overdue workload — not the same as historical breached_tickets_metric.

**Formula:** `status = 'Overdue' OR (due_at < now AND unresolved AND not terminal)`

**SQL:**

```sql
SELECT COUNT(*)::int AS current_overdue_tickets_metric
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND (
    t.status = 'Overdue'
    OR (
      t.due_at IS NOT NULL
      AND t.due_at < NOW()
      AND t.resolved_at IS NULL
      AND COALESCE(ts.is_terminal, false) = false
    )
  )
```

---

<a id="tickets_created_today_metric"></a>

### `tickets_created_today_metric`

**Tickets Created Today**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.organizations` |
| Key fields | `created_at`, `display_timezone` |

**Description:** Count of tickets whose created_at falls on the organization's local calendar today. Matches the dashboard createdToday KPI.

**Formula:** `COUNT WHERE date(created_at AT TZ org) = date(now AT TZ org)`

**SQL:**

```sql
SELECT COUNT(*)::int AS tickets_created_today_metric
FROM ticketing.tickets t
JOIN ticketing.organizations o ON o.id = t.organization_id
WHERE t.organization_id = :org_id
  AND (t.created_at AT TIME ZONE COALESCE(NULLIF(o.display_timezone, ''), 'UTC'))::date
    = (NOW() AT TIME ZONE COALESCE(NULLIF(o.display_timezone, ''), 'UTC'))::date
```

---

<a id="tickets_last_30_days"></a>

### `tickets_last_30_days`

**Tickets in Last 30 Days**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at` |

**Description:** Count of tickets created in the rolling last 30 days (created_at >= now() − 30 days). Recent demand signal; not calendar-month bounded.

**Formula:** `COUNT(*) WHERE created_at >= now() - interval '30 days'`

**SQL:**

```sql
SELECT COUNT(*)::int AS tickets_last_30_days
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.created_at >= NOW() - INTERVAL '30 days'
```

---

<a id="days_since_last_ticket"></a>

### `days_since_last_ticket`

**Days Since Last Ticket**

| | |
|--|--|
| Category | `volume` |
| Unit | `days` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at` |

**Description:** Number of calendar days since the most recent ticket created_at in scope (CURRENT_DATE − DATE(MAX(created_at))). Support-recency metric; null if no tickets. Companion field last_ticket_at is the timestamp of that latest ticket.

**Formula:** `CURRENT_DATE - DATE(MAX(created_at)); NULL if no tickets`

**SQL:**

```sql
SELECT
  CASE WHEN MAX(t.created_at) IS NULL THEN NULL
       ELSE (CURRENT_DATE - MAX(t.created_at)::date)
  END AS days_since_last_ticket
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="unanswered_tickets_metric"></a>

### `unanswered_tickets_metric`

**Unanswered Ticket Count (no first response)**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `first_response_at` |

**Description:** Count of tickets where first_response_at is null — no staff first response recorded yet. Excluded from average first-response time; tracked separately as unanswered volume.

**Formula:** `COUNT(*) WHERE first_response_at IS NULL`

**SQL:**

```sql
SELECT COUNT(*)::int AS unanswered_tickets_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.first_response_at IS NULL
```

---

<a id="resolution_sla_met_metric"></a>

### `resolution_sla_met_metric`

**Resolution SLA Met Count**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `resolved_at`, `due_at` |

**Description:** Count of resolved tickets with a due_at where resolved_at <= due_at (resolution SLA met). Numerator for resolution SLA compliance rate.

**Formula:** `COUNT where resolved_at IS NOT NULL AND due_at IS NOT NULL AND resolved_at <= due_at`

**SQL:**

```sql
SELECT COUNT(*)::int AS resolution_sla_met_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.resolved_at IS NOT NULL
  AND t.due_at IS NOT NULL
  AND t.resolved_at <= t.due_at
```

---

<a id="resolution_sla_compliance_rate"></a>

### `resolution_sla_compliance_rate`

**Resolution SLA Compliance Rate**

| | |
|--|--|
| Category | `sla` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `resolved_at`, `due_at` |

**Description:** Share of resolved tickets with a due_at that met the deadline: sla_met / tickets_with_sla (resolved_at IS NOT NULL AND due_at IS NOT NULL). Complement of sla_breach_rate for completed tickets.

**Formula:** `resolution_sla_met / NULLIF(COUNT resolved with due_at, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (
    WHERE t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at <= t.due_at
  )::float
  / NULLIF(COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL), 0)
  AS resolution_sla_compliance_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="reopened_tickets_metric"></a>

### `reopened_tickets_metric`

**Reopened Ticket Count**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `status` |

**Description:** Count of tickets currently (or historically, per filter) in Reopened status — cases that returned to active work after being resolved.

**Formula:** `COUNT(*) WHERE status = 'Reopened'`

**SQL:**

```sql
SELECT COUNT(*)::int AS reopened_tickets_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.status = 'Reopened'
```

---

<a id="average_first_response_minutes"></a>

### `average_first_response_minutes`

**Average First Response Time (minutes)**

| | |
|--|--|
| Category | `sla` |
| Unit | `minutes` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at`, `first_response_at` |

**Description:** Mean minutes from created_at to first_response_at for tickets with a first response. Finer-grained twin of average_first_response_hours; matches analytics avg_first_mins.

**Formula:** `AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60)`

**SQL:**

```sql
SELECT AVG(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)) / 60.0)
  AS average_first_response_minutes
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.first_response_at IS NOT NULL
```

---

<a id="pending_approvals_metric"></a>

### `pending_approvals_metric`

**Pending (Undecided) Approval Count**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_approval` |
| Source tables | `ticketing.proactive_approvals` |
| Key fields | `status` |

**Description:** Count of proactive_approvals still in pending status — AI action requests awaiting a human approve/reject decision.

**Formula:** `COUNT(*) WHERE status = 'pending'`

**SQL:**

```sql
SELECT COUNT(*)::int AS pending_approvals_metric
FROM ticketing.proactive_approvals a
WHERE a.organization_id = :org_id
  AND a.status = 'pending'
```

---

<a id="high_priority_open_tickets_metric"></a>

### `high_priority_open_tickets_metric`

**High/Urgent Open Ticket Count**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `priority`, `status`, `is_terminal` |

**Description:** Count of non-terminal tickets with priority high or urgent. Severity-weighted open workload from tickets.priority.

**Formula:** `COUNT open WHERE lower(priority) IN ('high','urgent')`

**SQL:**

```sql
SELECT COUNT(*)::int AS high_priority_open_tickets_metric
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND COALESCE(ts.is_terminal, false) = false
  AND lower(t.priority) IN ('high', 'urgent')
```

---

<a id="tickets_with_resolver_metric"></a>

### `tickets_with_resolver_metric`

**Tickets With Resolver Assigned Count**

| | |
|--|--|
| Category | `staffing` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `resolver_id`, `resolver_name` |

**Description:** Count of tickets where resolver_id / resolver_name is set (L2 resolver assigned). Uses ticketing.tickets resolver fields.

**Formula:** `COUNT(*) WHERE resolver_id IS NOT NULL OR resolver_name IS NOT NULL`

**SQL:**

```sql
SELECT COUNT(*)::int AS tickets_with_resolver_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND (t.resolver_id IS NOT NULL OR NULLIF(trim(t.resolver_name), '') IS NOT NULL)
```

---

<a id="closed_tickets_metric"></a>

### `closed_tickets_metric`

**Closed Ticket Count**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `status`, `is_terminal` |

**Description:** Count of tickets whose status is closed/terminal (is_closed_by_status = true or ticket_statuses.is_terminal = true, typically Resolved). Complement of active_tickets_metric.

**Formula:** `COUNT(*) WHERE is_terminal = true (typically Resolved)`

**SQL:**

```sql
SELECT COUNT(*)::int AS closed_tickets_metric
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND (COALESCE(ts.is_terminal, false) = true OR t.status = 'Resolved')
```

---

<a id="pending_tickets_metric"></a>

### `pending_tickets_metric`

**Pending / In-Progress Ticket Count**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `status` |

**Description:** Count of tickets currently in Pending (often displayed as In Progress) status. A subset of active tickets from ticketing.tickets.status.

**Formula:** `COUNT(*) WHERE status = 'Pending'`

**SQL:**

```sql
SELECT COUNT(*)::int AS pending_tickets_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.status = 'Pending'
```

---

<a id="assigned_tickets_metric"></a>

### `assigned_tickets_metric`

**Assigned Ticket Count**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `assignee_name`, `assignee_id` |

**Description:** Count of tickets that have an assignee (assignee_name is present and not Unassigned). Complement of unassigned_tickets_metric.

**Formula:** `COUNT(*) WHERE assignee present and not 'Unassigned'`

**SQL:**

```sql
SELECT COUNT(*)::int AS assigned_tickets_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.assignee_id IS NOT NULL
  AND t.assignee_name IS DISTINCT FROM 'Unassigned'
```

---

<a id="assignment_rate"></a>

### `assignment_rate`

**Assignment Rate**

| | |
|--|--|
| Category | `volume` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `assignee_id`, `assignee_name` |

**Description:** Share of tickets that have an assignee: assigned_tickets / ticket_volume. Complement of unassignment_rate.

**Formula:** `assigned_tickets_metric / NULLIF(ticket_volume, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (
    WHERE t.assignee_id IS NOT NULL AND t.assignee_name IS DISTINCT FROM 'Unassigned'
  )::float / NULLIF(COUNT(*), 0) AS assignment_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="tickets_last_7_days"></a>

### `tickets_last_7_days`

**Tickets in Last 7 Days**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at` |

**Description:** Count of tickets created in the rolling last 7 days (created_at >= now() − 7 days). Short-window demand signal.

**Formula:** `COUNT(*) WHERE created_at >= now() - interval '7 days'`

**SQL:**

```sql
SELECT COUNT(*)::int AS tickets_last_7_days
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.created_at >= NOW() - INTERVAL '7 days'
```

---

<a id="average_tickets_per_day"></a>

### `average_tickets_per_day`

**Average Tickets Per Day**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `created_at` |

**Description:** Average number of tickets created per day in the selected range (ticket_volume / day_span). Matches analytics avgTicketsPerDay.

**Formula:** `ticket_volume_in_range / NULLIF(day_span, 0)`

**SQL:**

```sql
SELECT
  COUNT(*)::float
  / NULLIF(GREATEST(1, CEIL(EXTRACT(EPOCH FROM (MAX(t.created_at) - MIN(t.created_at))) / 86400.0)), 0)
  AS average_tickets_per_day
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  /* prefer: COUNT(*) / day_span of explicit :range_start..:range_end */
```

---

<a id="reopen_rate"></a>

### `reopen_rate`

**Reopen Rate**

| | |
|--|--|
| Category | `quality` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `status` |

**Description:** Share of tickets that were reopened relative to resolved/closed volume (reopened_tickets / resolved_tickets). Quality/stability signal.

**Formula:** `COUNT(status='Reopened') / NULLIF(COUNT(resolved/closed), 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE t.status = 'Reopened')::float
  / NULLIF(COUNT(*) FILTER (WHERE t.status = 'Resolved'), 0)
  AS reopen_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="first_response_coverage_rate"></a>

### `first_response_coverage_rate`

**First Response Coverage Rate**

| | |
|--|--|
| Category | `sla` |
| Unit | `ratio` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `first_response_at` |

**Description:** Share of tickets that have received a first staff response: tickets_with_first_response / ticket_volume. Complement of unanswered volume.

**Formula:** `tickets_with_first_response / NULLIF(ticket_volume, 0)`

**SQL:**

```sql
SELECT
  COUNT(*) FILTER (WHERE t.first_response_at IS NOT NULL)::float
  / NULLIF(COUNT(*), 0) AS first_response_coverage_rate
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
```

---

<a id="sla_at_risk_tickets_metric"></a>

### `sla_at_risk_tickets_metric`

**SLA At-Risk Ticket Count (due soon)**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `due_at`, `resolved_at`, `status` |

**Description:** Count of unresolved tickets whose due_at is approaching (e.g. within ~4 hours) but not yet past due. Near-breach / at-risk workload aligned with SEMA SLA checks.

**Formula:** `unresolved AND due_at BETWEEN now() AND now()+4 hours`

**SQL:**

```sql
SELECT COUNT(*)::int AS sla_at_risk_tickets_metric
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND COALESCE(ts.is_terminal, false) = false
  AND t.resolved_at IS NULL
  AND t.due_at IS NOT NULL
  AND t.due_at > NOW()
  AND t.due_at <= NOW() + INTERVAL '4 hours'
```

---

<a id="tickets_without_resolver_metric"></a>

### `tickets_without_resolver_metric`

**Tickets Without Resolver Count**

| | |
|--|--|
| Category | `staffing` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `resolver_id`, `resolver_name` |

**Description:** Count of tickets where resolver_id/resolver_name is null or empty — no L2 resolver assigned yet.

**Formula:** `COUNT(*) WHERE resolver_id IS NULL AND resolver_name IS NULL/empty`

**SQL:**

```sql
SELECT COUNT(*)::int AS tickets_without_resolver_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.resolver_id IS NULL
  AND NULLIF(trim(COALESCE(t.resolver_name, '')), '') IS NULL
```

---

<a id="average_overdue_hours"></a>

### `average_overdue_hours`

**Average Overdue Hours**

| | |
|--|--|
| Category | `sla` |
| Unit | `hours` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets`, `ticketing.ticket_statuses` |
| Key fields | `due_at`, `resolved_at` |

**Description:** Mean hours past due_at for currently overdue/unresolved tickets: AVG(now − due_at) where due_at < now and ticket is still open. Measures how late the overdue backlog is.

**Formula:** `AVG(EXTRACT(EPOCH FROM (now() - due_at))/3600) for current overdue`

**SQL:**

```sql
SELECT AVG(EXTRACT(EPOCH FROM (NOW() - t.due_at)) / 3600.0)
  AS average_overdue_hours
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
WHERE t.organization_id = :org_id
  AND t.due_at IS NOT NULL
  AND t.due_at < NOW()
  AND t.resolved_at IS NULL
  AND COALESCE(ts.is_terminal, false) = false
```

---

<a id="kb_article_volume"></a>

### `kb_article_volume`

**Knowledge Base Article Count**

| | |
|--|--|
| Category | `knowledge` |
| Unit | `count` |
| Semantic model | `kb_article` |
| Source tables | `ticketing.kb_articles` |
| Key fields | `id` |

**Description:** Count of knowledge base articles in ticketing.kb_articles for the organization.

**Formula:** `COUNT(kb_articles.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS kb_article_volume
FROM ticketing.kb_articles k
WHERE k.organization_id = :org_id
```

---

<a id="kb_published_article_metric"></a>

### `kb_published_article_metric`

**Published KB Article Count**

| | |
|--|--|
| Category | `knowledge` |
| Unit | `count` |
| Semantic model | `kb_article` |
| Source tables | `ticketing.kb_articles` |
| Key fields | `status` |

**Description:** Count of kb_articles with status Published — articles visible in help center / retrieval.

**Formula:** `COUNT(*) WHERE status = 'Published'`

**SQL:**

```sql
SELECT COUNT(*)::int AS kb_published_article_metric
FROM ticketing.kb_articles k
WHERE k.organization_id = :org_id
  AND k.status = 'Published'
```

---

<a id="kb_views_total"></a>

### `kb_views_total`

**KB Article Views (sum)**

| | |
|--|--|
| Category | `knowledge` |
| Unit | `count` |
| Semantic model | `kb_article` |
| Source tables | `ticketing.kb_articles` |
| Key fields | `views` |

**Description:** Sum of views across kb_articles.views — total knowledge-base article traffic.

**Formula:** `SUM(views)`

**SQL:**

```sql
SELECT COALESCE(SUM(k.views), 0)::int AS kb_views_total
FROM ticketing.kb_articles k
WHERE k.organization_id = :org_id
```

---

<a id="macro_volume"></a>

### `macro_volume`

**Macro Template Count**

| | |
|--|--|
| Category | `knowledge` |
| Unit | `count` |
| Semantic model | `macro` |
| Source tables | `ticketing.macros` |
| Key fields | `id` |

**Description:** Count of saved reply macros/templates in ticketing.macros for the organization.

**Formula:** `COUNT(macros.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS macro_volume
FROM ticketing.macros m
WHERE m.organization_id = :org_id
```

---

<a id="notification_volume"></a>

### `notification_volume`

**Staff Notification Volume**

| | |
|--|--|
| Category | `engagement` |
| Unit | `count` |
| Semantic model | `notification` |
| Source tables | `ticketing.notifications` |
| Key fields | `id` |

**Description:** Count of in-app staff notifications in ticketing.notifications.

**Formula:** `COUNT(notifications.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS notification_volume
FROM ticketing.notifications n
WHERE n.organization_id = :org_id
```

---

<a id="unread_notifications_metric"></a>

### `unread_notifications_metric`

**Unread Notification Count**

| | |
|--|--|
| Category | `engagement` |
| Unit | `count` |
| Semantic model | `notification` |
| Source tables | `ticketing.notifications` |
| Key fields | `is_read` |

**Description:** Count of notifications where is_read = false — unread staff alert backlog.

**Formula:** `COUNT(*) WHERE is_read = false`

**SQL:**

```sql
SELECT COUNT(*)::int AS unread_notifications_metric
FROM ticketing.notifications n
WHERE n.organization_id = :org_id
  AND COALESCE(n.is_read, false) = false
```

---

<a id="outbound_email_volume"></a>

### `outbound_email_volume`

**Outbound Email Volume**

| | |
|--|--|
| Category | `engagement` |
| Unit | `count` |
| Semantic model | `outbound_email` |
| Source tables | `ticketing.outbound_email_log` |
| Key fields | `id` |

**Description:** Count of rows in ticketing.outbound_email_log — emails sent for ticket created/reply/resolved/SLA.

**Formula:** `COUNT(outbound_email_log.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS outbound_email_volume
FROM ticketing.outbound_email_log e
WHERE e.organization_id = :org_id
```

---

<a id="active_customers_metric"></a>

### `active_customers_metric`

**Active Customers in Directory**

| | |
|--|--|
| Category | `volume` |
| Unit | `count` |
| Semantic model | `customer` |
| Source tables | `ticketing.customers` |
| Key fields | `status` |

**Description:** Count of customers in ticketing.customers with status Active — directory size, not the same as customers_served (which counts distinct customers with tickets).

**Formula:** `COUNT(*) WHERE status = 'Active'`

**SQL:**

```sql
SELECT COUNT(*)::int AS active_customers_metric
FROM ticketing.customers c
WHERE c.organization_id = :org_id
  AND c.status = 'Active'
```

---

<a id="active_agents_metric"></a>

### `active_agents_metric`

**Active Agent Headcount**

| | |
|--|--|
| Category | `staffing` |
| Unit | `count` |
| Semantic model | `user` |
| Source tables | `ticketing.users` |
| Key fields | `role`, `status` |

**Description:** Count of users with an agent/resolver/admin staff role and Active status in ticketing.users — available support headcount.

**Formula:** `COUNT(*) WHERE status='Active' AND role IN ('admin','agent','resolver')`

**SQL:**

```sql
SELECT COUNT(*)::int AS active_agents_metric
FROM ticketing.users u
WHERE u.organization_id = :org_id
  AND u.status = 'Active'
  AND u.role IN ('admin', 'agent', 'resolver')
```

---

<a id="queue_count"></a>

### `queue_count`

**Support Queue Count**

| | |
|--|--|
| Category | `staffing` |
| Unit | `count` |
| Semantic model | `agent_queue` |
| Source tables | `ticketing.agent_queues` |
| Key fields | `id` |

**Description:** Count of agent queues/teams in ticketing.agent_queues for the organization.

**Formula:** `COUNT(agent_queues.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS queue_count
FROM ticketing.agent_queues q
WHERE q.organization_id = :org_id
```

---

<a id="queues_at_risk_metric"></a>

### `queues_at_risk_metric`

**Queues At Risk Count**

| | |
|--|--|
| Category | `sla` |
| Unit | `count` |
| Semantic model | `agent_queue` |
| Source tables | `ticketing.agent_queues` |
| Key fields | `sla_status` |

**Description:** Count of agent_queues where sla_status = At Risk (queue has overdue tickets).

**Formula:** `COUNT(*) WHERE sla_status = 'At Risk'`

**SQL:**

```sql
SELECT COUNT(*)::int AS queues_at_risk_metric
FROM ticketing.agent_queues q
WHERE q.organization_id = :org_id
  AND q.sla_status = 'At Risk'
```

---

<a id="proactive_audit_volume"></a>

### `proactive_audit_volume`

**Proactive Agent Audit Event Volume**

| | |
|--|--|
| Category | `ai_automation` |
| Unit | `count` |
| Semantic model | `proactive_audit` |
| Source tables | `ticketing.proactive_audit` |
| Key fields | `id` |

**Description:** Count of rows in proactive_audit — logged proactive agent decisions/tool use.

**Formula:** `COUNT(proactive_audit.id)`

**SQL:**

```sql
SELECT COUNT(*)::int AS proactive_audit_volume
FROM ticketing.proactive_audit a
WHERE a.organization_id = :org_id
```

---

<a id="csat_neutral_metric"></a>

### `csat_neutral_metric`

**CSAT Neutral Count (score = 3)**

| | |
|--|--|
| Category | `quality` |
| Unit | `count` |
| Semantic model | `ticket` |
| Source tables | `ticketing.tickets` |
| Key fields | `csat_score` |

**Description:** Count of rated tickets with csat_score = 3 — neutral/mid satisfaction responses.

**Formula:** `COUNT(*) WHERE csat_score = 3`

**SQL:**

```sql
SELECT COUNT(*)::int AS csat_neutral_metric
FROM ticketing.tickets t
WHERE t.organization_id = :org_id
  AND t.csat_score = 3
```

---

## Quick formula cheat sheet

| metric_id | Formula |
|-----------|---------|
| `ticket_volume` | COUNT(tickets.id) |
| `resolved_tickets_metric` | COUNT(*) WHERE status = 'Resolved' OR is_terminal = true |
| `open_tickets_metric` | COUNT(*) WHERE NOT is_terminal (Open/Pending/Reopened/Overdue) |
| `active_tickets_metric` | Same as open_tickets_metric — status not closed/terminal |
| `resolution_rate` | resolved_tickets_metric / NULLIF(ticket_volume, 0) |
| `unassigned_tickets_metric` | COUNT(*) WHERE status <> Resolved AND (assignee_name IS NULL OR assignee_name = 'Unassigned') |
| `unassignment_rate` | unassigned_tickets_metric / NULLIF(ticket_volume, 0) |
| `customers_served` | COUNT(DISTINCT customer_id) — or DISTINCT lower(customer_email) if id null |
| `accounts_served` | COUNT(DISTINCT customers.account_id) WHERE account_id IS NOT NULL |
| `open_ticket_age_days_total` | SUM(EXTRACT(EPOCH FROM (now() - created_at))/86400) for open tickets |
| `average_open_ticket_age_days` | open_ticket_age_days_total / NULLIF(open_tickets_metric, 0)  OR  AVG(age_days) |
| `breached_tickets_metric` | COUNT where (resolved_at > due_at) OR (resolved_at IS NULL AND due_at < now()) |
| `sla_breach_rate` | breached_tickets_metric / NULLIF(tickets_with_sla_target_metric, 0) |
| `resolution_hours_total` | SUM(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) WHERE resolved_at IS NOT NULL |
| `resolved_for_avg` | COUNT(*) WHERE resolved_at IS NOT NULL |
| `average_resolution_time_hours` | AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) WHERE resolved_at IS NOT NULL |
| `first_response_hours_total` | SUM(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) WHERE first_response_at IS NOT NULL |
| `tickets_with_first_response_metric` | COUNT(*) WHERE first_response_at IS NOT NULL |
| `average_first_response_hours` | AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) WHERE first_response_at IS NOT NULL |
| `first_response_sla_met_metric` | COUNT where first_response_at <= created_at + first_response_hours |
| `tickets_with_first_response_sla_target_metric` | COUNT tickets that join an active sla_policies row for their priority |
| `first_response_sla_compliance_rate` | first_response_sla_met / NULLIF(tickets_with_first_response among eligible, 0) |
| `csat_score_total` | SUM(csat_score) WHERE csat_score IS NOT NULL |
| `csat_rated_metric` | COUNT(*) WHERE csat_score IS NOT NULL |
| `average_csat_score` | AVG(csat_score) WHERE csat_score IS NOT NULL (scale 1–5) |
| `csat_response_rate` | COUNT(csat rated among resolved) / NULLIF(COUNT(resolved), 0) |
| `csat_promoter_metric` | COUNT(*) WHERE csat_score >= 4 |
| `csat_detractor_metric` | COUNT(*) WHERE csat_score <= 2 |
| `csat_promoter_rate` | csat_promoter_metric / NULLIF(csat_rated_metric, 0) |
| `csat_detractor_rate` | csat_detractor_metric / NULLIF(csat_rated_metric, 0) |
| `resolution_hours_variance_total` | SUM(actual_resolution_hours - resolution_hours) for SLA-eligible resolved tickets |
| `tickets_with_sla_target_metric` | COUNT(*) WHERE due_at IS NOT NULL |
| `average_resolution_hours_variance` | resolution_hours_variance_total / NULLIF(resolved SLA tickets, 0) |
| `note_volume` | COUNT(ticket_notes.id) |
| `internal_note_volume` | COUNT(*) WHERE visibility = 'internal' OR visibility IS NULL |
| `customer_reply_volume` | COUNT(*) WHERE visibility = 'public' |
| `internal_note_ratio` | internal_note_volume / NULLIF(note_volume, 0) |
| `average_notes_per_ticket` | note_volume / NULLIF(ticket_volume, 0) |
| `queue_coverage_count` | COUNT(agent_queue_members.id) |
| `distinct_agents_in_queues` | COUNT(DISTINCT user_id) |
| `distinct_queues_covered` | COUNT(DISTINCT queue_id) |
| `audit_event_volume` | COUNT(audit_events.id) |
| `escalation_volume` | COUNT(*) WHERE action = 'ticket.escalated' |
| `reassignment_volume` | COUNT(*) WHERE action IN ('ticket.assigned', 'ticket.resolver_set') |
| `escalation_rate` | escalation_volume / NULLIF(ticket_volume, 0) |
| `recommendation_volume` | COUNT(proactive_recommendations.id) |
| `accepted_recommendations_metric` | COUNT(*) WHERE status = 'accepted' |
| `dismissed_recommendations_metric` | COUNT(*) WHERE status = 'dismissed' |
| `open_recommendations_metric` | COUNT(*) WHERE status = 'open' |
| `recommendation_acceptance_rate` | accepted / NULLIF(total recommendations, 0) |
| `approval_volume` | COUNT(proactive_approvals.id) |
| `approved_metric` | COUNT(*) WHERE status = 'approved' |
| `rejected_metric` | COUNT(*) WHERE status = 'rejected' |
| `approval_rate` | approved / NULLIF(total approvals, 0) |
| `decision_hours_total` | SUM(EXTRACT(EPOCH FROM (decided_at - created_at))/3600) WHERE decided_at IS NOT NULL |
| `decided_approvals_metric` | COUNT(*) WHERE status IN ('approved','rejected') OR decided_at IS NOT NULL |
| `average_decision_hours` | AVG(EXTRACT(EPOCH FROM (decided_at - created_at))/3600) WHERE decided_at IS NOT NULL |
| `due_today_tickets_metric` | COUNT unresolved WHERE date(due_at AT TZ org) = date(now AT TZ org) |
| `current_overdue_tickets_metric` | status = 'Overdue' OR (due_at < now AND unresolved AND not terminal) |
| `tickets_created_today_metric` | COUNT WHERE date(created_at AT TZ org) = date(now AT TZ org) |
| `tickets_last_30_days` | COUNT(*) WHERE created_at >= now() - interval '30 days' |
| `days_since_last_ticket` | CURRENT_DATE - DATE(MAX(created_at)); NULL if no tickets |
| `unanswered_tickets_metric` | COUNT(*) WHERE first_response_at IS NULL |
| `resolution_sla_met_metric` | COUNT where resolved_at IS NOT NULL AND due_at IS NOT NULL AND resolved_at <= due_at |
| `resolution_sla_compliance_rate` | resolution_sla_met / NULLIF(COUNT resolved with due_at, 0) |
| `reopened_tickets_metric` | COUNT(*) WHERE status = 'Reopened' |
| `average_first_response_minutes` | AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/60) |
| `pending_approvals_metric` | COUNT(*) WHERE status = 'pending' |
| `high_priority_open_tickets_metric` | COUNT open WHERE lower(priority) IN ('high','urgent') |
| `tickets_with_resolver_metric` | COUNT(*) WHERE resolver_id IS NOT NULL OR resolver_name IS NOT NULL |
| `closed_tickets_metric` | COUNT(*) WHERE is_terminal = true (typically Resolved) |
| `pending_tickets_metric` | COUNT(*) WHERE status = 'Pending' |
| `assigned_tickets_metric` | COUNT(*) WHERE assignee present and not 'Unassigned' |
| `assignment_rate` | assigned_tickets_metric / NULLIF(ticket_volume, 0) |
| `tickets_last_7_days` | COUNT(*) WHERE created_at >= now() - interval '7 days' |
| `average_tickets_per_day` | ticket_volume_in_range / NULLIF(day_span, 0) |
| `reopen_rate` | COUNT(status='Reopened') / NULLIF(COUNT(resolved/closed), 0) |
| `first_response_coverage_rate` | tickets_with_first_response / NULLIF(ticket_volume, 0) |
| `sla_at_risk_tickets_metric` | unresolved AND due_at BETWEEN now() AND now()+4 hours |
| `tickets_without_resolver_metric` | COUNT(*) WHERE resolver_id IS NULL AND resolver_name IS NULL/empty |
| `average_overdue_hours` | AVG(EXTRACT(EPOCH FROM (now() - due_at))/3600) for current overdue |
| `kb_article_volume` | COUNT(kb_articles.id) |
| `kb_published_article_metric` | COUNT(*) WHERE status = 'Published' |
| `kb_views_total` | SUM(views) |
| `macro_volume` | COUNT(macros.id) |
| `notification_volume` | COUNT(notifications.id) |
| `unread_notifications_metric` | COUNT(*) WHERE is_read = false |
| `outbound_email_volume` | COUNT(outbound_email_log.id) |
| `active_customers_metric` | COUNT(*) WHERE status = 'Active' |
| `active_agents_metric` | COUNT(*) WHERE status='Active' AND role IN ('admin','agent','resolver') |
| `queue_count` | COUNT(agent_queues.id) |
| `queues_at_risk_metric` | COUNT(*) WHERE sla_status = 'At Risk' |
| `proactive_audit_volume` | COUNT(proactive_audit.id) |
| `csat_neutral_metric` | COUNT(*) WHERE csat_score = 3 |
