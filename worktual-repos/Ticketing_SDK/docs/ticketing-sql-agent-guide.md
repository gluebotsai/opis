# Ticketing SQL Agent — purpose, schema map, scopes & metrics

**Audience:** builders of a **SELECT-only SQL agent** that answers analytics and listing questions against Worktual Ticketing.  
**Primary schema:** `ticketing` (Postgres). Hub joins to `accounts.*` and `cdp.*` are allowed **for identity / lookup only** (still SELECT).  
**Related deep docs:**

| Doc | Use when |
|-----|----------|
| [ticketing-table-catalog.md](./ticketing-table-catalog.md) | Column-level detail + samples |
| [ticketing-accounts-agent-scope.md](./ticketing-accounts-agent-scope.md) | MyAccount ↔ `agents.id` + role scopes |
| [ticketing-metric-catalog-calculations.md](./ticketing-metric-catalog-calculations.md) | Exact SQL for ~94 org metrics |
| [ticketing-customer-metrics.md](./ticketing-customer-metrics.md) | Customer-grain `tkt_*` metrics |
| [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md) | What Ticketing owns vs CDP / MyAccount / inventory |
| [ticketing-tables-and-labels.md](./ticketing-tables-and-labels.md) | Status / priority / channel enums |

---

## 1. Purpose of the Ticketing SQL agent

### 1.1 Mission

Turn natural-language questions from **staff** (admin / agent / resolver / viewer) into **correct, tenant-scoped, role-scoped SQL** against Ticketing data — for **analytics (counts, rates, trends)** and **listing (ticket rows, breakdowns)** — without inventing ids or bypassing RBAC.

### 1.2 All purposes (checklist)

| # | Purpose | Why it matters |
|---|---------|----------------|
| 1 | **Org / team / personal ticket counts** | Core “how many tickets…” answers under correct scope |
| 2 | **Filtered listings** | Status, priority, channel, queue, assignee, date range, overdue, unassigned |
| 3 | **SLA analytics** | Breach, compliance, due today, at-risk, avg resolution / first response |
| 4 | **CSAT analytics** | Average score, response rate, promoters/detractors |
| 5 | **Workload / staffing** | Per-agent assignee & resolver load; queue backlog |
| 6 | **Queue / team performance** | Tickets by `agent_queues`, members via `agent_queue_members` |
| 7 | **Customer support profile** | Volume/open/resolved/CSAT per `contact_profile` (CDP for name/email) |
| 8 | **Channel & category mix** | Where work comes from; dominant issue themes |
| 9 | **Reopen / quality** | Reopen rate, notes volume, escalation/reassign from audit |
| 10 | **Time-window KPIs** | Today / 7d / 30d / custom range using org timezone |
| 11 | **Dashboard KPI parity** | Align with home KPIs (open, overdue, due today, unassigned) |
| 12 | **KB / macros coverage** | Published articles, views, macro inventory (support enablement) |
| 13 | **Outbound / engagement** | Emails sent, notification backlog (ops health) |
| 14 | **Governance** | Audit volumes, escalation/reassignment trends |
| 15 | **Proactive / AI ops** (optional) | Recommendations / approvals / audit if product allows |
| 16 | **Portal engagement** | Portal sessions / logins for a customer |
| 17 | **Safe explainability** | Always state filters used (org, role scope, status, dates) |

### 1.3 Importance (non-negotiable)

| Importance | Detail |
|------------|--------|
| **Tenant isolation** | Every query must filter `organization_id = :org_id` on ticketing tables that have it |
| **Correct person id** | Ticket FKs use `ticketing.agents.id`, **not** `accounts.setup_users.id` |
| **Role-based scope** | Admin default = org; agent/resolver default = personal (and team when asked); never leak org-wide to agents by default |
| **No invented entities** | Only ids/names that come from SQL results or the authenticated user context |
| **SELECT only** | Agent may emit `SELECT` / `WITH` only — never INSERT / UPDATE / DELETE / DDL / `SELECT … FOR UPDATE` |
| **Hub awareness** | Staff SoR = MyAccount (`accounts.*`); person SoR = CDP (`cdp.*`); Ticketing owns cases + ops links only — join hubs when identity/lookup is needed |
| **Status correctness** | Prefer `ticket_statuses.is_terminal` for open vs closed; don’t invent statuses |

