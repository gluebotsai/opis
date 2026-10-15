# Ticketing synthetic data spec (3 years)

**Schema:** `ticketing` (Postgres). Tenant key is `organization_id` = `accounts.organizations.id`.  
**Window:** 2023-10-01 through 2026-10-01 (org timezone `Asia/Kolkata` for “today” / due-today).  
**Goal:** one lab org whose tickets, people, SLA, notes, and audit rows stay consistent so UI lists, filters, role scopes, and analytics all read real rows.

This file is the generator contract: **section 3 is the full schema** (table purpose + every column). Volumes, mixes, scenarios, and consistency rules below stay the generation plan.  
Sample rows and extra notes: [ticketing-table-catalog.md](./ticketing-table-catalog.md).  
Joins and role scopes: [ticketing-sql-agent-guide.md](./ticketing-sql-agent-guide.md), [ticketing-accounts-agent-scope.md](./ticketing-accounts-agent-scope.md).  
Metric formulas: [ticketing-metric-catalog-calculations.md](./ticketing-metric-catalog-calculations.md).

There is **no tags table** and **no separate comments table**. Categories and skills are text on `tickets`. Public replies and internal notes are both `ticket_notes`. Customers are `contact_profile` plus CDP, not a `customers` table. Staff ticket FKs are `agents.id`, not `accounts.setup_users.id`.

Do not insert into dropped tables: `organizations`, `users`, `customers`, `accounts`, `products`, `contact_products`, `account_products`, `customer_products`.

---

## 1. What must exist before spoke rows

| Hub table | Why the generator needs it | Spoke link |
|-----------|----------------------------|------------|
| `accounts.organizations` | Tenant | `*.organization_id` |
| `accounts.setup_users` | Staff name, email, skills | `agents.setup_user_id` |
| `accounts.setup_user_product_access` + `setup_roles` | Role `admin` / `agent` / `resolver` / `viewer`, product `ticketing` | mirrored on `agents.role` |
| `cdp.customer_profile` | Person name, `contact_type` (`lead` or `customer`) | `contact_profile.cdp_id` |
| `cdp.identity_keys` | Email and phone (`key_type`) | same `cdp_id` + org |
| `cdp.orders` / `order_items` | Optional 360 only | by `cdp_id`, not ticket volume |

`tickets.customer_name`, `customer_email`, and `customer_phone` are snapshots of CDP at create time. `assignee_name` / `resolver_name` are snapshots of staff names. Ids are the source of truth.

---

## 2. Insert order

1. Hub org, staff, product access, CDP people and identity keys.
2. `org_settings`, `ticket_statuses`, `sla_policy_defaults`, `sla_policies`.
3. `agents` (after `setup_users` exist).
4. `ticketing_accounts`, then `contact_profile`.
5. `agent_queues`, then `agent_queue_members` (`user_id` = `agents.id`).
6. `tickets`.
7. `ticket_notes`, `audit_events`, `activity_logs`, `notifications`, `email_message_refs`, `outbound_email_log`.
8. Recompute caches from tickets: `agent_queues.open_tickets` / `assigned` / `sla_status`, `contact_profile.total_tickets`, `dashboard_metrics`.
9. Small catalogs: `kb_articles`, `macros`, `automation_rules`, `org_widgets`, `org_api_keys`.
10. Sparse history: sessions, login events, portal sessions, presence.
11. Optional: proactive, coworker chat, agent memory.

---

## 3. Schema (every table and column)

Spoke schema is `ticketing`. Almost every row is scoped by `organization_id` = `accounts.organizations.id`.

Shared categoricals:

| Domain | Allowed values |
|--------|----------------|
| Active / Inactive | `Active`, `Inactive` |
| Agent role | `admin`, `agent`, `resolver`, `customer`, `viewer` |
| Portal auth | `otp`, `password` |
| Ticket status | `Open`, `Pending`, `Reopened`, `Resolved`, `Overdue` (+ custom via `ticket_statuses`) |
| Ticket priority | `urgent`, `high`, `medium`, `low` |
| Ticket channel | `Email`, `Chat`, `Phone`, `Web` |
| Note visibility | `internal`, `public` |
| Queue type | `Private`, `Shared` |
| Queue SLA | `On Track`, `At Risk` |
| KB status | `Published`, `Draft` |
| Notification kind | `assignment`, `update`, `sla`, `security`, `product` |
| OTP channel | `email`, `phone` |
| Automation event | `ticket.created`, `ticket.updated` |
| CSAT | integer `1`–`5` |
| MyAccount business type | `b2b`, `b2c` |

Status meaning on `tickets.status` (must match `ticket_statuses`):

| Value | Terminal? | Meaning |
|-------|-----------|---------|
| `Open` | No | New / not yet in progress |
| `Pending` | No | In progress (UI label “In Progress”) |
| `Reopened` | No | Was resolved, then reopened |
| `Resolved` | Yes | Closed |
| `Overdue` | No | Past SLA, still unresolved |

### 3.1 Hub tables the generator must create first

Ticketing does not own these. A lab load still has to insert them before spoke rows, because spoke foreign keys point here. Do not invent a second copy of name/email inside `contact_profile` or `agents`.

#### `accounts.organizations`

Tenant company. `id` is the ticketing `organization_id`.

| Column | Meaning |
|--------|---------|
| `id` | Tenant id |
| `company_name` | Display company name |
| `business_type` | `b2b` or `b2c` |
| `support_portal_*` | Hub portal labels (spoke also stores `org_settings.portal_*`) |

