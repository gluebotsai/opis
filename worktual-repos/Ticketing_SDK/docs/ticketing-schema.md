# Worktual Ticketing Schema Reference

**Hub/spoke:** Ticketing is a spoke. Org/staff SoR = MyAccount (`accounts.*`); person SoR = CDP; products = `inventory.products`. See [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md).  
**Never INSERT** into `accounts.organizations` / `accounts.setup_users` from Ticketing.

**Schemas used by this system**

| Schema | Owner | Role in Ticketing |
|--------|-------|-------------------|
| **`ticketing`** | Ticketing app | Ops data only (tickets, agents bridge, contact_profile, org_settings, …) |
| **`accounts`** | MyAccount | Org + staff identity (Ticketing **FK / read**; password updates on `setup_users` only) |
| **`cdp`** | CDP | Person name/email/phone via `contact_profile.cdp_id` |
| **`inventory`** | Inventory | Product catalog (no spoke product tables) |

**Scope:** Multi-tenant  
**Generated from:** live database introspection + hub cutover (`sql/013`–`017`)

### Naming warning

| Name | Meaning |
|------|---------|
| `accounts.*` (MyAccount schema) | MyAccount product tables |
| `ticketing.ticketing_accounts` | B2B **client** accounts *inside* Ticketing — **not** MyAccount |
| ~~`ticketing.organizations` / `users` / `customers` / `accounts` / `products`~~ | **Dropped** — do not use |

---

## MyAccount tables we use (`accounts`)

Only these MyAccount tables are referenced by Ticketing / AI assign. Other `accounts.*` tables exist for MyAccount itself but are not used here.