### 1.4 Out of scope (unless product later expands)

- Any write / mutation (tickets, mail, assign, approve)  
- INSERT / UPDATE / DELETE on `ticketing.*`, `accounts.*`, or `cdp.*`  
- Inventing metrics not computable from schema  
- Cross-tenant analytics  

---

## 2. Hard identity & mapping rules (every org)

### 2.0 SELECT-only contract (locked)

| Allowed | Forbidden |
|---------|-----------|
| `SELECT` / `WITH` (CTE) against `ticketing.*`, and **read** joins to `accounts.*` / `cdp.*` / `inventory.*` as documented below | `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / `ALTER` / `DROP` / `CREATE` / `GRANT` / `COPY` / functions that mutate |
| Aggregations, window functions, `LIMIT`/`OFFSET` | Multi-statement batches that include writes |
| Explaining which filters/joins were used | Calling Express mutation APIs from this agent |

All purposes in §1.2 are answered by **reading** Ticketing facts (+ hub identity when needed), not by changing data.

### 2.1 Tenant

```text
:org_id  =  accounts.organizations.id  =  ticketing.*.organization_id
         =  cdp.*.organization_id  (when joining CDP)
```

### 2.2 Staff bridge (MyAccount ↔ Ticketing)

```text
accounts.setup_users.id  =  ticketing.agents.setup_user_id
JWT / session user id for Ticketing  =  ticketing.agents.id
tickets.assignee_id / resolver_id / created_by_id  =  ticketing.agents.id
agent_queue_members.user_id  =  ticketing.agents.id
```

**Resolve MyAccount → agent (generic):**

```sql
SELECT ag.id AS agent_id, ag.role, ag.setup_user_id
FROM ticketing.agents ag
WHERE ag.organization_id = :org_id
  AND ag.setup_user_id = :setup_user_id
  AND ag.status = 'Active';
```

### 2.3 CDP ↔ Ticketing relationship (person / customer)

Ticketing does **not** own the person. CDP owns who the human is; Ticketing owns the **support contact ops row** and the **cases**.

```text
                    HUB (CDP)                              SPOKE (Ticketing)
┌─────────────────────────────────────┐         ┌──────────────────────────────────────┐
│ cdp.customer_profile                │         │ ticketing.contact_profile            │
│   cdp_id, organization_id           │◄──cdp_id│   id, organization_id, cdp_id         │
│   first_name, last_name, …          │         │   status, portal auth, total_tickets │
│   contact_type (often lead/customer)│         │   optional account_id → B2B account  │
│                                     │         │   (NO name/email/phone columns)      │
│ cdp.identity_keys                   │         └──────────────────┬───────────────────┘
│   cdp_id, key_type, key_value       │                            │
│   (email / phone)                   │                            │ customer_id
│                                     │                            ▼
│ cdp.orders / order_items (optional) │         │ ticketing.tickets                    │
│   360 context by cdp_id             │         │   + denormalized customer_* snapshots│
└─────────────────────────────────────┘         └──────────────────────────────────────┘
```

**Link keys:**

```text
tickets.customer_id          =  ticketing.contact_profile.id
contact_profile.cdp_id       =  cdp.customer_profile.cdp_id
                             =  cdp.identity_keys.cdp_id