#### `accounts.setup_users` (+ product access)

Staff identity. `setup_users.id` = `agents.setup_user_id`. It is **not** `tickets.assignee_id`.

| Column / table | Meaning |
|----------------|---------|
| `id` | MyAccount staff id |
| name, email, skills, password | Staff source of truth |
| `setup_user_product_access` | Must include `product_id = 'ticketing'` for this org |
| `setup_roles` | Role names `admin`, `agent`, `resolver`, `viewer` |
| `setup_teams` | Optional hub teams. Queues still live in the spoke |

#### `cdp.customer_profile`

Person. Join key is `cdp_id` + `organization_id` = `contact_profile.cdp_id`.

| Column | Meaning |
|--------|---------|
| `cdp_id` | Person id |
| `organization_id` | Tenant |
| `first_name`, `last_name` | Display name copied onto `tickets.customer_name` at create time |
| `city`, `region`, `country` | Location |
| `contact_type` | `lead` or `customer` (both may have tickets) |
| `blocked` | Block flag |
| `custom_fields` | JSON extras |
| `created_at` | When the person was created in CDP |

#### `cdp.identity_keys`

Email and phone. Same `cdp_id` and `organization_id`.

| Column | Meaning |
|--------|---------|
| `cdp_id` | Person |
| `organization_id` | Tenant |
| `key_type` | `email`, `phone`, or `customer_id` |
| `key_value` | The email, phone, or external id. Copied onto `tickets.customer_email` / `customer_phone` at create time |

#### `cdp.orders` / `cdp.order_items` (optional 360)

Not ticket volume. Link by `contact_profile.cdp_id`.

| `cdp.orders` column | Meaning |
|--------------------|---------|
| `order_id` | bigint primary key |
| `organization_id` | Tenant |
| `cdp_id` | Buyer |
| `order_number` | Human order number |
| `status` | Order status |
| `payment_status` | Payment status |
| `fulfillment_status` | Fulfillment status |
| `total_amount` | Amount |
| `currency` | Currency code |
| `custom_fields` | JSON |
| `created_at` | Ordered at |

| `cdp.order_items` column | Meaning |
|--------------------------|---------|
| `organization_id` | Tenant |
| `order_id` | Parent order |
| `product_id` | Line product |
| `quantity` | Quantity |
| `unit_price` | Unit price when present |
| `custom_fields` | sku / title / name |

`cdp.products` (`sku`, `product_name`) and `inventory.products` are catalog only. Do not treat them as ticket volume, and do not recreate dropped product-link tables.

### 3.2 Spoke tables

#### `ticketing.org_settings`

Spoke org preferences. Company display name comes from `accounts.organizations.company_name`, not here.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `organization_id` | bigint | NO | — | Primary key. FK → `accounts.organizations.id` |
| `ticket_prefix` | text | NO | — | Prefix for ticket numbers, usually `#` |
| `portal_label` | text | YES | — | Optional support-portal branding label |
| `display_timezone` | text | NO | — | Timezone for “due today” and display dates |
| `portal_auth_mode` | text | NO | `otp`, `password` | How customers log into the portal |
| `portal_slug` | text | YES | — | URL slug for `/support/{slug}` and `/hc/{slug}` |
| `portal_logo_url` | text | YES | — | Optional portal logo URL |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.agents`

Staff bridge. Local `id` is the id on tickets, sessions, notes, and queue membership. Name, email, password, and skills live on `accounts.setup_users` via `setup_user_id`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Local primary key. This is `assignee_id`, `resolver_id`, `created_by_id`, and session `user_id` |
| `organization_id` | bigint | NO | — | FK → `accounts.organizations.id` |
| `setup_user_id` | bigint | NO | — | FK → `accounts.setup_users.id`. Required and unique. Not a ticket assignee id |
| `support_email` | text | YES | — | Optional spoke email copy used for mail |
| `support_phone` | text | YES | — | Optional spoke phone |
| `status` | text | NO | `Active`, `Inactive` | Whether this person can be assigned and can log in |
| `role` | text | NO | `admin`, `agent`, `resolver`, `customer`, `viewer` | Spoke RBAC role. `agent` is L1. `resolver` is L2 |
| `last_login_at` | timestamptz | YES | — | Last staff console login |
| `two_factor_enabled` | boolean | NO | `true`, `false` | Account-settings 2FA flag |
| `language` | text | NO | — | UI language preference |
| `timezone` | text | NO | — | Personal timezone |
| `date_format` | text | NO | — | Date display preference |
| `notify_ticket_assignments` | boolean | NO | `true`, `false` | Pref: assignment notifications |
| `notify_ticket_updates` | boolean | NO | `true`, `false` | Pref: update notifications |
| `notify_security_alerts` | boolean | NO | `true`, `false` | Pref: security notifications |
| `notify_sla_alerts` | boolean | NO | `true`, `false` | Pref: SLA notifications |
| `notify_product_updates` | boolean | NO | `true`, `false` | Pref: product notifications |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.user_sessions`

