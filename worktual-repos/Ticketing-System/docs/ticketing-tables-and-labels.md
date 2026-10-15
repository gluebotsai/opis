# Ticketing tables & labels reference

Schema: **`ticketing`** (Postgres). Multi-tenant — almost every row is scoped by **`organization_id`** (= `accounts.organizations.id`).

Hub/spoke SoR: [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md). Org/staff identity are MyAccount; contacts use `contact_profile` + CDP; product link tables are dropped.

This doc lists:

1. **Labels / enums** used in the product (status, priority, channel, …)
2. **Tables** with table description + column descriptions

For **full column meanings + categorical values + sample rows**, see [ticketing-table-catalog.md](./ticketing-table-catalog.md).  
For deeper MyAccount (`accounts.*`) sync details see [ticketing-schema.md](./ticketing-schema.md).

---

## Part 1 — Labels & enums

### 1.1 Ticket status (`tickets.status`)

Stored on `tickets.status`. Catalog lives in `ticket_statuses` (orgs can add custom statuses).

| Stored value (`status`) | UI display name | Terminal? (`is_terminal`) | Meaning |
|-------------------------|-----------------|---------------------------|---------|
| `Open` | Open | No | New / not yet in progress |
| `Pending` | In Progress | No | Being worked |
| `Reopened` | Reopened | No | Was resolved, then reopened |
| `Resolved` | Resolved | **Yes** | Closed / finished |
| `Overdue` | Overdue | No | Past SLA deadline, still unresolved |

**Active tickets** = status is **not closed** (not terminal) → typically `Open`, `Pending`, `Reopened`, `Overdue` (plus any custom non-terminal statuses).

**Closed tickets** = terminal status → typically `Resolved` (custom closed statuses may exist).

> Note: Legacy `On Hold` was removed. Do not use it for new work.

---

### 1.2 Ticket priority (`tickets.priority`)

Keys match `sla_policies.priority`. Default SLA hours:

| Priority key | Default resolution hours | Default first-response hours |
|--------------|--------------------------|------------------------------|
| `urgent` | 4 | 1 |
| `high` | 8 | 2 |
| `medium` | 24 | 4 |
| `low` | 72 | 8 |

UI may show a custom `display_name` from `sla_policies`; the **stored key** remains lowercase (`urgent` / `high` / `medium` / `low`).

---

### 1.3 Ticket channel (`tickets.channel`)

| Label | Meaning |
|-------|---------|
| `Email` | Email intake / email thread |
| `Chat` | Chat / messaging |
| `Phone` | Phone |
| `Web` | Web form / console / widget (default) |

---

### 1.4 Ticket category (common triage values)

Often set by triage / ICPA. Common values:

| Label |
|-------|
| `Billing` |
| `Troubleshooting` |
| `Accounts` |
| `General` |
| `Database` (and other free-text triage categories) |

`tickets.category` is free text — orgs may use additional labels.

---

### 1.5 Assignee sentinel

| Label | Where | Meaning |
|-------|-------|---------|
| `Unassigned` | `tickets.assignee_name` | No L1 agent assigned yet |

---

### 1.6 Note visibility (`ticket_notes.visibility`)

| Label | Meaning |
|-------|---------|
| `internal` | Staff-only note (default) |
| `public` | Customer-visible reply |

---

### 1.7 Agent / contact status

| Table | Labels |
|-------|--------|
| `agents.status` | `Active`, `Inactive` |
| `contact_profile.status` | `Active`, `Inactive` |
| `ticketing_accounts.status` | `Active`, `Inactive` |

---

### 1.8 Agent roles (`agents.role`)

| Label | Meaning |
|-------|---------|
| `admin` | Full org admin |
| `agent` | L1 support agent |
| `resolver` | L2 resolver |
| `customer` | Customer portal role (rare on agents) |
| `viewer` | Read-only staff |

---

### 1.9 Agent queue type & SLA status

**Queue type** (`agent_queues.type`):

| Label | Meaning |
|-------|---------|
| `Private` | Private team queue |
| `Shared` | Shared queue |

**Queue SLA status** (`agent_queues.sla_status`):