(+ same organization_id on every hop)
```

**What each layer owns:**

| Layer | Owns | Does not own |
|-------|------|--------------|
| **CDP** | Person identity (name), email/phone keys, optional orders / 360 | Ticket status, SLA, assignee, CSAT, portal password |
| **`contact_profile`** | Spoke contact id, Active/Inactive, portal auth, ticket counters, optional B2B `account_id` | Canonical name/email/phone |
| **`tickets`** | Cases, queue, SLA timestamps, CSAT, assignee/resolver | Creating a person in CDP |

**Create-ticket gate (context for the agent):** a ticketable person already has (1) MyAccount org with Ticketing product access, (2) CDP profile + identity keys for that org, (3) Active `contact_profile` linked by `cdp_id`. Analytics should still count existing tickets even if CDP `contact_type` is `lead` (common in production) unless product later requires `customer` only.

**Snapshots vs live CDP:** `tickets.customer_name` / `customer_email` / `customer_phone` are denormalized at write time — fine for fast filters/lists. Prefer CDP joins when the user asks for “current name/email”, directory match, or identity that may have changed.

### 2.4 When to join `accounts.*` vs when to join `cdp.*`

Both hubs are **SELECT-only** for this agent. Use the right hub for the question.

#### Join **MyAccount (`accounts.*`)** when you need **tenant or staff** context

| Purpose | Tables | Typical join |
|---------|--------|--------------|
| Company / tenant display name | `accounts.organizations` | `o.id = t.organization_id` |
| Staff login identity, display name, email, skills | `accounts.setup_users` | `su.id = ag.setup_user_id` |
| Authoritative Ticketing product role | `setup_user_product_access` + `setup_roles` | filter `product_id = 'ticketing'` + org |
| “Tickets assigned to Jane Doe” (resolve staff by name/email) | `setup_users` → `agents` → `tickets` | never put `setup_users.id` on `assignee_id` |
| Confirm org business type / portal labels from hub | `organizations` (+ spoke `org_settings` for timezone/prefix) | read-only |

**Do not** use `accounts.*` for customer name/email — that is CDP.

```sql
-- Example: list open tickets with live staff email (SELECT only)
SELECT t.ticket_number, t.subject, t.status,
       su.full_name AS assignee_login_name, su.email AS assignee_login_email
FROM ticketing.tickets t
JOIN ticketing.agents ag ON ag.id = t.assignee_id AND ag.organization_id = t.organization_id
JOIN accounts.setup_users su ON su.id = ag.setup_user_id
WHERE t.organization_id = :org_id
  AND t.status = 'Open';
```

#### Join **CDP (`cdp.*`)** when you need **person / customer** context

| Purpose | Tables | Typical join |
|---------|--------|--------------|
| Current customer first/last name | `cdp.customer_profile` | via `contact_profile.cdp_id` |
| Match / filter by email or phone | `cdp.identity_keys` (`key_type` = `email` / `phone`) | same `cdp_id` + `organization_id` |
| “Tickets for customer X@y.com” when snapshot may be stale | `identity_keys` → `contact_profile` → `tickets` | preferred over guessing on snapshot alone |
| Optional `contact_type` (lead vs customer) for segmentation | `customer_profile.contact_type` | **do not** require `customer` unless product locks that |
| Customer 360 / order context beside support volume | `cdp.orders`, `cdp.order_items` | by `cdp_id` — not ticket volume SoR |
| Customer-grain metrics (`tkt_*`) with live identity | `contact_profile` + CDP | Ticketing counts stay on `tickets` / `contact_profile` |

**Do not** use CDP for staff assignee/resolver — that is MyAccount + `agents`.

```sql
-- Example: tickets for a person matched by live CDP email (SELECT only)
SELECT t.ticket_number, t.subject, t.status,
       p.first_name, p.last_name, e.key_value AS email
FROM ticketing.tickets t
JOIN ticketing.contact_profile c
  ON c.id = t.customer_id AND c.organization_id = t.organization_id
JOIN cdp.customer_profile p
  ON p.cdp_id = c.cdp_id AND p.organization_id = c.organization_id
JOIN cdp.identity_keys e
  ON e.cdp_id = c.cdp_id AND e.organization_id = c.organization_id
 AND e.key_type = 'email'
WHERE t.organization_id = :org_id
  AND lower(e.key_value) = lower(:email);