Staff console signed-in devices. `user_id` → `agents.id`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Session primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | NO | — | FK → `agents.id` |
| `device_label` | text | YES | — | Friendly device label |
| `browser` | text | YES | — | Browser name |
| `os` | text | YES | — | OS name |
| `location` | text | YES | — | Coarse location label |
| `user_agent` | text | YES | — | Raw User-Agent |
| `ip_address` | text | YES | — | Client IP |
| `is_current` | boolean | NO | `true`, `false` | Marked as the current session |
| `last_active_at` | timestamptz | YES | — | Last activity |
| `created_at` | timestamptz | NO | — | Session start |
| `revoked_at` | timestamptz | YES | — | Null means still valid |

#### `ticketing.user_login_events`

Append-only staff login history for the account security UI.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Event primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | NO | — | FK → `agents.id` |
| `device_label` | text | YES | — | Device label at login |
| `location` | text | YES | — | Location label |
| `ip_address` | text | YES | — | IP at login |
| `created_at` | timestamptz | NO | — | Login time |

#### `ticketing.contact_profile`

Support contact ops and customer portal credentials. There are **no** `name`, `email`, or `phone` columns. Those come from CDP via `cdp_id`. Cases point here with `tickets.customer_id`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Local contact primary key. This is `tickets.customer_id` |
| `organization_id` | bigint | NO | — | Tenant |
| `external_id` | text | YES | — | Optional external or CRM id |
| `cdp_id` | text | NO | — | CDP person id. Unique per org. Matches `cdp.customer_profile.cdp_id` |
| `status` | text | NO | `Active`, `Inactive` | Whether the contact can be used for new tickets and portal login |
| `total_tickets` | integer | NO | — | Cached count of this contact’s tickets. Derive after load |
| `account_id` | bigint | YES | — | Optional FK → `ticketing_accounts.id` (B2B client company) |
| `password_hash` | text | YES | — | Portal password hash. Null when the portal is OTP-only. Never store a real password |
| `password_set_at` | timestamptz | YES | — | When the portal password was set |
| `last_portal_login_at` | timestamptz | YES | — | Last portal login |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.customer_portal_sessions`

Signed-in customer portal sessions.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Session primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `customer_id` | bigint | NO | — | FK → `contact_profile.id` |
| `device_label` | text | YES | — | Device label |
| `ip_address` | text | YES | — | Client IP |
| `user_agent` | text | YES | — | User-Agent |
| `last_active_at` | timestamptz | NO | — | Last activity |
| `created_at` | timestamptz | NO | — | Session start |
| `revoked_at` | timestamptz | YES | — | Null means still active |

#### `ticketing.customer_otp_challenges`

One-time password challenges for portal login. Store a hash only.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Challenge primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `customer_id` | bigint | NO | — | FK → `contact_profile.id` |
| `identifier` | text | NO | — | Email or phone the OTP was sent to |
| `channel` | text | NO | `email`, `phone` | Delivery channel |
| `code_hash` | text | NO | — | Hash of the OTP code |
| `attempts` | integer | NO | — | Failed verify attempts |
| `expires_at` | timestamptz | NO | — | Expiry |
| `consumed_at` | timestamptz | YES | — | When it was successfully used |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.customer_password_tokens`

One-time tokens for portal password set/reset links. Store a hash only.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Token primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `customer_id` | bigint | NO | — | FK → `contact_profile.id` |
| `token_hash` | text | NO | — | Hash of the raw token |
| `expires_at` | timestamptz | NO | — | Expiry |
| `consumed_at` | timestamptz | YES | — | When it was used |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.ticketing_accounts`

B2B client companies inside Ticketing (the customer’s company). This is **not** MyAccount `accounts.*`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | B2B account primary key |
| `organization_id` | bigint | NO | — | Tenant (the support org) |
| `name` | text | NO | — | Client company name |
| `status` | text | NO | `Active`, `Inactive` | Whether contacts may be linked |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.agent_queues`