| Label | Meaning |
|-------|---------|
| `On Track` | No overdue tickets in queue |
| `At Risk` | Queue has overdue ticket(s) |

---

### 1.10 KB article status & category

**Status** (`kb_articles.status`):

| Label |
|-------|
| `Published` |
| `Draft` |

**Category** (common): `Billing`, `Troubleshooting`, `Accounts`, `General`

---

### 1.11 CSAT score (`tickets.csat_score`)

Integer **1–5** only.

| Score band | Typical label in metrics |
|------------|--------------------------|
| 4–5 | Promoter / high |
| 3 | Neutral |
| 1–2 | Detractor / low |

---

### 1.12 Notification kind (`notifications.kind`)

| Label | Meaning |
|-------|---------|
| `assignment` | Ticket assigned to you |
| `update` | Ticket updated / commented |
| `sla` | SLA risk / breach alert |
| `security` | Security-related alert |
| `product` | Product update notice |

---

### 1.13 Outbound email kind (`outbound_email_log.kind`)

| Label | Meaning |
|-------|---------|
| `ticket_created` | Customer “ticket created” mail |
| `ticket_reply` | Customer reply mail |
| `ticket_resolved` | Customer resolved mail |
| `staff_ticket_created` | Staff notify on create |
| `sla_reminder_1h` | ~1h before due reminder |
| `sla_breach_admin` | Breach mail to admins |
| `dssa_deflection` | Deflection / self-service mail |
| `portal_otp` | Customer portal OTP |
| `portal_set_password` | Portal password setup |
| `not_registered_customer` | Not-registered notice |

**Delivery status** (`outbound_email_log.status`): typically `queued`, `sent`, `failed` (and similar).

---

### 1.14 Audit actions (`audit_events.action`)

Common values:

| Label |
|-------|
| `ticket.created` |
| `ticket.updated` |
| `ticket.status_changed` |
| `ticket.assigned` |
| `ticket.escalated` |
| `ticket.resolver_set` |

---

### 1.15 Proactive recommendation status

| Label | Meaning |
|-------|---------|
| `open` | Waiting for agent decision |
| `accepted` | Agent accepted |
| `dismissed` | Agent dismissed |

---

### 1.16 Proactive approval status

| Label | Meaning |
|-------|---------|
| `pending` | Waiting for human approve/reject |
| `approved` | Human approved |
| `rejected` | Human rejected |

---

### 1.17 Proactive event types (outbox / runtime)

Ticket-scoped (examples):

| Event |
|-------|
| `ticket.created` |
| `ticket.updated` |
| `ticket.comment_added` |
| `customer.replied` |
| `ticket.escalated` |
| `ticket.sla_at_risk` |
| `inbound.message` |

Schedule examples: `schedule.sema`, `schedule.wloa`, `schedule.tiaa`, `schedule.rcaa`

---

### 1.18 Organization business type

| Label | Meaning |
|-------|---------|
| `b2c` | Business-to-consumer |
| `b2b` | Business-to-business |

---

### 1.19 Ticket event outbox status

| Label |
|-------|
| `pending` |
| `delivered` |
| `failed` |

---

### 1.20 Active vs closed (derived labels)

Used in metrics / NLU (not always stored columns):

| Concept | Definition |
|---------|------------|
| **Active ticket** | Status is **not closed** (`is_terminal = false`) |
| **Closed ticket** | Status is terminal (`is_terminal = true`, usually `Resolved`) |
| **Open ticket (KPI)** | Same idea as active in dashboard counts: `Open` / `Pending` / `Reopened` / `Overdue` |
| **Unassigned** | `assignee_name` is null or `Unassigned` |
| **Overdue (live)** | Unresolved and past `due_at` / status `Overdue` |
| **Due today** | Unresolved and `due_at` date = org local today |

---

## Part 2 — Tables (description + columns)

All tables below are in schema **`ticketing`** unless noted.

---

### `organizations`