```

#### Quick decision

| User asks about… | Primary fact | Join hub? |
|------------------|--------------|-----------|
| Ticket counts, SLA, CSAT, status/priority lists | `ticketing.tickets` | Optional snapshots only |
| Staff name / login email / skills / product role | `agents` | **`accounts.*`** |
| Company name | `organization_id` | **`accounts.organizations`** |
| Customer name / email / phone / lead vs customer | `contact_profile` | **`cdp.*`** |
| Orders next to support history | `contact_profile.cdp_id` | **`cdp.orders*`** |
| B2B client account label on tickets | `ticketing_accounts` via `contact_profile.account_id` | (spoke — not MyAccount) |

### 2.5 Example org 1000

| MyAccount `setup_users.id` | Ticketing `agents.id` | Role |
|----------------------------|------------------------|------|
| 1013 | **1005** | admin |
| 1012 | 1004 | agent |
| 1000 | 1000 | resolver |
| … | … | … |

Never filter `assignee_id = 1013` for that admin — use **1005**.

Full scope matrix: [ticketing-accounts-agent-scope.md](./ticketing-accounts-agent-scope.md).

---

## 3. Role-based scope (SQL agent must apply)

Bind from auth context: `:org_id`, `:me_agent_id` (`agents.id`), `:role`, `:my_name`.

| Role | Default when user asks “how many tickets?” | “Assigned to me” | “That agent/resolver” | “My team” |
|------|--------------------------------------------|------------------|------------------------|-----------|
| **admin** / **viewer** | **Org-wide** | `assignee_id=:me OR resolver_id=:me` | Resolve name → `agents.id`, then L1 and/or L2 | Queue membership of named team or admin’s teams |
| **agent** | **My L1** `assignee_id=:me` | same | Only if RBAC allows naming others; else refuse/org-deny | Queues where `agent_queue_members.user_id=:me` |
| **resolver** | **My L2∪L1** | same | Same RBAC caution | Team queues if module allows |
| **customer** | Own tickets via `customer_id` / email | n/a | n/a | n/a |

### Default SQL fragments

```sql
-- Always
AND t.organization_id = :org_id

-- Admin/viewer default: (no person predicate)

-- Agent default
AND t.assignee_id = :me_agent_id

-- Resolver default
AND (t.resolver_id = :me_agent_id OR t.assignee_id = :me_agent_id)

-- Team (my queues ∪ tickets I’m on)
AND (
  t.queue_id = ANY(:my_queue_ids)
  OR t.assignee_id = :me_agent_id
  OR t.resolver_id = :me_agent_id
)
```

**Intent overrides default** (admin saying “my tickets” → personal; agent saying “org total” → usually deny unless elevated).

---

## 4. Schema map for the SQL agent

### 4.1 Domain diagram

```text
accounts.organizations ──< ticketing.org_settings
        │
        ├──< ticketing.agents >── accounts.setup_users (setup_user_id)
        │         │
        │         ├──< agent_queue_members >── agent_queues
        │         ├──< user_sessions / user_login_events
        │         └── tickets.assignee_id / resolver_id / created_by_id
        │
        ├──< ticketing.contact_profile >── cdp.customer_profile (cdp_id)
        │         │                         cdp.identity_keys (email/phone)
        │         └──< tickets.customer_id
        │
        ├──< tickets ──< ticket_notes, ticket_presence, notifications, …
        ├──< ticket_statuses, sla_policies, sla_policy_defaults
        ├──< kb_articles, macros
        ├──< audit_events, activity_logs, dashboard_metrics
        └──< proactive_*, outbound_email_log, conversation_contexts, …
```

### 4.2 Core tables — what to use them for

#### `ticketing.tickets` — **primary fact table**

**Purpose:** Support cases (volume, SLA, CSAT, listing).  
**Use for:** Almost all analytics & ticket lists.  
**Key columns:** `id`, `organization_id`, `ticket_number`, `subject`, `description`, `status`, `priority`, `channel`, `category`, `skill`, `customer_id`, `customer_*` snapshots, `assignee_id`, `assignee_name`, `resolver_id`, `resolver_name`, `queue_id`, `queue_name`, `due_at`, `first_response_at`, `resolved_at`, `csat_score`, `csat_rated_at`, `created_by_id`, `created_by_name`, `ai_summary`, `created_at`, `updated_at`.

**Categoricals:**

| Column | Values |
|--------|--------|
| `status` | `Open`, `Pending`, `Reopened`, `Resolved`, `Overdue` (+ org customs in `ticket_statuses`) |
| `priority` | `urgent`, `high`, `medium`, `low` |
| `channel` | `Email`, `Chat`, `Phone`, `Web` |
| `csat_score` | `1`–`5` |

**Typical joins:**

```sql
FROM ticketing.tickets t
LEFT JOIN ticketing.ticket_statuses ts
  ON ts.organization_id = t.organization_id AND ts.status = t.status