Support teams / queues used for routing and workload.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Queue primary key. This is `tickets.queue_id` |
| `organization_id` | bigint | NO | — | Tenant |
| `external_id` | text | YES | — | Optional external id |
| `queue_name` | text | NO | — | Team or queue display name. Copied onto `tickets.queue_name` |
| `description` | text | NO | — | What this queue handles |
| `type` | text | NO | `Private`, `Shared` | Queue visibility |
| `open_tickets` | integer | NO | — | Cached count of tickets on this queue whose status is not `Resolved`. Derive after load |
| `assigned` | integer | NO | — | Cached count of those open tickets whose `assignee_name` is not `Unassigned`. Derive after load |
| `sla_status` | text | NO | `On Track`, `At Risk` | `At Risk` when any ticket on the queue has status `Overdue`; otherwise `On Track` |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.agent_queue_members`

Which staff belong to which queue. `user_id` is `agents.id`, not a MyAccount id.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Membership primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `queue_id` | bigint | NO | — | FK → `agent_queues.id` |
| `user_id` | bigint | NO | — | FK → `agents.id` |
| `created_at` | timestamptz | NO | — | When the member was added |

#### `ticketing.tickets`

Core support cases. This is the fact table for lists, filters, SLA, CSAT, and analytics.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Ticket primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_number` | text | NO | — | Human number, unique per org, prefix plus sequence (example `#20`) |
| `subject` | text | NO | — | Short title |
| `description` | text | YES | — | Full issue / intake body |
| `status` | text | NO | `Open`, `Pending`, `Reopened`, `Resolved`, `Overdue`, plus a custom status if seeded | Lifecycle status. Open vs closed uses `ticket_statuses.is_terminal` |
| `priority` | text | NO | `urgent`, `high`, `medium`, `low` | SLA priority key. Must match `sla_policies.priority` |
| `channel` | text | NO | `Email`, `Chat`, `Phone`, `Web` | How the ticket arrived |
| `category` | text | YES | `Billing`, `Troubleshooting`, `Accounts`, `General`, plus free text | Triage category. There is no tags table |
| `skill` | text | YES | — | Skill tag used for routing. Align it with the queue |
| `customer_id` | bigint | YES | — | FK → `contact_profile.id` |
| `customer_name` | text | YES | — | Snapshot of the CDP name at create time |
| `customer_email` | text | YES | — | Snapshot of the CDP email at create time |
| `customer_phone` | text | YES | — | Snapshot of the CDP phone at create time |
| `assignee_id` | bigint | YES | — | L1 agent. FK → `agents.id`. Null when unassigned |
| `assignee_name` | text | YES | person name, or `Unassigned` | Display copy of the L1 agent. Use `Unassigned` when `assignee_id` is null |
| `resolver_id` | bigint | YES | — | L2 resolver. FK → `agents.id` |
| `resolver_name` | text | YES | — | Display copy of the L2 resolver |
| `queue_id` | bigint | YES | — | FK → `agent_queues.id` |
| `queue_name` | text | YES | — | Display copy of the queue name |
| `attachments` | text[] | NO | — | Attachment storage keys. Use `{}` when there are none |
| `due_at` | timestamptz | YES | — | SLA resolution deadline. `created_at` plus that priority’s `resolution_hours` |
| `first_response_at` | timestamptz | YES | — | Time of the first public note. Null when nobody has replied |
| `resolved_at` | timestamptz | YES | — | When the ticket entered `Resolved`. Null for every non-terminal status, including `Reopened` |
| `csat_score` | integer | YES | `1`, `2`, `3`, `4`, `5` | Customer rating. Only after resolve. Promoter = 5. Detractor = 1 or 2 |
| `csat_rated_at` | timestamptz | YES | — | When CSAT was submitted. Null when `csat_score` is null. Never before `resolved_at` |
| `created_by_id` | bigint | YES | — | Staff creator. FK → `agents.id`. Null for portal or API creates |
| `created_by_name` | text | YES | — | Creator label: staff name, `Portal`, or `API:…` |
| `ai_summary` | text | YES | — | Short summary of the issue |
| `idempotency_key` | text | YES | — | Optional create key. Unique per org when set. Only on a small API subset |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at. At least as late as the latest note or audit on this ticket |

#### `ticketing.ticket_notes`

The conversation thread. Public replies and internal notes are both rows here. There is no separate comments table.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Note primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_id` | bigint | NO | — | FK → `tickets.id` |
| `author_id` | bigint | YES | — | FK → `agents.id`. Null when the author is the customer/portal |
| `author_name` | text | YES | — | Author display name |
| `body` | text | NO | — | Note or reply text |
| `visibility` | text | NO | `internal`, `public` | `internal` is staff-only. `public` is customer-visible and can set `first_response_at` |
| `created_at` | timestamptz | NO | — | Created at. Must fall between ticket create and ticket `updated_at` |

#### `ticketing.ticket_presence`

Who is currently viewing a ticket.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_id` | bigint | NO | — | FK → `tickets.id` |
| `user_id` | bigint | NO | — | FK → `agents.id` |
| `user_name` | text | YES | — | Viewer display name |
| `last_seen_at` | timestamptz | NO | — | Last heartbeat. Only seed a few open tickets with a recent timestamp |

#### `ticketing.ticket_statuses`

Per-org catalog of allowed statuses. `tickets.status` must exist here.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Row primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `status` | text | NO | `Open`, `Pending`, `Reopened`, `Resolved`, `Overdue` | Stored status key |
| `display_name` | text | NO | — | UI label. `Pending` displays as `In Progress` |
| `is_system` | boolean | NO | `true`, `false` | Built-in rows are not deletable |
| `is_terminal` | boolean | NO | `true`, `false` | `true` only for `Resolved`. This is how analytics decide open vs closed |
| `sort_order` | integer | NO | — | Picker order: Open 1, Pending 2, Reopened 3, Resolved 4, Overdue 5 |
| `active` | boolean | NO | `true`, `false` | Available for use |

#### `ticketing.sla_policy_defaults`

Global default SLA hours by priority. Not org-scoped. Seed once.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `priority` | text | NO | `urgent`, `high`, `medium`, `low` | Priority key |
| `resolution_hours` | integer | NO | — | Hours from create to `due_at`. urgent 4, high 8, medium 24, low 72 |
| `first_response_hours` | integer | NO | — | Hours allowed until first public reply. urgent 1, high 2, medium 4, low 8 |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.sla_policies`

Per-org SLA windows. These are what actually drive `tickets.due_at`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Row primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `priority` | text | NO | `urgent`, `high`, `medium`, `low` | Priority key |
| `display_name` | text | YES | — | UI label (`Urgent`, `High`, `Medium`, `Low`) |
| `resolution_hours` | integer | NO | — | Hours from create to due. Same defaults as `sla_policy_defaults` |
| `first_response_hours` | integer | NO | — | Hours to first response |
| `active` | boolean | NO | `true`, `false` | In use |

#### `ticketing.activity_logs`

Short human-readable lines for the home activity feed.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Row primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_id` | bigint | YES | — | Related ticket |
| `text` | text | NO | — | One-line activity text, for example `Ticket #14 updated` |
| `created_at` | timestamptz | NO | — | When it was logged |