| # | Table | How Ticketing uses it |
|---|-------|------------------------|
| A1 | [accounts.organizations](#a1-accountsorganizations) | Tenant PK; `company_name` display |
| A2 | [accounts.setup_users](#a2-accountssetup_users) | Staff login identity, password hash, skills |
| A3 | [accounts.setup_roles](#a3-accountssetup_roles) | Role names (Admin / Agent / Resolver / Customer) |
| A4 | [accounts.setup_user_product_access](#a4-accountssetup_user_product_access) | Who has product `ticketing` access |
| A5 | [accounts.setup_teams](#a5-accountssetup_teams) | Optional teams (read); queues still in spoke for now |

---

## Ticketing tables (`ticketing`)

| # | Table | Description |
|---|-------|-------------|
| 1 | [org_settings](#1-org_settings) | Spoke prefs (`organization_id` → `accounts.organizations`) |
| 2 | [agents](#2-agents) | Staff bridge (`setup_user_id` → `accounts.setup_users`) |
| 3 | [user_sessions](#3-user-sessions) | Staff signed-in devices / JWT sessions (`user_id` → `agents.id`) |
| 4 | [user_login_events](#4-user-login-events) | Staff login history |
| 5 | [contact_profile](#5-customers) | Support contact ops + portal auth (`cdp_id` → CDP) |
| 6 | [customer_portal_sessions](#6-customer_portal_sessions) | Customer portal sessions |
| 7 | [customer_otp_challenges](#7-customer_otp_challenges) | OTP challenges for customer portal login |
| 8 | [customer_password_tokens](#8-customer_password_tokens) | Password set/reset tokens for customers |
| 9 | [ticketing_accounts](#9-accounts-ticketingaccounts) | B2B client accounts in Ticketing (not MyAccount) |
| 10–12 | ~~products / account_products / contact_products~~ | **Dropped** — use `inventory.products` |
| 13 | [agent_queues](#13-agent-queues) | Support teams / queues |
| 14 | [agent_queue_members](#14-agent_queue_members) | Queue membership (`user_id` → `agents.id`) |
| 15 | [tickets](#15-tickets) | Main support cases |
| 16 | [ticket_notes](#16-ticket_notes) | Conversation thread on a ticket |
| 17 | [ticket_presence](#17-ticket_presence) | Who is currently viewing a ticket |
| 18 | [ticket_statuses](#18-ticket_statuses) | Org-configurable ticket statuses |
| 19 | [activity_logs](#19-activity_logs) | Human-readable recent activity feed |
| 20 | [audit_events](#20-audit_events) | Append-only compliance audit trail |
| 21 | [kb_articles](#21-kb_articles) | Knowledge base articles |
| 22 | [macros](#22-macros) | Saved reply templates |
| 23 | [notifications](#23-notifications) | In-app user notifications |
| 24 | [dashboard_metrics](#24-dashboard_metrics) | Cached home dashboard KPIs |
| 25 | [sla_policy_defaults](#25-sla-policy-defaults) | Global default SLA hours by priority |
| 26 | [sla_policies](#26-sla-policies) | Per-org SLA windows by priority |
| 27 | [automation_rules](#27-automation-rules) | If/then rules on ticket create/update |
| 28 | [org_api_keys](#28-org-api-keys) | Integration API keys (`wt_live_…`) |
| 29 | [org_widgets](#29-org-widgets) | Embeddable Help widgets |
| 30 | [email_message_refs](#30-email-message-refs) | Inbound email Message-ID → ticket |
| 31 | [outbound_email_log](#31-outbound-email-log) | Outbound customer email log |
| 32 | [ticket_event_outbox](#32-ticket-event-outbox) | Webhook / event delivery outbox |
| 33 | [conversation_contexts](#33-conversation-contexts) | Co-worker / chat conversation state |
| 34 | [workflow_events](#34-workflow-events) | Workflow / agent event history |
| 35 | [proactive_outbox](#35-proactive-outbox) | Proactive agent event outbox |
| 36 | [proactive_recommendations](#36-proactive-recommendations) | Proactive suggestions for agents |
| 37 | [proactive_approvals](#37-proactive-approvals) | Pending tool/action approvals |
| 38 | [proactive_audit](#38-proactive-audit) | Proactive decision audit log |
| 39 | [proactive_embeddings](#39-proactive-embeddings) | Embedding tokens for proactive search |
| 40 | [proactive_routing_weights](#40-proactive-routing-weights) | Per-org proactive routing weights |

---

## 1. `org_settings`

**Description:** Spoke-only org preferences. `organization_id` **is** `accounts.organizations.id` (bigint FK). Display name comes from MyAccount `company_name`, not this table.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `organization_id` | bigint | NO | | PK; FK → `accounts.organizations.id` |
| `ticket_prefix` | text | NO | `#` | Prefix for ticket numbers |
| `portal_label` | text | YES | | Optional portal branding label |
| `display_timezone` | text | NO | `UTC` | Org display timezone |
| `portal_auth_mode` | text | NO | `otp` | `password` / `otp` |
| `portal_slug` | text | YES | | Help/portal slug (else accounts `support_portal_slug`) |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 2. `agents`

**Description:** Thin staff bridge. Local PK used for assignee / sessions / notes. Identity SoR is `accounts.setup_users` via required `setup_user_id`. **No** name/email/password columns.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | bigint | NO | identity | Primary key (ticket `assignee_id` / session `user_id`) |
| `organization_id` | bigint | NO | | FK → `accounts.organizations.id` |
| `setup_user_id` | bigint | NO | | FK → `accounts.setup_users.id` (unique) |
| `support_email` | text | YES | | Optional spoke support contact |
| `support_phone` | text | YES | | Optional spoke support phone |
| `status` | text | NO | `Active` | `Active` / `Inactive` |
| `role` | text | NO | `agent` | `admin` \| `agent` \| `resolver` \| `customer` \| `viewer` |
| `last_login_at` | timestamptz | YES | | Last successful login |
| `two_factor_enabled` | bool | NO | `false` | 2FA preference flag |
| `language` | text | NO | `English` | UI language |
| `timezone` | text | NO | `Asia/Kolkata` | User timezone |
| `date_format` | text | NO | `DD/MM/YYYY` | Date format preference |
| `notify_ticket_assignments` | bool | NO | `true` | Notify on assignments |
| `notify_ticket_updates` | bool | NO | `true` | Notify on ticket updates |
| `notify_security_alerts` | bool | NO | `true` | Notify on security alerts |
| `notify_sla_alerts` | bool | NO | `true` | Notify on SLA breaches |
| `notify_product_updates` | bool | NO | `false` | Notify on product updates |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

Staff display name / work email / phone / skills: join `accounts.setup_users`.

---

## 3. `user_sessions`

**Description:** Active/revoked staff login sessions used for “signed-in devices” and JWT `sessionId`.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key / session id |
| `organization_id` | bigint | NO | | FK → `accounts.organizations.id` |
| `user_id` | bigint | NO | | FK → `agents.id` (never raw `setup_users.id`) |
| `device_label` | text | NO | | Human device label |
| `browser` | text | YES | | Browser name |
| `os` | text | YES | | Operating system |
| `location` | text | NO | `Local` | Approx location label |
| `user_agent` | text | YES | | Raw User-Agent |
| `ip_address` | text | YES | | Client IP |
| `is_current` | bool | NO | `false` | Marks current session |
| `last_active_at` | timestamptz | NO | `now()` | Last activity |
| `created_at` | timestamptz | NO | `now()` | Session start |
| `revoked_at` | timestamptz | YES | | Set when logged out / revoked |

---

## 4. `user_login_events`

**Description:** Append-only staff login history for Account Settings security UI.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | bigint | NO | | FK → `accounts.organizations.id` |
| `user_id` | bigint | NO | | FK → `agents.id` |
| `device_label` | text | NO | | Device label at login |
| `location` | text | NO | `Local` | Location label |
| `ip_address` | text | YES | | Client IP |
| `created_at` | timestamptz | NO | `now()` | Login timestamp |

---

## 5. `contact_profile` (formerly `customers`)

**Description:** Support contact ops + portal credentials. Person SoR is `cdp.customer_profile` via `cdp_id`. See [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | bigint | NO | identity | Primary key |
| `organization_id` | bigint | NO | | FK → `accounts.organizations.id` |
| `cdp_id` | text | NO | | Link to CDP person (unique per org) |
| `account_id` | bigint | YES | | FK → `ticketing_accounts.id` (B2B parent) |
| `external_id` | text | YES | | Legacy external code |
| `status` | text | NO | `Active` | `Active` / `Inactive` |
| `total_tickets` | int4 | NO | `0` | Cached ticket count |
| `password_hash` | text | YES | | Customer portal password hash |
| `password_set_at` | timestamptz | YES | | When portal password was set |
| `last_portal_login_at` | timestamptz | YES | | Last customer portal login |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

Name / email / phone are **not** stored here — join CDP (`customer_profile` + `identity_keys`).

---

## 6. `customer_portal_sessions`

**Description:** Sessions for customers signed into the customer portal.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | bigint | NO | | FK → `accounts.organizations.id` |
| `customer_id` | bigint | NO | | FK → `contact_profile.id` |
| `device_label` | text | YES | | Device label |
| `ip_address` | text | YES | | Client IP |
| `user_agent` | text | YES | | User-Agent |
| `last_active_at` | timestamptz | NO | `now()` | Last activity |
| `created_at` | timestamptz | NO | `now()` | Session start |
| `revoked_at` | timestamptz | YES | | Revoked when set |

---

## 7. `customer_otp_challenges`

**Description:** One-time password challenges for customer portal auth.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | bigint | NO | | FK → `accounts.organizations.id` |
| `customer_id` | bigint | NO | | FK → `contact_profile.id` |
| `identifier` | text | NO | | Email/phone used for OTP |
| `channel` | text | NO | | Delivery channel (email/sms) |
| `code_hash` | text | NO | | Hashed OTP code |
| `attempts` | int4 | NO | `0` | Failed attempt count |
| `expires_at` | timestamptz | NO | | Expiry time |
| `consumed_at` | timestamptz | YES | | Set when OTP used successfully |
| `created_at` | timestamptz | NO | `now()` | Challenge created |

---

## 8. `customer_password_tokens`

**Description:** Tokens for customer portal password set / reset flows.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | bigint | NO | | FK → `accounts.organizations.id` |
| `customer_id` | bigint | NO | | FK → `contact_profile.id` |
| `token_hash` | text | NO | | Hashed token |
| `expires_at` | timestamptz | NO | | Expiry time |
| `consumed_at` | timestamptz | YES | | Used when set |
| `created_at` | timestamptz | NO | `now()` | Created time |

---

## 9. `ticketing_accounts` (formerly `ticketing.accounts`)

**Description:** B2B **client** accounts under a Ticketing organization (companies you support).  
**Not MyAccount** — MyAccount lives in schema `accounts`.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | bigint | NO | identity | Primary key |
| `organization_id` | bigint | NO | | FK → `accounts.organizations.id` |
| `name` | text | NO | | Account name |
| `status` | text | NO | `Active` | Account status |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 10–12. Products / account_products / contact_products — REMOVED

Local catalog and entitlement link tables were dropped (`sql/014`, `sql/017`).  
Tenant product master is **`inventory.products`**. Do not recreate spoke product tables.

---

## 13. `agent_queues`

**Description:** Support teams/queues that tickets are routed into.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `external_id` | text | YES | | External id (e.g. MyAccount team UUID) |
| `queue_name` | text | NO | | Team / queue display name |
| `description` | text | NO | `''` | Optional team description |
| `type` | text | NO | `Private` | `Private` / `Shared` |
| `open_tickets` | int4 | NO | `0` | Cached open ticket count |
| `assigned` | int4 | NO | `0` | Cached assigned count |
| `sla_status` | text | NO | `On Track` | `On Track` / `At Risk` |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 14. `agent_queue_members`

**Description:** Which staff users belong to which queues/teams.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `queue_id` | uuid | NO | | FK → `agent_queues.id` |
| `user_id` | uuid | NO | | FK → `users.id` |
| `created_at` | timestamptz | NO | `now()` | Membership created |

---

## 15. `tickets`

**Description:** Core support cases. Creation time = `created_at`; solved time = `resolved_at`; SLA deadline = `due_at` (from `sla_policies`).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `ticket_number` | varchar | NO | | Human-readable id (e.g. `#12503`) |
| `subject` | varchar | NO | | Subject line |
| `description` | text | NO | `''` | Issue detail / body |
| `status` | varchar | NO | `open` | Workflow status (see `ticket_statuses`) |
| `priority` | varchar | NO | `medium` | Priority key (see `sla_policies`) |
| `customer_id` | uuid | YES | | Optional link to `customers.id` |
| `customer_name` | text | NO | `''` | Denormalized requester name |
| `customer_email` | text | NO | `''` | Denormalized requester email |
| `customer_phone` | text | YES | | Denormalized phone |
| `channel` | text | NO | `Web` | `Email` / `Chat` / `Phone` / `Web` |
| `assignee_id` | uuid | YES | | L1 agent user id |
| `assignee_name` | text | NO | `Unassigned` | L1 agent display name |
| `resolver_id` | uuid | YES | | L2 resolver user id |
| `resolver_name` | text | YES | | L2 resolver display name |
| `queue_id` | uuid | YES | | Team/queue id |
| `queue_name` | text | YES | | Denormalized team name |
| `attachments` | text[] | NO | `{}` | Uploaded file URLs |
| `due_at` | timestamptz | YES | | SLA resolution deadline |
| `first_response_at` | timestamptz | YES | | First staff response time |
| `resolved_at` | timestamptz | YES | | Solved time (status → Resolved) |
| `csat_score` | int4 | YES | | Customer satisfaction 1–5 |
| `csat_rated_at` | timestamptz | YES | | When CSAT was submitted |
| `category` | text | YES | | Triage category |
| `skill` | text | YES | | Required skill from triage |
| `ai_summary` | text | YES | | AI-generated ticket summary |
| `created_by_id` | uuid | YES | | Creator user id |
| `created_by_name` | text | YES | | Creator display name |
| `created_at` | timestamptz | NO | `now()` | **Ticket creation time** |
| `updated_at` | timestamptz | NO | `now()` | Last modification time |

---

## 16. `ticket_notes`

**Description:** Conversation thread / notes on a ticket (internal or customer-visible).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `ticket_id` | uuid | NO | | FK → `tickets.id` |
| `author_id` | uuid | YES | | FK → `users.id` |
| `author_name` | text | NO | | Author display name |
| `body` | text | NO | | Note content |
| `visibility` | text | NO | `internal` | `internal` or public/customer-visible |
| `created_at` | timestamptz | NO | `now()` | Note time |

---

## 17. `ticket_presence`

**Description:** Live “who is viewing this ticket” heartbeats to reduce agent collisions.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `organization_id` | uuid | NO | | PK part; FK → `organizations.id` |
| `ticket_id` | uuid | NO | | PK part; FK → `tickets.id` |
| `user_id` | uuid | NO | | PK part; FK → `users.id` |
| `user_name` | text | NO | | Viewer display name |
| `last_seen_at` | timestamptz | NO | `now()` | Last heartbeat |

---

## 18. `ticket_statuses`

**Description:** Per-org configurable ticket statuses (system + custom).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `status` | text | NO | | Status key stored on `tickets.status` |
| `display_name` | text | NO | | UI label |
| `is_system` | bool | NO | `false` | Built-in vs custom |
| `is_terminal` | bool | NO | `false` | End state (e.g. Resolved) |
| `sort_order` | int4 | NO | `100` | UI sort order |
| `active` | bool | NO | `true` | Whether selectable |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 19. `activity_logs`

**Description:** Lightweight human-readable activity feed (dashboard recent activity).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `ticket_id` | uuid | YES | | Optional FK → `tickets.id` |
| `text` | text | NO | | Event text |
| `created_at` | timestamptz | NO | `now()` | Event time |

---

## 20. `audit_events`

**Description:** Append-only compliance trail for ticket actions.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `actor_id` | uuid | YES | | Who performed the action |
| `actor_name` | text | YES | | Actor display name |
| `action` | text | NO | | e.g. `ticket.created`, `ticket.assigned`, `ticket.escalated` |
| `ticket_id` | uuid | YES | | Related ticket UUID |
| `ticket_number` | text | YES | | Related ticket number |
| `meta` | jsonb | NO | `{}` | Extra details (from/to fields, etc.) |
| `created_at` | timestamptz | NO | `now()` | Event time |

---

## 21. `kb_articles`

**Description:** Knowledge base articles. Published ones power the public help center (`/hc/{slug}`).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `external_id` | text | YES | | External article code |
| `title` | text | NO | | Title |
| `content` | text | NO | | Body |
| `category` | text | NO | `General` | Category |
| `author_name` | text | NO | | Author display name |
| `author_id` | uuid | YES | | FK → `users.id` |
| `status` | text | NO | `Published` | `Published` / `Draft` |
| `views` | int4 | NO | `0` | View counter |
| `attachments` | text[] | NO | `{}` | Attached file URLs |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 22. `macros`

**Description:** Saved reply templates agents insert into notes.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `title` | text | NO | | Macro name |
| `body` | text | NO | | Template text |
| `created_by_id` | uuid | YES | | Creator user id |
| `created_by_name` | text | YES | | Creator name |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 23. `notifications`

**Description:** In-app notifications for staff users.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `user_id` | uuid | YES | | Recipient FK → `users.id` |
| `title` | text | NO | | Short title |
| `message` | text | NO | | Body |
| `ticket_id` | uuid | YES | | Related ticket |
| `customer_name` | text | YES | | Related customer label |
| `is_read` | bool | NO | `false` | Read flag |
| `kind` | text | YES | | e.g. `sla`, assignment kinds |
| `created_at` | timestamptz | NO | `now()` | Created time |

---

## 24. `dashboard_metrics`

**Description:** Cached KPI snapshot for the Home dashboard (one row per org).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` (unique) |
| `open_tickets` | int4 | NO | `0` | Open count |
| `on_hold` | int4 | NO | `0` | On-hold / pending-style count |
| `overdue` | int4 | NO | `0` | Overdue count |
| `due_today` | int4 | NO | `0` | Due today count |
| `unassigned` | int4 | NO | `0` | Unassigned count |
| `open_change` | text | NO | `—` | Change label |
| `on_hold_change` | text | NO | `—` | Change label |
| `overdue_change` | text | NO | `—` | Change label |
| `due_today_change` | text | NO | `—` | Change label |
| `unassigned_change` | text | NO | `—` | Change label |
| `captured_at` | timestamptz | NO | `now()` | When metrics were refreshed |

---

## 25. `sla_policy_defaults`

**Description:** Global default SLA hours by priority. Source of truth when seeding a new org’s `sla_policies`.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `priority` | text | NO | | PK — `urgent` / `high` / `medium` / `low` |
| `resolution_hours` | int4 | NO | | Hours until resolution due |
| `first_response_hours` | int4 | NO | | Hours until first-response target |
| `updated_at` | timestamptz | NO | `now()` | Last update |

Default seed: urgent 4/1 · high 8/2 · medium 24/4 · low 72/8.

---

## 26. `sla_policies`

**Description:** Per-organization SLA windows. Used at runtime to compute `tickets.due_at` from priority.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `priority` | text | NO | | Priority key (unique per org) |
| `resolution_hours` | int4 | NO | | Resolution SLA hours |
| `first_response_hours` | int4 | NO | | First-response SLA hours |
| `display_name` | text | YES | | UI label |
| `is_system` | bool | NO | `false` | Built-in system priority |
| `sort_order` | int4 | NO | `100` | UI sort |
| `active` | bool | NO | `true` | Whether usable |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 27. `automation_rules`

**Description:** Org if/then rules that run after `ticket.created` / `ticket.updated`.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `name` | text | NO | | Rule name |
| `event` | text | NO | | `ticket.created` / `ticket.updated` |
| `enabled` | bool | NO | `true` | Active flag |
| `priority` | int4 | NO | `100` | Run order (lower first) |
| `conditions` | jsonb | NO | `{}` | Match conditions |
| `actions` | jsonb | NO | `{}` | Actions (priority, queue, assign, notify, …) |
| `created_by_id` | uuid | YES | | Creator id |
| `created_by_name` | text | YES | | Creator name |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 28. `org_api_keys`

**Description:** Integration API keys. Plaintext shown once at create; only SHA-256 hash is stored.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `name` | text | NO | | Key label |
| `key_prefix` | text | NO | | Visible prefix for recognition |
| `key_hash` | text | NO | | SHA-256 of full key (unique) |
| `created_by_id` | uuid | YES | | Creator id |
| `created_by_name` | text | YES | | Creator name |
| `last_used_at` | timestamptz | YES | | Last successful use |
| `revoked_at` | timestamptz | YES | | Revoked when set |
| `created_at` | timestamptz | NO | `now()` | Created time |

---

## 29. `org_widgets`

**Description:** Embeddable Help widgets (`wgt_…`) that create tickets via public intake.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `name` | text | NO | | Widget name |
| `public_id` | text | NO | | Public embed id (`wgt_…`) |
| `allowed_origins` | text[] | NO | `{}` | CORS allowed origins |
| `enabled` | bool | NO | `true` | Active flag |
| `button_label` | text | NO | `Help` | Button text |
| `created_by_id` | uuid | YES | | Creator id |
| `created_by_name` | text | YES | | Creator name |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update time |

---

## 30. `email_message_refs`

**Description:** Maps inbound email `Message-ID` to a ticket so replies thread correctly.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `message_id` | text | NO | | Email Message-ID (unique per org) |
| `ticket_id` | uuid | NO | | FK → `tickets.id` |
| `ticket_number` | text | NO | | Ticket number |
| `created_at` | timestamptz | NO | `now()` | Created time |

---

## 31. `outbound_email_log`

**Description:** Log of emails sent to customers (ticket created / reply / resolved).

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `ticket_id` | uuid | YES | | Related ticket UUID |
| `ticket_number` | text | YES | | Related ticket number |
| `kind` | text | NO | | `ticket_created` / `ticket_reply` / `ticket_resolved` |
| `to_email` | text | NO | | Recipient |
| `subject` | text | NO | | Email subject |
| `body_preview` | text | YES | | Short body preview |
| `status` | text | NO | `queued` | Delivery status |
| `error` | text | YES | | Error if failed |
| `created_at` | timestamptz | NO | `now()` | Log time |

---

## 32. `ticket_event_outbox`

**Description:** Outbox for delivering ticket events to webhooks / integrations.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `event_type` | text | NO | | Event type name |
| `payload` | jsonb | NO | `{}` | Event payload |
| `webhook_url` | text | YES | | Delivery URL |
| `status` | text | NO | `pending` | `pending` / delivered / failed |
| `attempts` | int4 | NO | `0` | Delivery attempt count |
| `last_error` | text | YES | | Last delivery error |
| `created_at` | timestamptz | NO | `now()` | Enqueued time |
| `delivered_at` | timestamptz | YES | | Successful delivery time |

---

## 33. `conversation_contexts`

**Description:** Persisted co-worker / chat conversation context per user session.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | int8 | NO | sequence | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `user_id` | uuid | YES | | FK → `users.id` |
| `user_key` | text | NO | | Stable user key |
| `session_key` | text | NO | | Chat session key |
| `context` | jsonb | NO | `{}` | Conversation context blob |
| `version` | int8 | NO | `1` | Optimistic version |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update |
| `expires_at` | timestamptz | YES | | Optional expiry |

---

## 34. `workflow_events`

**Description:** Workflow / agent event history tied to conversation contexts.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | int8 | NO | sequence | Primary key |
| `organization_id` | uuid | NO | | FK → `organizations.id` |
| `user_id` | uuid | YES | | FK → `users.id` |
| `user_key` | text | NO | | Stable user key |
| `session_key` | text | NO | | Session key |
| `request_id` | text | NO | | Request correlation id |
| `conversation_context_id` | int8 | YES | | FK → `conversation_contexts.id` |
| `workflow_id` | text | YES | | Workflow instance id |
| `workflow_type` | text | NO | | Workflow type |
| `event_type` | text | NO | | Event type |
| `event_data` | jsonb | NO | `{}` | Event payload |
| `version` | int8 | NO | | Event version |
| `created_at` | timestamptz | NO | `now()` | Event time |
| `expires_at` | timestamptz | YES | | Optional expiry |

---

## 35. `proactive_outbox`

**Description:** Outbox of events for the proactive agent subsystem.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | Organization scope |
| `event_type` | text | NO | | Event type |
| `ticket_id` | text | YES | | Related ticket id |
| `ticket_number` | text | YES | | Related ticket number |
| `actor` | text | YES | | Actor label |
| `payload` | jsonb | NO | `{}` | Event payload |
| `created_at` | timestamptz | NO | `now()` | Enqueued time |
| `processed_at` | timestamptz | YES | | Processed time |

---

## 36. `proactive_recommendations`

**Description:** Proactive suggestions shown to agents for a ticket.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | Organization scope |
| `agent_id` | text | NO | | Target agent id |
| `ticket_id` | text | YES | | Related ticket |
| `ticket_number` | text | YES | | Related ticket number |
| `summary` | text | NO | `''` | Short recommendation summary |
| `payload` | jsonb | NO | `{}` | Full recommendation data |
| `status` | text | NO | `open` | e.g. `open` / accepted / dismissed |
| `created_at` | timestamptz | NO | `now()` | Created time |

---

## 37. `proactive_approvals`

**Description:** Pending approvals for proactive tool/actions before execution.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | Organization scope |
| `agent_id` | text | NO | | Requesting / target agent |
| `ticket_id` | text | YES | | Related ticket |
| `ticket_number` | text | YES | | Related ticket number |
| `summary` | text | NO | `''` | Approval summary |
| `tool_name` | text | YES | | Tool to run if approved |
| `tool_args` | jsonb | NO | `{}` | Tool arguments |
| `payload` | jsonb | NO | `{}` | Extra payload |
| `status` | text | NO | `pending` | `pending` / approved / rejected |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `decided_at` | timestamptz | YES | | When decision was made |

---

## 38. `proactive_audit`

**Description:** Audit log of proactive agent decisions and tool use.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | YES | | Organization scope |
| `agent_id` | text | YES | | Agent id |
| `ticket_id` | text | YES | | Related ticket |
| `event_id` | text | YES | | Related event id |
| `decision` | text | YES | | Decision taken |
| `reason` | text | YES | | Reason text |
| `tool_name` | text | YES | | Tool involved |
| `payload` | jsonb | NO | `{}` | Extra details |
| `created_at` | timestamptz | NO | `now()` | Event time |

---

## 39. `proactive_embeddings`

**Description:** Stored embedding/token payloads for proactive similarity / retrieval.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | uuid | NO | `gen_random_uuid()` | Primary key |
| `organization_id` | uuid | NO | | Organization scope |
| `source` | text | NO | | Source type (e.g. kb, ticket) |
| `source_id` | text | NO | | Source record id |
| `tokens` | jsonb | NO | `{}` | Embedding / token payload |
| `updated_at` | timestamptz | NO | `now()` | Last update |

---

## 40. `proactive_routing_weights`

**Description:** Per-organization weights used by proactive routing.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `organization_id` | uuid | NO | | PK; organization scope |
| `weights` | jsonb | NO | `{}` | Routing weight map |
| `updated_at` | timestamptz | NO | `now()` | Last update |

---

## Relationship sketch

```text
MyAccount (accounts.*)                    Ticketing (ticketing.*)
─────────────────────                     ───────────────────────
organizations ── FK only ───────────────► org_settings
setup_users ──── FK only ───────────────► agents (local PK for assignee)
setup_roles / setup_user_product_access    (eligibility for login/assign)
setup_users.skills ── assign ───────────► tickets.assignee_* / skill

CDP (cdp.*) ── cdp_id ──────────────────► contact_profile
inventory.products ── read entitlements (no spoke product tables)

ticketing.org_settings / agents / contact_profile
  ├── user_sessions / user_login_events / notifications  (user_id → agents.id)
  ├── contact_profile ── portal sessions / otp / password_tokens
  │     └── account_id → ticketing_accounts   ← B2B clients (NOT MyAccount)
  ├── agent_queues ── agent_queue_members ── agents.id
  ├── tickets (assignee_id → agents.id, customer_id → contact_profile.id)
  │     ├── ticket_notes / ticket_presence
  │     ├── activity_logs / audit_events
  │     ├── email_message_refs / outbound_email_log
  │     └── ticket_event_outbox
  ├── ticket_statuses / sla_policies
  ├── kb_articles / macros / dashboard_metrics
  ├── automation_rules / org_api_keys / org_widgets
  ├── conversation_contexts ── workflow_events
  └── proactive_* …
```

---

## A. MyAccount schema (`accounts`) — tables we use

### A1. `accounts.organizations`

**Description:** MyAccount company/tenant record. Ticketing uses this id as `organization_id` everywhere and reads `company_name` for display.  
**Note:** Org id is **bigint**. There is **no** `ticketing.organizations` table after hub cutover.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | int8 | NO | | Primary key (bigint) |
| `tenant_id` | varchar | NO | | Tenant identifier |
| `company_name` | varchar | YES | | Company display name (synced into ticketing org name) |
| `industry_type` | varchar | YES | | Industry |
| `contact_name` | varchar | YES | | Primary contact |
| `designation` | varchar | YES | | Contact designation |
| `work_email` | varchar | YES | | Work email |
| `admin_email` | varchar | YES | | Admin email |
| `tax_number` | varchar | YES | | Tax id |
| `billing_address` | text | YES | | Billing address |
| `website_url` | varchar | YES | | Website |
| `country` | varchar | YES | | Country |
| `company_size` | varchar | YES | | Company size |
| `mobile_country_code` | varchar | YES | | Phone country code |
| `mobile_number` | varchar | YES | | Mobile |
| `lifecycle_status` | varchar | NO | `active` | Lifecycle status |
| `business_type` | varchar | YES | | Business type |
| `support_portal_slug` | varchar | YES | | Support portal slug |
| `support_portal_enabled` | bool | NO | `false` | Portal enabled flag |
| `support_portal_welcome` | text | YES | | Portal welcome text |
| `reseller_id` | int8 | YES | | Reseller link |
| `source_lead_id` | int8 | YES | | Source lead |
| `converted_at` | timestamptz | NO | `now()` | Converted time |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update |

---

### A2. `accounts.setup_users`

**Description:** Authoritative staff identity for MyAccount. Ticketing uses this for login eligibility, password verify/update, name/email/phone, and **skills** for auto-assignment. Passwords live here — not copied into `ticketing.users.password_hash` in current design.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | int8 | NO | | Primary key (bigint; linked to ticketing by email/org, not id cast) |
| `organization_id` | int8 | NO | | FK → `accounts.organizations.id` |
| `employee_id` | varchar | YES | | Employee code |
| `first_name` | varchar | NO | | First name |
| `last_name` | varchar | NO | | Last name |
| `work_email` | varchar | NO | | Login email (unique identity for sync) |
| `mobile_number` | varchar | YES | | Mobile / phone |
| `primary_language` | varchar | YES | | Primary language |
| `secondary_language` | varchar | YES | | Secondary language |
| `location_id` | varchar | YES | | Location ref |
| `status` | varchar | NO | `active` | Must be `active` to log into Ticketing |
| `password_hash` | text | YES | | bcrypt hash — required for login |
| `invite_status` | varchar | YES | | Invite state |
| `password_set_at` | timestamptz | YES | | When password was set |
| `invited_at` | timestamptz | YES | | Invite sent time |
| `skills` | jsonb | NO | `[]` | Skill list used by triage/assign |
| `shift_types` | jsonb | YES | | Shift metadata |
| `city` | varchar | YES | | City |
| `state` | varchar | YES | | State |
| `country` | varchar | YES | | Country |
| `business_hours_id` | int8 | YES | | Business hours ref |
| `team_id` | int8 | YES | | Primary team ref |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update |

---

### A3. `accounts.setup_roles`

**Description:** Role definitions. Ticketing maps `lower(name)` → `admin` / `agent` / `resolver` / `customer` for RBAC.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | int8 | NO | | Primary key |
| `organization_id` | int8 | NO | | Org scope |
| `name` | varchar | NO | | Role name (Admin, Agent, Resolver, Customer, …) |
| `description` | text | YES | | Role description |
| `product_id` | varchar | YES | | Product this role belongs to |
| `accessible_products` | jsonb | NO | `[]` | Products this role can access |
| `module_permission` | varchar | YES | | Legacy module permission |
| `module_permissions` | jsonb | YES | | Module permission map |
| `can_view` | bool | NO | `true` | View permission |
| `can_create` | bool | NO | `false` | Create permission |
| `can_edit` | bool | NO | `false` | Edit permission |
| `can_delete` | bool | NO | `false` | Delete permission |
| `can_export` | bool | NO | `false` | Export permission |
| `can_approve` | bool | NO | `false` | Approve permission |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update |

---

### A4. `accounts.setup_user_product_access`

**Description:** Grants a user a role on a product. Ticketing eligibility requires `product_id = 'ticketing'`.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | int8 | NO | | Primary key |
| `organization_id` | int8 | NO | | Org scope |
| `user_id` | int8 | NO | | FK → `setup_users.id` |
| `role_id` | int8 | NO | | FK → `setup_roles.id` |
| `product_id` | varchar | NO | | Product key — Ticketing filters `ticketing` |
| `created_at` | timestamptz | NO | `now()` | Grant created |

**Eligibility join (simplified):**

```text
setup_user_product_access (product_id = 'ticketing')
  JOIN setup_users (status = active, password_hash set, work_email set)
  JOIN setup_roles
  LEFT JOIN organizations
```

---

### A5. `accounts.setup_teams`

**Description:** MyAccount teams. Ticketing mirrors active teams into `ticketing.agent_queues` (same id when uuid-compatible) and members into `agent_queue_members`.

| Column | Type | Null | Default | Description |
|--------|------|------|---------|-------------|
| `id` | int8 | NO | | Primary key (mirrored as queue id when possible) |
| `organization_id` | int8 | NO | | Org scope |
| `name` | varchar | NO | | Team name → `agent_queues.queue_name` |
| `description` | text | YES | | Team description |
| `available_products` | jsonb | NO | `[]` | Products this team supports |
| `status` | varchar | NO | `active` | Only `active` teams are synced |
| `member_ids` | jsonb | YES | | Member user ids (agents/resolvers) |
| `business_hours_id` | int8 | YES | | Business hours ref |
| `created_at` | timestamptz | NO | `now()` | Created time |
| `updated_at` | timestamptz | NO | `now()` | Last update |

---

## Useful queries

```sql
-- All tables in ticketing
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'ticketing' AND table_type = 'BASE TABLE'
ORDER BY 1;

-- MyAccount tables Ticketing uses
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'accounts'
  AND table_name IN (
    'organizations', 'setup_users', 'setup_roles',
    'setup_user_product_access', 'setup_teams'
  )
ORDER BY 1;

-- Columns for one table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'ticketing' AND table_name = 'tickets'
ORDER BY ordinal_position;

-- Eligible Ticketing staff from MyAccount
SELECT u.work_email, r.name AS role, o.company_name
FROM accounts.setup_user_product_access a
JOIN accounts.setup_users u ON u.id = a.user_id
JOIN accounts.setup_roles r ON r.id = a.role_id
LEFT JOIN accounts.organizations o ON o.id = a.organization_id
WHERE a.product_id = 'ticketing'
  AND lower(COALESCE(u.status, '')) = 'active'
  AND u.password_hash IS NOT NULL;

-- Ticket timing
SELECT ticket_number, status, priority, created_at, due_at, resolved_at
FROM ticketing.tickets
ORDER BY created_at DESC
LIMIT 20;
```