LEFT JOIN ticketing.agents a_l1 ON a_l1.id = t.assignee_id
LEFT JOIN ticketing.agents a_l2 ON a_l2.id = t.resolver_id
LEFT JOIN ticketing.agent_queues q ON q.id = t.queue_id
LEFT JOIN ticketing.contact_profile c ON c.id = t.customer_id
LEFT JOIN ticketing.sla_policies sp
  ON sp.organization_id = t.organization_id AND lower(sp.priority) = lower(t.priority)
```

**Query concepts:** counts, lists, SLA, CSAT, mix by status/priority/channel/category/queue/assignee.

---

#### `ticketing.ticket_statuses` — status catalog

**Purpose:** Know which statuses are open vs closed (`is_terminal`).  
**Use for:** “Open tickets”, “active backlog” without hardcoding.  
**Join:** `ts.organization_id = t.organization_id AND ts.status = t.status`.  
**Open:** `COALESCE(ts.is_terminal, false) = false`. **Closed:** `ts.is_terminal = true`.

---

#### `ticketing.agents` — staff bridge

**Purpose:** Map MyAccount users; filter by role; join names via MyAccount.  
**Access patterns:**

```sql
-- Roster / load by agent
FROM ticketing.agents ag
LEFT JOIN accounts.setup_users su ON su.id = ag.setup_user_id
WHERE ag.organization_id = :org_id AND ag.status = 'Active'
```

**Use for:** “tickets for agent X”, role class filters, resolving `:me_agent_id`.  
**Do not** use `setup_user_id` as `tickets.assignee_id`.

---

#### `ticketing.agent_queues` + `agent_queue_members` — teams

**Purpose:** Team/queue backlog and membership.  
**Use for:** “my team”, “Bug Solvers tickets”, unassigned on my teams.

```sql
FROM ticketing.agent_queue_members m
JOIN ticketing.agent_queues q ON q.id = m.queue_id
WHERE m.organization_id = :org_id AND m.user_id = :me_agent_id
```

Then filter `tickets.queue_id IN (...)`.

**Categoricals on queues:** `type` ∈ `Private`,`Shared`; `sla_status` ∈ `On Track`,`At Risk`.

---

#### `ticketing.contact_profile` — support contacts

**Purpose:** Customer grain ops + portal auth link (`cdp_id`).  
**Use for:** Customer metrics, “tickets for customer email X”.  
**Not for:** name/email SoR — join CDP:

```sql
FROM ticketing.contact_profile c
LEFT JOIN cdp.customer_profile p
  ON p.cdp_id = c.cdp_id AND p.organization_id = c.organization_id
LEFT JOIN cdp.identity_keys e
  ON e.cdp_id = c.cdp_id AND e.organization_id = c.organization_id AND e.key_type = 'email'
WHERE c.organization_id = :org_id AND c.status = 'Active'
```

---

#### `ticketing.ticketing_accounts` — B2B client accounts

**Purpose:** Group contacts under B2B clients (not MyAccount).  
**Use for:** “tickets for account Acme” via `contact_profile.account_id`.

---

#### `ticketing.org_settings` — org prefs

**Purpose:** `ticket_prefix`, `display_timezone`, portal slug/auth.  
**Use for:** “due today” in org timezone; branding context — **not** company name (use `accounts.organizations.company_name`).

```sql
-- "today" in org TZ
(t.due_at AT TIME ZONE COALESCE(s.display_timezone, 'UTC'))::date
  = (NOW() AT TIME ZONE COALESCE(s.display_timezone, 'UTC'))::date