#### `ticketing.audit_events`

Append-only history of important changes. Reassignment rate, escalation rate, and the dashboard “Reassigned out” tile read this table, not a column on `tickets`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Event primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `actor_id` | bigint | YES | — | Agent who acted. FK → `agents.id` |
| `actor_name` | text | YES | — | Actor display name at that time |
| `action` | text | NO | `ticket.created`, `ticket.updated`, `ticket.status_changed`, `ticket.assigned`, `ticket.escalated`, `ticket.resolver_set` | What changed |
| `ticket_id` | bigint | YES | — | Related ticket |
| `ticket_number` | text | YES | — | Ticket number snapshot |
| `meta` | jsonb | NO | — | Change details. Assignment uses `{from, to, assigneeId}`. Resolver uses `{from, to, resolverId}` |
| `created_at` | timestamptz | NO | — | When it was audited |

`ticket.assigned` is written on the **first** L1 assignment and on every later L1 change. A ticket was reassigned only when this action appears more than once for that `ticket_id`.

#### `ticketing.kb_articles`

Knowledge-base articles for the help center and agent assist.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Article primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `external_id` | text | YES | — | Optional external id |
| `title` | text | NO | — | Title |
| `content` | text | NO | — | Body |
| `category` | text | NO | `Billing`, `Troubleshooting`, `Accounts`, `General`, or free text | Category. Align with ticket categories |
| `author_name` | text | NO | — | Author display name |
| `author_id` | bigint | YES | — | FK → `agents.id` |
| `status` | text | NO | `Published`, `Draft` | Publish state |
| `views` | integer | NO | — | View counter |
| `attachments` | text[] | NO | — | Attachment refs. Use `{}` when empty |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.macros`

Saved reply templates.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Macro primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `title` | text | NO | — | Name shown in the picker |
| `body` | text | NO | — | Template body |
| `created_by_id` | bigint | YES | — | Creator. FK → `agents.id` |
| `created_by_name` | text | YES | — | Creator name |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.notifications`

In-app inbox for staff. `user_id` → `agents.id`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Notification primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | YES | — | Recipient. FK → `agents.id` |
| `title` | text | NO | — | Title |
| `message` | text | NO | — | Body |
| `ticket_id` | bigint | YES | — | Related ticket |
| `customer_name` | text | YES | — | Related customer label |
| `is_read` | boolean | NO | `true`, `false` | Read state. Leave some unread |
| `kind` | text | YES | `assignment`, `update`, `sla`, `security`, `product` | Preference bucket |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.dashboard_metrics`

Cached home KPI snapshot. One row per org. Derive the counts from `tickets`. Do not invent them.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Row primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `open_tickets` | integer | NO | — | Count of non-terminal tickets |
| `on_hold` | integer | NO | — | Legacy hold count. Keep `0` |
| `overdue` | integer | NO | — | Count of tickets past `due_at` that are still open |
| `due_today` | integer | NO | — | Count due on the org-local current day |
| `unassigned` | integer | NO | — | Count with no L1 assignee |
| `open_change` | text | NO | — | Trend label versus the prior period. Use `—` if unknown |
| `on_hold_change` | text | NO | — | Trend label |
| `overdue_change` | text | NO | — | Trend label |
| `due_today_change` | text | NO | — | Trend label |
| `unassigned_change` | text | NO | — | Trend label |
| `captured_at` | timestamptz | NO | — | Snapshot time |

#### `ticketing.automation_rules`

If/then rules on ticket create or update. `priority` here is rule order, not ticket priority.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Rule primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `name` | text | NO | — | Rule name |
| `event` | text | NO | `ticket.created`, `ticket.updated` | Trigger |
| `enabled` | boolean | NO | `true`, `false` | Whether the rule runs |
| `priority` | integer | NO | — | Evaluation order. Lower runs first |
| `conditions` | jsonb | NO | — | Match conditions |
| `actions` | jsonb | NO | — | Actions to apply |
| `created_by_id` | bigint | YES | — | Creator. FK → `agents.id` |
| `created_by_name` | text | YES | — | Creator name |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.org_api_keys`

Integration API keys for website and email intake. Store a hash, never the raw secret.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Key primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `name` | text | NO | — | Label, for example `Website + email integrations` |
| `key_prefix` | text | NO | — | Public prefix shown in the UI (`wt_live_…`) |
| `key_hash` | text | NO | — | Hash of the secret |
| `created_by_id` | bigint | YES | — | Creator. FK → `agents.id` |
| `created_by_name` | text | YES | — | Creator name |
| `last_used_at` | timestamptz | YES | — | Last successful use |
| `revoked_at` | timestamptz | YES | — | Null means active |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.org_widgets`

Embeddable help-widget configuration.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Widget primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `name` | text | NO | — | Widget name |
| `config` | jsonb | YES | — | Widget JSON config |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

#### `ticketing.email_message_refs`

Maps an inbound email `Message-ID` to a ticket so later replies thread onto the same case. Only for `channel = Email`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Row primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `message_id` | text | NO | — | Email Message-ID header |
| `ticket_id` | bigint | NO | — | FK → `tickets.id` |
| `ticket_number` | text | NO | — | Ticket number snapshot |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.outbound_email_log`