**Description:** Tenant / company workspace root. Every other business table hangs off `organization_id`.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `name` | text | NO | Company / workspace name |
| `slug` | text | NO | URL-safe slug (help center `/hc/{slug}`) |
| `status` | text | NO | `Active` / `Inactive` |
| `ticket_prefix` | text | NO | Prefix for ticket numbers (default `#`) |
| `portal_label` | text | YES | Optional portal branding |
| `display_timezone` | text | NO | Org timezone for “due today” etc. |
| `portal_auth_mode` | text | NO | Customer portal auth mode (e.g. `otp`) |
| `business_type` | text | NO | `b2c` / `b2b` |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Updated |

---

### `users`

**Description:** Staff (and some customer) portal accounts for the org.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → organizations |
| `name` | text | NO | Display name |
| `email` | text | NO | Login email |
| `initials` | text | YES | Avatar initials |
| `role` | text | NO | `admin` / `agent` / `resolver` / `customer` / `viewer` |
| `status` | text | NO | `Active` / `Inactive` |
| `password_hash` | text | YES | Password hash |
| `phone` | text | YES | Phone |
| `last_login_at` | timestamptz | YES | Last login |
| `notify_ticket_assignments` | bool | NO | Assignment emails/alerts |
| `notify_ticket_updates` | bool | NO | Update alerts |
| `notify_security_alerts` | bool | NO | Security alerts |
| `notify_sla_alerts` | bool | NO | SLA alerts |
| `notify_product_updates` | bool | NO | Product notices |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Updated |

*(Additional preference columns may exist: language, timezone, date_format, 2FA, MyAccount ids — see full schema doc.)*

---

### `contact_profile`

**Description:** Support contact ops + portal auth. Person SoR is `cdp.customer_profile` via `cdp_id`. No name/email/phone columns — resolve from CDP.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | bigint | NO | Primary key (spoke handle for tickets / portal) |
| `organization_id` | bigint | NO | Tenant |
| `cdp_id` | text | NO | Link to `cdp.customer_profile` |
| `account_id` | bigint | YES | FK → ticketing.ticketing_accounts (B2B) |
| `external_id` | text | YES | Legacy external code |
| `status` | text | NO | `Active` / `Inactive` |
| `total_tickets` | int4 | NO | Cached ticket count |
| `password_hash` | text | YES | Portal password |
| `password_set_at` | timestamptz | YES | When portal password set |
| `last_portal_login_at` | timestamptz | YES | Last portal login |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Updated |

See [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md).

---

### `ticketing_accounts` (ticketing.ticketing_accounts)

**Description:** B2B **client** accounts inside Ticketing — **not** MyAccount’s `accounts` schema.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `name` | text | NO | Account / company name |
| `status` | text | YES | Active/Inactive style status |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Updated |

---

### `agent_queues`

**Description:** Support teams / queues.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `external_id` | text | YES | External queue code |
| `queue_name` | text | NO | Team / queue name |
| `type` | text | NO | `Private` / `Shared` |
| `open_tickets` | int4 | NO | Cached open count |
| `assigned` | int4 | NO | Cached assigned count |
| `sla_status` | text | NO | `On Track` / `At Risk` |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Updated |

---

### `agent_queue_members`

**Description:** Which users belong to which queues.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `queue_id` | uuid | NO | FK → agent_queues |
| `user_id` | uuid | NO | FK → users |
| `created_at` | timestamptz | NO | Membership created |

---

### `tickets`