```

---

#### `ticketing.sla_policies` / `sla_policy_defaults`

**Purpose:** Target hours by priority.  
**Use for:** first-response / resolution SLA compliance vs targets.  
**Join:** `lower(sp.priority) = lower(t.priority) AND sp.organization_id = t.organization_id`.

---

#### `ticketing.ticket_notes`

**Purpose:** Conversation volume; public vs internal.  
**Categorical:** `visibility` ∈ `internal`,`public`.  
**Use for:** note counts, customer-visible reply volume, last public reply time.

---

#### `ticketing.notifications`

**Purpose:** Staff inbox volume / unread.  
**Categorical:** `kind` ∈ `assignment`,`update`,`sla`,`security`,`product`.  
**Join:** `user_id` → `agents.id`.

---

#### `ticketing.audit_events`

**Purpose:** Escalations, reassignments, creates (governance).  
**Common `action`:** `ticket.created`, `ticket.updated`, `ticket.assigned`, `ticket.escalated`, `ticket.resolver_set`, …  
**Use for:** escalation_rate, reassignment volume — not for live open counts.

---

#### `ticketing.activity_logs`

**Purpose:** Short human feed lines (UI activity). Lightweight; prefer `audit_events` for formal metrics.

---

#### `ticketing.dashboard_metrics`

**Purpose:** Cached home KPIs snapshot.  
**Use for:** quick dashboard parity; for authoritative analytics prefer live `COUNT` on `tickets`.

---

#### `ticketing.kb_articles` / `macros`

**Purpose:** Knowledge coverage; macro inventory.  
**KB status:** `Published` / `Draft`.

---

#### `ticketing.outbound_email_log`

**Purpose:** Mail ops volume by `kind` / `status`.  
**Kinds:** `ticket_created`, `ticket_reply`, `ticket_resolved`, `sla_reminder_1h`, `sla_breach_admin`, …  
**Status:** `queued`,`sent`,`failed`,`skipped`.

---

#### `ticketing.customer_portal_sessions` (+ otp/password tables)

**Purpose:** Portal engagement (`tkt_portal_logins`).  
**Rarely** needed for staff ticket lists.

---

#### Proactive family (`proactive_outbox`, `proactive_recommendations`, `proactive_approvals`, `proactive_audit`, …)

**Purpose:** AI/ops recommendations & approvals.  
**Note:** `ticket_id` is often **TEXT** (cast to bigint when joining `tickets.id`).  
**Use for:** AI automation metrics — not customer health KPIs.

---

#### Chat / coworker (`conversation_contexts`, `workflow_events`)

**Purpose:** Co-worker chat state — usually **out of analytics** unless debugging workflows.

---

#### Internal chat / alerts / onboarding / a2a / memory tables

Present on some branches (`internal_chat_*`, `critical_alerts`, `agent_long_term_memory`, …).  
**SQL agent default:** ignore unless the question is explicitly about internal chat or those features.

---

### 4.3 Hub tables (SELECT-only joins — identity & lookup)

Full purpose matrix: **§2.3–2.4**. Summary:

| Schema | Join for | Not for |
|--------|----------|---------|
| `accounts.organizations` | Company name, tenant metadata | Ticket volume SoR |
| `accounts.setup_users` | Staff display name, email, skills | Customer identity |
| `accounts.setup_user_product_access` + `setup_roles` | Authoritative Ticketing role | Ticket assignee FK (use `agents.id`) |
| `cdp.customer_profile` | Person name, optional `contact_type` | Staff; ticket status/SLA |
| `cdp.identity_keys` | Email/phone match (`key_type` = `email`/`phone`) | Staff login |
| `cdp.orders` / `order_items` | Optional 360 context by `cdp_id` | Replacing ticket metrics |
| `inventory.products` | Product catalog entitlements | Ticket volume |

**Always** keep `organization_id` consistent across spoke + hub joins. **Never** INSERT/UPDATE hub (or spoke) tables from this agent.

---

## 5. Listing playbook (tickets)

### 5.1 Always return useful columns

For “list tickets…” prefer:

`ticket_number`, `subject`, `status`, `priority`, `channel`, `assignee_name`, `resolver_name`, `queue_name`, `customer_name`, `due_at`, `created_at`, `updated_at`, `id`

Add `LIMIT` (e.g. 50) unless user asks for full export.

### 5.2 Common list filters

| User intent | SQL idea |
|-------------|----------|
| By status | `t.status = 'Open'` or `ts.is_terminal = false` |
| By priority | `lower(t.priority) = 'urgent'` |
| By channel | `t.channel = 'Email'` |
| By category | `t.category ILIKE …` |
| Overdue | open ∧ `due_at < NOW()` (or `status = 'Overdue'`) |
| Due today | due date = org-local today (`org_settings.display_timezone`) |
| Unassigned | L1 and/or L2 missing / `'Unassigned'` |
| Assigned to me | role-aware §3 |
| Assigned to name | resolve → `agents.id` |
| Queue/team | `queue_id` / `queue_name` |
| Date range | `created_at` / `resolved_at` / `updated_at` between … |
| Customer email | `lower(t.customer_email) = …` or CDP identity join |
| CSAT rated | `csat_score IS NOT NULL` |
| Reopened | `status = 'Reopened'` |

### 5.3 Ordering

Default: `ORDER BY t.updated_at DESC` or `created_at DESC`.  
SLA views: `ORDER BY t.due_at ASC NULLS LAST`.

---

## 6. Analytics playbook — metrics users may ask

Use full formulas in [ticketing-metric-catalog-calculations.md](./ticketing-metric-catalog-calculations.md). Below is the **agent cheat sheet**.

### 6.1 Volume & backlog

| Metric / ask | Concept |
|--------------|---------|
| Ticket volume / total | `COUNT(*)` tickets |
| Open / active | `is_terminal = false` |
| Resolved / closed | `is_terminal` or `resolved_at IS NOT NULL` |
| Reopened | `status = 'Reopened'` |
| Resolution rate | resolved / created |
| Unassigned count / rate | unassigned predicate / volume |
| Customers served | `COUNT(DISTINCT customer_id)` |
| Accounts served | distinct B2B accounts with tickets |
| Created today / 7d / 30d | `created_at` window (+ org TZ for “today”) |
| Average open age | age of open tickets |

### 6.2 SLA

| Metric / ask | Concept |
|--------------|---------|
| Breached / overdue now | past `due_at` still open |
| SLA breach rate | breached / with target |
| Due today | org-TZ due date = today |
| At risk (due soon) | due within N hours |
| Avg resolution hours | `resolved_at - created_at` |
| Avg first response hours | `first_response_at - created_at` |
| First-response SLA compliance | vs `sla_policies.first_response_hours` |
| Resolution SLA compliance | vs `due_at` / policy hours |

### 6.3 CSAT / quality

| Metric / ask | Concept |
|--------------|---------|
| Average CSAT | `AVG(csat_score)` where rated |
| CSAT response rate | rated among resolved / resolved |
| Promoters (≥4) / detractors (≤2) / neutral (=3) | counts & rates |
| Reopen rate | reopened / resolved |
| Last CSAT | score on latest `csat_rated_at` |

### 6.4 Mix / segmentation

| Metric / ask | Concept |
|--------------|---------|
| Priority mix | count/% by `priority` |
| Channel mix | by `channel` |
| Status mix | by `status` |
| Category mix / dominant category | by `category` |
| Queue mix | by `queue_name` / `queue_id` |
| Skill mix | by `skill` |

### 6.5 People & teams

| Metric / ask | Concept |
|--------------|---------|
| Per-agent L1 load | `GROUP BY assignee_id` |
| Per-resolver L2 load | `GROUP BY resolver_id` |
| My workload | §3 personal filters |
| Team backlog | queue membership → tickets |
| Created by me | `created_by_id = :me` |

### 6.6 Customer grain (`tkt_*`)

See [ticketing-customer-metrics.md](./ticketing-customer-metrics.md):  
`tkt_total_tickets`, open/resolved/reopened/overdue, priority/channel mix, resolution/reopen/SLA rates, avg resolution/FRT, CSAT metrics, portal logins, last ticket/resolved timestamps, days since last ticket — **group by `organization_id`, `customer_id`**.

### 6.7 Engagement / governance / knowledge / AI

| Area | Examples |
|------|----------|
| Engagement | note volume, public vs internal notes, notifications, outbound email volume |
| Governance | audit volume, escalation volume/rate, reassignment volume |
| Knowledge | KB count, published count, views, macros |
| AI / proactive | recommendation volume, accept/dismiss rates, approval rates (cast text `ticket_id`) |

### 6.8 Dashboard KPI aliases (home screen)

Often asked interchangeably:

- Open tickets  
- Overdue  
- Due today  
- Unassigned  
- Created today  

Prefer **live SQL on `tickets`**; `dashboard_metrics` is a cache.

---

## 7. Query planning rules for the agent

1. **Parse intent:** count vs list vs rate vs trend vs “for me” vs “for person/team”.  
2. **Bind auth:** `:org_id`, `:me_agent_id`, `:role`.  
3. **Apply role default scope**, then override from explicit intent.  
4. **Pick fact table:** almost always `tickets`; add dims via joins in §4.  
5. **Resolve people:** staff name/email → `agents` + **`accounts.setup_users`**; customer email/name → `contact_profile` + **`cdp.*`** (§2.4).  
6. **Never** put `setup_users.id` into `assignee_id` / `resolver_id`.  
7. **Open vs closed:** join `ticket_statuses`.  
8. **Timezone “today”:** `org_settings.display_timezone`.  
9. **Ratios:** `NULLIF(denom, 0)`.  
10. **Limit lists;** aggregate for analytics.  
11. **SELECT only** — reject any write plan.  
12. **Explain** scope in the answer (“org-wide”, “your assignee tickets”, filters used).

---

## 8. Minimal column cheat sheet (high-traffic)

| Table | Must-know columns |
|-------|-------------------|
| `tickets` | id, organization_id, ticket_number, subject, status, priority, channel, category, customer_id, assignee_id, resolver_id, queue_id, due_at, first_response_at, resolved_at, csat_score, created_at |
| `agents` | id, organization_id, setup_user_id, role, status, support_email |
| `agent_queues` | id, organization_id, queue_name, type, sla_status |
| `agent_queue_members` | queue_id, user_id, organization_id |
| `contact_profile` | id, organization_id, cdp_id, status, account_id |
| `ticket_statuses` | organization_id, status, is_terminal, active, sort_order |
| `sla_policies` | organization_id, priority, resolution_hours, first_response_hours, active |
| `org_settings` | organization_id, display_timezone, ticket_prefix |
| `ticket_notes` | ticket_id, visibility, created_at, author_id |
| `audit_events` | action, ticket_id, actor_id, meta, created_at |

For full column dictionaries + samples → [ticketing-table-catalog.md](./ticketing-table-catalog.md).

---

## 9. Anti-patterns

| Don’t | Do |
|-------|----|
| Query without `organization_id` | Always tenant-filter |
| `assignee_id = setup_users.id` | Map via `agents.setup_user_id` |
| Hardcode only `Open` as “active” | Use `is_terminal = false` |
| Give agents org-wide totals by default | Personal/team scope |
| Invent ticket numbers / agent names | SELECT then answer |
| UPDATE/DELETE from SQL agent | SELECT only |
| Use dropped tables (`users`, `customers`, `organizations`, `products`) | `agents`, `contact_profile`, hub orgs, inventory |

---

## 10. Suggested system prompt fragment (for the SQL agent)

> You generate **SELECT-only** SQL for Worktual Ticketing (`ticketing` schema). Never mutate data.  
> Always filter `organization_id = :org_id` on ticketing rows (and matching org on hub joins).  
> Staff FKs on tickets are `ticketing.agents.id`. Map MyAccount users with `agents.setup_user_id` → `accounts.setup_users`.  
> Customers: `tickets.customer_id` → `contact_profile.id`; person name/email/phone live in CDP via `contact_profile.cdp_id` → `cdp.customer_profile` / `cdp.identity_keys`. Snapshots on `tickets.customer_*` are OK for fast filters; prefer CDP for live identity.  
> Join `accounts.*` only for tenant/staff identity and product role — never for customer PII.  
> Join `cdp.*` only for person identity, email/phone match, optional orders — never for staff assignee.  
> Apply role scope: admin/viewer → org default; agent → assignee; resolver → resolver∪assignee; override only when the user clearly asks.  
> Prefer `ticket_statuses.is_terminal` for open/closed.  
> Answer with the metric definition you used. Prefer formulas from the ticketing metric catalog when applicable.

---

## 11. Open questions (still need your call)

Already locked from you: **SELECT-only**; **hub joins to `accounts.*` / `cdp.*` allowed** for the purposes in §2.4.

Please still confirm:

1. **Proactive / internal chat in scope?** Include AI recommendation metrics and `internal_chat_*`, or tickets + ops only for v1?  
2. **Default list LIMIT?** e.g. 25 / 50 / 100 when the user doesn’t specify?  
3. **CDP `contact_type`:** Should ticket analytics require `contact_type = 'customer'`, or keep current rule (any Active `contact_profile`, including `lead`)? Today production contacts are often `lead` and still have tickets.

Once you answer these, the agent prompt/tools can be tightened accordingly.