Log of outbound mail.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Log primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_id` | bigint | YES | — | Related ticket |
| `ticket_number` | text | YES | — | Ticket number |
| `kind` | text | NO | `ticket_created`, `ticket_reply`, `ticket_resolved`, `staff_ticket_created`, `sla_reminder_1h`, `sla_breach_admin`, `dssa_deflection`, `portal_otp`, `portal_set_password`, `not_registered_customer` | Which mail flow |
| `to_email` | text | NO | — | Recipient |
| `subject` | text | NO | — | Subject |
| `body_preview` | text | YES | — | Short body preview |
| `status` | text | NO | `queued`, `sent`, `failed`, `skipped` | Delivery outcome |
| `error` | text | YES | — | Failure reason. Null when sent |
| `created_at` | timestamptz | NO | — | When it was logged |

#### `ticketing.ticket_event_outbox`

Webhook / event delivery queue for ticket changes.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Outbox primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `event_type` | text | NO | example `ticket.updated` | Event type |
| `payload` | jsonb | NO | — | Event JSON |
| `webhook_url` | text | YES | — | Delivery URL |
| `status` | text | NO | `queued`, `pending`, `delivered`, `failed` | Delivery state |
| `attempts` | integer | NO | — | Attempt count |
| `last_error` | text | YES | — | Last error |
| `created_at` | timestamptz | NO | — | Created at |
| `delivered_at` | timestamptz | YES | — | Delivered at |

#### `ticketing.conversation_contexts`

Co-worker chat state (active and parked workflows, recent history). Not one row per ticket.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Context primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | YES | — | Optional FK → `agents.id` |
| `user_key` | text | NO | — | Stable chat user key |
| `session_key` | text | NO | — | Chat session key |
| `context` | jsonb | NO | — | State JSON (workflows, history) |
| `version` | bigint | NO | — | Optimistic concurrency version |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |
| `expires_at` | timestamptz | YES | — | Expiry |

#### `ticketing.workflow_events`

Chat workflow event history.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Event primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | YES | — | Optional agent |
| `user_key` | text | NO | — | Chat user key |
| `session_key` | text | NO | — | Session key |
| `request_id` | text | NO | — | Per-turn request id |
| `conversation_context_id` | bigint | YES | — | FK → `conversation_contexts.id` |
| `workflow_id` | text | YES | — | Workflow instance id |
| `workflow_type` | text | NO | example `create_ticket` | Workflow type |
| `event_type` | text | NO | example `workflow_started` | Event type |
| `event_data` | jsonb | NO | — | Payload |
| `version` | bigint | NO | — | State version |
| `created_at` | timestamptz | NO | — | Created at |
| `expires_at` | timestamptz | YES | — | Expiry |

#### `ticketing.proactive_outbox`

Events consumed by proactive agents. `ticket_id` is **text**. Cast it when joining `tickets.id`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Event primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `event_type` | text | NO | `ticket.created`, `ticket.updated`, `ticket.comment_added`, `customer.replied`, `ticket.escalated`, `ticket.sla_at_risk`, `inbound.message`, `schedule.sema`, `schedule.wloa`, `schedule.tiaa`, `schedule.rcaa` | Event type |
| `ticket_id` | text | YES | — | Related ticket id as text |
| `ticket_number` | text | YES | — | Ticket number |
| `actor` | text | YES | — | Who triggered it |
| `payload` | jsonb | NO | — | Event payload |
| `created_at` | timestamptz | NO | — | Created at |
| `processed_at` | timestamptz | YES | — | When it was consumed |

#### `ticketing.proactive_recommendations`

Suggestions shown to agents. `agent_id` here is a proactive code (`sema`, `wloa`, `tiaa`, `rcaa`), not `agents.id`.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Recommendation primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `agent_id` | text | YES | `sema`, `wloa`, `tiaa`, `rcaa` | Proactive agent code |
| `ticket_id` | text | YES | — | Related ticket id as text |
| `status` | text | NO | `open`, `accepted`, `dismissed` | `open` = waiting, `accepted` = taken, `dismissed` = rejected by the agent |
| `payload` | jsonb | YES | — | Recommendation content |
| `reason` | text | YES | — | Why it was recommended |
| `dedupe_key` | text | YES | — | Dedup key |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.proactive_approvals`

Human approval for a proactive tool action.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Approval primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `agent_id` | text | YES | proactive code | Which proactive agent |
| `ticket_id` | text | YES | — | Related ticket id as text |
| `status` | text | NO | `pending`, `approved`, `rejected` | Human decision |
| `tool_name` | text | YES | — | Tool awaiting approval |
| `payload` | jsonb | YES | — | Tool arguments / context |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.proactive_audit`

Proactive decision log.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Audit primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `agent_id` | text | YES | proactive code | Which agent decided |
| `ticket_id` | text | YES | — | Related ticket id as text |
| `event_id` | text | YES | — | Related outbox event |
| `decision` | text | YES | example `execute`, `skip` | Decision outcome |
| `reason` | text | YES | — | Why |
| `tool_name` | text | YES | — | Tool involved |
| `payload` | jsonb | YES | — | Decision details |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.proactive_embeddings`

Embedding tokens for proactive similarity search. Optional for a lab load.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Row primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `token` | text | YES | — | Embedding key |
| `embedding` | vector or text | YES | — | Vector or serialized embedding |
| `created_at` | timestamptz | NO | — | Created at |

#### `ticketing.proactive_routing_weights`