**Description:** Core support cases. Identity: `id` (UUID) + `ticket_number` (human `#13218`).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Canonical ticket UUID |
| `organization_id` | uuid | NO | Tenant |
| `ticket_number` | text | NO | Display id (e.g. `#13218`) |
| `subject` | text | NO | Subject |
| `description` | text | NO | Body / issue detail |
| `status` | text | NO | See [ticket status labels](#11-ticket-status-ticketsstatus) |
| `priority` | text | NO | See [priority labels](#12-ticket-priority-ticketspriority) |
| `customer_id` | uuid | YES | FK → customers |
| `customer_name` | text | NO | Denormalized requester name |
| `customer_email` | text | NO | Denormalized email |
| `customer_phone` | text | YES | Denormalized phone |
| `channel` | text | NO | Email / Chat / Phone / Web |
| `assignee_id` | uuid | YES | L1 agent user id |
| `assignee_name` | text | NO | L1 name or `Unassigned` |
| `resolver_id` | uuid | YES | L2 resolver user id |
| `resolver_name` | text | YES | L2 display name |
| `queue_id` | uuid | YES | FK → agent_queues |
| `queue_name` | text | YES | Denormalized queue name |
| `attachments` | text[] | NO | File URLs |
| `due_at` | timestamptz | YES | Resolution SLA deadline |
| `first_response_at` | timestamptz | YES | First staff response time |
| `resolved_at` | timestamptz | YES | When resolved |
| `csat_score` | int4 | YES | Rating 1–5 |
| `csat_rated_at` | timestamptz | YES | When rated |
| `category` | text | YES | Triage category |
| `skill` | text | YES | Required skill |
| `ai_summary` | text | YES | AI rolling summary |
| `created_by_id` | uuid | YES | Creator user id |
| `created_by_name` | text | YES | Creator name |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Last update |

---

### `ticket_statuses`

**Description:** Per-org status catalog (system + custom).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `status` | text | NO | Key stored on `tickets.status` |
| `display_name` | text | NO | UI label |
| `is_system` | bool | NO | Built-in vs custom |
| `is_terminal` | bool | NO | Closed/end state |
| `sort_order` | int4 | NO | UI order |
| `active` | bool | NO | Selectable |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Updated |

---

### `ticket_notes`

**Description:** Conversation thread on a ticket.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `ticket_id` | uuid | NO | FK → **tickets.id** (UUID) |
| `author_id` | uuid | YES | FK → users |
| `author_name` | text | NO | Author display name |
| `body` | text | NO | Note text |
| `visibility` | text | NO | `internal` / `public` |
| `created_at` | timestamptz | NO | Note time |

---

### `ticket_presence`

**Description:** Who is currently viewing a ticket (heartbeat).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `organization_id` | uuid | NO | PK part |
| `ticket_id` | uuid | NO | PK part → tickets.id |
| `user_id` | uuid | NO | PK part → users.id |
| `user_name` | text | NO | Viewer name |
| `last_seen_at` | timestamptz | NO | Last heartbeat |

---

### `activity_logs`

**Description:** Lightweight recent-activity feed text.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `ticket_id` | uuid | YES | Optional → tickets.id |
| `text` | text | NO | Human-readable event |
| `created_at` | timestamptz | NO | Event time |

---

### `audit_events`

**Description:** Append-only compliance audit trail.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `actor_id` | uuid | YES | Who acted |
| `actor_name` | text | YES | Actor display name |
| `action` | text | NO | e.g. `ticket.created` |
| `ticket_id` | uuid | YES | Related ticket UUID |
| `ticket_number` | text | YES | Related `#13218` |
| `meta` | jsonb | NO | Extra details |
| `created_at` | timestamptz | NO | Event time |

---

### `kb_articles`

**Description:** Knowledge base articles (Published feed help center).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `external_id` | text | YES | External code |
| `title` | text | NO | Title |
| `content` | text | NO | Body |
| `category` | text | NO | Category label |
| `author_name` | text | NO | Author name |
| `author_id` | uuid | YES | FK → users |
| `status` | text | NO | `Published` / `Draft` |
| `views` | int4 | NO | View counter |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Updated |

---

### `macros`

**Description:** Saved reply templates.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `title` | text | NO | Macro name |
| `body` | text | NO | Template body |
| `created_by_id` | uuid | YES | Creator |
| `created_by_name` | text | YES | Creator name |
| `created_at` | timestamptz | NO | Created |
| `updated_at` | timestamptz | NO | Updated |

---

### `notifications`

**Description:** In-app staff notifications.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `user_id` | uuid | YES | Recipient |
| `title` | text | NO | Title |
| `message` | text | NO | Body |
| `ticket_id` | uuid | YES | Related ticket UUID |
| `customer_name` | text | YES | Customer label |
| `is_read` | bool | NO | Read flag |
| `kind` | text | YES | assignment / update / sla / … |
| `created_at` | timestamptz | NO | Created |

---

### `dashboard_metrics`

**Description:** Cached home-dashboard KPIs (one row per org).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant (unique) |
| `open_tickets` | int4 | NO | Open/active count |
| `on_hold` | int4 | NO | Legacy hold count (often 0) |
| `overdue` | int4 | NO | Overdue count |
| `due_today` | int4 | NO | Due today count |
| `unassigned` | int4 | NO | Unassigned count |
| `*_change` | text | NO | Change labels for UI |
| `captured_at` | timestamptz | NO | Refresh time |

---

### `sla_policy_defaults` / `sla_policies`

**Description:** Default and per-org SLA hours by priority (see [priority labels](#12-ticket-priority-ticketspriority)).

| Column | Description |
|--------|-------------|
| `priority` | `urgent` / `high` / `medium` / `low` |
| `resolution_hours` | Hours until resolution due |
| `first_response_hours` | Hours until first-response target |
| `display_name` | Optional UI label (org policies) |
| `active` | Whether policy is usable |

---

### `outbound_email_log`

**Description:** Log of emails sent (customer / staff / SLA).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `ticket_id` | uuid | YES | Related ticket UUID |
| `ticket_number` | text | YES | Related display id |
| `kind` | text | NO | See [email kinds](#113-outbound-email-kind-outbound_email_logkind) |
| `to_email` | text | NO | Recipient |
| `subject` | text | NO | Subject |
| `body_preview` | text | YES | Preview |
| `status` | text | NO | Delivery status |
| `error` | text | YES | Error if failed |
| `created_at` | timestamptz | NO | Log time |

---

### `email_message_refs`

**Description:** Inbound email Message-ID → ticket threading.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | Tenant |
| `message_id` | text | NO | Email Message-ID |
| `ticket_id` | uuid | NO | FK → tickets.id |
| `ticket_number` | text | NO | Display id |
| `created_at` | timestamptz | NO | Created |

---

### Proactive tables

| Table | Description |
|-------|-------------|
| `proactive_outbox` | Event queue for proactive agents (`ticket_id` TEXT = tickets.id UUID string; `ticket_number` = `#…`) |
| `proactive_recommendations` | AI suggestions (`status`: open / accepted / dismissed) |
| `proactive_approvals` | Action approvals (`status`: pending / approved / rejected) |
| `proactive_audit` | Decision / tool audit log |
| `proactive_embeddings` | Retrieval tokens |
| `proactive_routing_weights` | Per-org routing weights JSON |

**Soft ticket link:** proactive `ticket_id` stores the ticket **UUID as text** (not `#13218`). No Postgres FK.

---

### Other tables (short)

| Table | Description |
|-------|-------------|
| `user_sessions` | Staff signed-in devices / JWT sessions |
| `user_login_events` | Staff login history |
| `customer_portal_sessions` | Customer portal sessions |
| `customer_otp_challenges` | Portal OTP challenges |
| `customer_password_tokens` | Portal password tokens |
| `contact_products` / `account_products` | **Dropped** — use `inventory.products` |
| `automation_rules` | If/then rules on ticket create/update |
| `org_api_keys` | Integration API keys |
| `org_widgets` | Embeddable help widgets |
| `ticket_event_outbox` | Webhook delivery outbox |
| `conversation_contexts` | Co-worker chat state |
| `workflow_events` | Workflow / agent event history |

---

## Part 3 — Quick identity rules

| Field | Meaning |
|-------|---------|
| `tickets.id` | Canonical UUID — use for FKs / internal joins |
| `tickets.ticket_number` | Human id `#13218` — use in UI / API paths / NLU |
| Child `ticket_id` (notes, presence, …) | UUID → `tickets.id` |
| Proactive `ticket_id` | UUID string of `tickets.id` (TEXT, no FK) |
| Proactive `ticket_number` | Same as `tickets.ticket_number` |

---

## See also

- [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md) — hub/spoke SoR rules
- [ticketing-schema.md](./ticketing-schema.md) — full column reference including MyAccount tables
- [ticketing-customer-metrics.md](./ticketing-customer-metrics.md) — customer-grain metric formulas
- [proactive-agents.md](./proactive-agents.md) — proactive agent behavior