One row per org: learned routing weights and recurring-issue hints.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `organization_id` | bigint | NO | — | Primary key / tenant |
| `weights` | jsonb | NO | — | Skill weights and recurring issues |
| `updated_at` | timestamptz | NO | — | Last learning update |

#### `ticketing.agent_user_preferences`

Co-worker preference scratchpad. Not a ticket analytics source.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `organization_id` | bigint | NO | — | Tenant. Part of the primary key |
| `user_key` | text | NO | — | Staff preference key. Part of the primary key |
| `soft` | jsonb | NO | JSON object | Soft preferences |
| `hard` | jsonb | NO | JSON object | Hard constraints |
| `updated_at` | timestamptz | NO | — | Last update |

#### `ticketing.agent_long_term_memory`

Durable co-worker facts. Not required for ticket analytics.

| Column | Type | Null | Allowed values | Description |
|--------|------|------|----------------|-------------|
| `id` | bigint | NO | — | Primary key |
| `organization_id` | bigint | NO | — | Tenant |
| `user_key` | text | NO | — | Staff or actor key |
| `conversation_id` | text | YES | — | Optional conversation scope |
| `kind` | text | NO | default `fact` | Memory kind |
| `content` | text | NO | — | Fact text |
| `payload` | jsonb | NO | JSON object | Structured extras |
| `created_at` | timestamptz | NO | — | Created at |

---

## 4. How to populate (volumes and mixes)

### Catalog and identity

Staff mix for one org: 2 admins, 1 viewer, 8–12 agents (L1), 4–6 resolvers (L2). About 10% `Inactive`. Every active agent belongs to 1–2 queues. One private queue with two members.

Contacts: 250–400. About 70% `Active`. About 40% linked to a B2B account (8–15 accounts, one inactive). CDP `contact_type` mixed `lead` and `customer` so both still have tickets. A few contacts with zero tickets. A few inactive contacts with old tickets only.

### Tickets (fact table)

Populate every column on `tickets`:

`organization_id`, `ticket_number` (unique, prefix + sequence), `subject`, `description`, `status`, `priority`, `channel`, `category`, `skill`, `customer_id`, name/email/phone snapshots, `assignee_id`, `assignee_name`, `resolver_id`, `resolver_name`, `queue_id`, `queue_name`, `attachments`, `due_at`, `first_response_at`, `resolved_at`, `csat_score`, `csat_rated_at`, `created_by_id`, `created_by_name`, `ai_summary`, `idempotency_key` (only on a small API subset), `created_at`, `updated_at`.

`due_at` = `created_at` + that priority’s `resolution_hours`.

| Status | Share of all tickets | Rules |
|--------|----------------------|-------|
| Resolved | ~62% | `resolved_at` set, `is_terminal` true, CSAT only after resolve |
| Pending | ~14% | open, usually has assignee, `resolved_at` null |
| Open | ~10% | includes a real unassigned slice |
| Overdue | ~8% | still open, `due_at` < now, `resolved_at` null |
| Reopened | ~6% | was resolved, then reopened; `resolved_at` null again |

Priority: low 40%, medium 35%, high 18%, urgent 7%.  
Channel: Email 45%, Web 25%, Chat 20%, Phone 10%.  
Category: Billing, Troubleshooting, Accounts, General, plus queue themes (orders, shipping, returns, payments, product, loyalty, network).  
`skill` aligns with queue (billing, shipping, returns, account-access, network).

Assignee / resolver:

- ~12% L1 unassigned: `assignee_id` null and `assignee_name` = `Unassigned`.
- ~25% L1 only, no resolver.
- ~55% both L1 and L2.
- ~8% resolver set, L1 still unassigned (escalation edge).
- Names must match the agent row. Never put `setup_users.id` in `assignee_id` or `resolver_id`.
- `created_by_id` set on ~40% (staff-filed). Rest `created_by_name` like `API:Email` or `Portal`.

SLA cases to include on purpose:

- First response inside target, resolution inside target.
- First response late, resolution on time.
- Resolved after `due_at` (historical breach; status can still be Resolved).
- Open and `due_at` in the past (`Overdue`, and some still `Open`/`Pending` so both status filter and due-date filter work).
- Due today and due within 4 hours (at risk).
- No `first_response_at` yet (unanswered).
- `first_response_at` set from the first **public** note time.

CSAT: only on resolved tickets, ~45% of those rated. Scores 1–5, more 4–5 than 1–2. `csat_rated_at` after `resolved_at`. Promoters are 5. Detractors are 1–2.

Attachments: empty array on most rows; a few with 1–2 fake storage keys.

### Conversation, audit, mail

| Table | Purpose | Populate |
|-------|---------|----------|
| `ticket_notes` | Public replies and internal notes | `ticket_id`, `author_id`, `author_name`, `body`, `visibility` `public`/`internal`, `created_at` between create and resolve/update |
| `audit_events` | History for reassignment, escalation, created-by-me | `actor_id`, `actor_name`, `action`, `ticket_id`, `ticket_number`, `meta`, `created_at` |
| `activity_logs` | Home feed | short `text` per major change |
| `notifications` | In-app alerts | `user_id` = agent, `kind` `assignment`/`update`/`sla`/`security`/`product`, some unread |
| `email_message_refs` | Inbound email → ticket | email-channel tickets only |
| `outbound_email_log` | Mail actually sent | public replies and CSAT requests |
| `ticket_presence` | Who is viewing | only a handful of **current** open tickets, `last_seen_at` within minutes |

Audit actions and when to write them:

| Action | When |
|--------|------|
| `ticket.created` | Every ticket, at `created_at` |
| `ticket.assigned` | Every L1 change, including the first assign. `meta`: `{from, to, assigneeId}` |
| `ticket.resolver_set` | L2 set or changed. `meta`: `{from, to, resolverId}` |
| `ticket.escalated` | ~8% of tickets, instead of a plain assign when it is an escalation |
| `ticket.status_changed` | Each status move, including reopen |
| `ticket.updated` | Priority, queue, subject, category edits |

Reassignment test: some tickets have **two or more** `ticket.assigned` events. One event means first assignment only. Dashboard “Reassigned out” counts `ticket.assigned` and `ticket.escalated` where `actor_id` is the user and `meta.to` is not that user’s name.

Notes: 0 notes on some unanswered tickets; 1 public note whose time equals `first_response_at`; extra internal notes; a customer-visible reply after pending. Author is an agent, or a portal label when the customer replied.

### Reporting caches (derive, do not invent)

`agent_queues.open_tickets`: count of tickets on that queue whose status is not `Resolved`.  
`assigned`: those same rows whose `assignee_name` is not `Unassigned`.  
`sla_status`: `At Risk` if any ticket on the queue has status `Overdue`, else `On Track`.

`dashboard_metrics`: one row per org from the same rules the home KPI uses (open, overdue, due today, unassigned). `on_hold` stays 0.

`contact_profile.total_tickets`: count of that contact’s tickets.

### Smaller catalogs (not 3-year volume)

| Table | What to seed |
|-------|----------------|
| `kb_articles` | 15–30, mix `Published` and `Draft`, categories aligned with tickets, `views` varied, `author_id` an agent |
| `macros` | 8–12 reply templates |
| `automation_rules` | a few `ticket.created` / `ticket.updated` rules, one inactive |
| `org_api_keys` | 1–2 keys, store a hash only |
| `org_widgets` | 1 embed widget |
| `user_sessions` / `user_login_events` | recent staff logins across the 3 years, sparse |
| `customer_portal_sessions` | recent portal use for a subset of contacts |
| `customer_otp_challenges` / `customer_password_tokens` | mostly expired; no real secrets |
| `ticket_event_outbox` | a short recent webhook backlog, mostly sent |
| `conversation_contexts` / `workflow_events` | a few coworker threads, not one per ticket |
| `proactive_outbox`, `proactive_recommendations`, `proactive_approvals`, `proactive_audit` | last 90 days only. Recommendations: open, accepted, dismissed. Approvals: pending, approved, rejected. `ticket_id` is often text; cast when joining `tickets.id` |
| `proactive_embeddings` / `proactive_routing_weights` | one weights row per org; embeddings optional |
| `agent_user_preferences` / `agent_long_term_memory` | a few staff preference rows |

---

## 5. Volume and calendar shape

Steady state about **25 tickets per weekday**, about **8 on weekends**. Multiply by **2.5** in two incident months (for example a billing outage and a shipping peak). One quiet month at about half volume.

Rough total: **20,000–28,000 tickets** over 1,096 days. Notes about 2–4 per ticket that has a thread. Audit events about 2–6 per ticket.

Spread `created_at` across all 36 months so 7-day, 30-day, quarter, and year filters all return rows. Keep a live slice in the last 48 hours: created today, due today, overdue now, unassigned now, and one ticket being viewed.

Business hours 09:00–19:00 `Asia/Kolkata` for most creates. Put a minority at night so “after hours” still exists.

---

## 6. Scenario checklist

Generate explicit rows for each of these, not only random draws:

- Each status, priority, and channel, including combinations (urgent + overdue, low + resolved + CSAT 5).
- Unassigned L1, unassigned L2, both assigned, both empty.
- Reassigned at least twice; escalated once; resolver changed once.
- Reopened after resolve, with a later public note.
- SLA met, SLA breached then resolved, still overdue, due today, due soon, no first response.
- CSAT 1 through 5, and resolved with no CSAT.
- Email ticket with inbound ref and outbound log; chat, phone, and web with no email ref.
- Staff-created vs portal/API-created.
- Customer with many tickets, customer with one, B2B account with many contacts.
- Inactive agent left on old tickets only; active agent with a heavy open queue.
- Private queue vs shared queues; one queue with zero open tickets (`On Track`).
- Internal-only thread vs thread with public replies.
- Ticket with attachments; ticket with `idempotency_key`; ticket with `ai_summary`.
- Role views: admin org-wide, agent = `assignee_id`, resolver = `resolver_id` or `assignee_id`, viewer read-only.

---

## 7. Consistency rules

- Every `customer_id`, `assignee_id`, `resolver_id`, `queue_id`, `author_id`, and `actor_id` exists in the same org.
- `assignee_name` / `resolver_name` / `queue_name` match the joined row at the **end** of the timeline. Audit `meta.from` / `meta.to` show earlier names.
- `resolved_at` is null unless status is `Resolved`. Reopened tickets have a status-change audit after the old resolve, and `resolved_at` cleared.
- `csat_rated_at` is null when `csat_score` is null, and never before `resolved_at`.
- `updated_at` is at least the latest note or audit time.
- `first_response_at` equals the earliest public note, or stays null.
- Queue counters and `dashboard_metrics` are recomputed from tickets after the load.
- Do not copy production passwords, OTP codes, or live customer PII. Use a reserved lab domain for emails.
