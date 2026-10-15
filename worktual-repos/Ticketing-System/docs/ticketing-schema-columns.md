# Ticketing schema — tables & columns

**Schema:** `ticketing`  
**Source:** live DB introspection + app bootstrap (multi-tenant; most rows scoped by `organization_id`)

---

## Table index

| Table | Purpose |
|-------|---------|
| [organizations](#1-organizations) | Tenant / company workspace |
| [users](#2-users) | Staff & customer portal accounts |
| [user_sessions](#3-user_sessions) | Signed-in devices |
| [user_login_events](#4-user_login_events) | Login history |
| [customers](#5-customers) | End-customer directory |
| [agent_queues](#6-agent_queues) | Teams / queues |
| [agent_queue_members](#7-agent_queue_members) | Users ↔ queues |
| [tickets](#8-tickets) | Support cases |
| [ticket_notes](#9-ticket_notes) | Conversation thread |
| [ticket_presence](#10-ticket_presence) | Who is viewing a ticket |
| [ticket_statuses](#11-ticket_statuses) | Org-configurable statuses |
| [activity_logs](#12-activity_logs) | Human-readable activity feed |
| [audit_events](#13-audit_events) | Compliance audit trail |
| [kb_articles](#14-kb_articles) | Knowledge base |
| [macros](#15-macros) | Reply templates |
| [notifications](#16-notifications) | In-app alerts |
| [dashboard_metrics](#17-dashboard_metrics) | Cached home KPIs |
| [sla_policy_defaults](#18-sla_policy_defaults) | Global SLA hour defaults |
| [sla_policies](#19-sla_policies) | Per-org SLA by priority |
| [automation_rules](#20-automation_rules) | If/then ticket rules |
| [org_api_keys](#21-org_api_keys) | Integration API keys |
| [org_widgets](#22-org_widgets) | Embeddable Help widgets |
| [email_message_refs](#23-email_message_refs) | Email Message-ID → ticket |
| [outbound_email_log](#24-outbound_email_log) | Outbound customer email log |

---

## 1. `organizations`

Tenant root. Every business table references this.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `name` | text | NO | Company / workspace display name |
| `slug` | text | NO | URL-safe unique slug (help center `/hc/{slug}`) |
| `status` | text | NO | `Active` / `Inactive` |
| `ticket_prefix` | text | NO | Prefix for ticket numbers (default `#`) |
| `portal_label` | text | YES | Optional portal branding label |
| `display_timezone` | text | NO | Org display timezone (default `UTC`) |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 2. `users`

Agents, admins, resolvers, customers, viewers (login accounts).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key (same UUID as MyAccount when synced) |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `name` | text | NO | Display name |
| `email` | text | NO | Login email (unique per org) |
| `initials` | text | YES | Avatar initials |
| `role` | text | NO | `admin` \| `agent` \| `resolver` \| `customer` \| `viewer` |
| `status` | text | NO | `Active` / `Inactive` |
| `password_hash` | text | YES | bcrypt hash |
| `phone` | text | YES | Profile phone |
| `last_login_at` | timestamptz | YES | Last successful login |
| `password_changed_at` | timestamptz | YES | Last password change |
| `two_factor_enabled` | bool | NO | 2FA flag (UI preference) |
| `language` | text | NO | UI language preference |
| `timezone` | text | NO | User timezone |
| `date_format` | text | NO | Date format preference |
| `notify_ticket_assignments` | bool | NO | Email/in-app: assignments |
| `notify_ticket_updates` | bool | NO | Ticket updates |
| `notify_security_alerts` | bool | NO | Security alerts |
| `notify_sla_alerts` | bool | NO | SLA breach alerts |
| `notify_product_updates` | bool | NO | Product updates |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 3. `user_sessions`

Active / revoked login sessions (“signed-in devices”).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key (stored in JWT as `sessionId`) |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `user_id` | uuid | NO | FK → `users.id` |
| `device_label` | text | NO | Human label for device |
| `browser` | text | YES | Browser name |
| `os` | text | YES | Operating system |
| `location` | text | NO | Approx location label |
| `user_agent` | text | YES | Raw User-Agent |
| `ip_address` | text | YES | Client IP |
| `is_current` | bool | NO | Current session flag |
| `last_active_at` | timestamptz | NO | Last activity |
| `created_at` | timestamptz | NO | Session start |
| `revoked_at` | timestamptz | YES | Set when logged out / revoked |

---

## 4. `user_login_events`

Append-only login history for Account Settings.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `user_id` | uuid | NO | FK → `users.id` |
| `device_label` | text | NO | Device label at login |
| `location` | text | NO | Location label |
| `ip_address` | text | YES | Client IP |
| `created_at` | timestamptz | NO | Login timestamp |

---

## 5. `customers`

End customers who open or are linked to tickets.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `external_id` | text | YES | External/customer code (unique per org) |
| `name` | text | NO | Customer name |
| `email` | text | NO | Email (unique per org) |
| `phone` | text | YES | Phone |
| `status` | text | NO | `Active` / `Inactive` |
| `total_tickets` | int4 | NO | Cached ticket count |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 6. `agent_queues`

Support teams / queues tickets are routed into.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `external_id` | text | YES | External id (e.g. MyAccount team UUID) |
| `queue_name` | text | NO | Team / queue display name |
| `type` | text | NO | `Private` / `Shared` |
| `open_tickets` | int4 | NO | Cached open count |
| `assigned` | int4 | NO | Cached assigned count |
| `sla_status` | text | NO | `On Track` / `At Risk` |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 7. `agent_queue_members`

Many-to-many: which users belong to which queues.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `queue_id` | uuid | NO | FK → `agent_queues.id` |
| `user_id` | uuid | NO | FK → `users.id` |
| `created_at` | timestamptz | NO | Membership created |

---

## 8. `tickets`

Main support cases.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `ticket_number` | varchar | NO | Human id (e.g. `#12503`) |
| `subject` | varchar | NO | Subject line |
| `description` | text | NO | Body / issue detail |
| `status` | varchar | NO | Workflow status (see `ticket_statuses`) |
| `priority` | varchar | NO | Priority key (see `sla_policies`) |
| `customer_id` | uuid | YES | FK → `customers.id` (optional) |
| `customer_name` | text | NO | Denormalized requester name |
| `customer_email` | text | NO | Denormalized requester email |
| `customer_phone` | text | YES | Denormalized phone |
| `channel` | text | NO | `Email` / `Chat` / `Phone` / `Web` |
| `assignee_id` | uuid | YES | L1 agent user id |
| `assignee_name` | text | NO | L1 agent display name |
| `resolver_id` | uuid | YES | L2 resolver user id |
| `resolver_name` | text | YES | L2 resolver display name |
| `queue_id` | uuid | YES | FK → `agent_queues.id` |
| `queue_name` | text | YES | Denormalized team name |
| `attachments` | text[] | NO | Uploaded file URLs |
| `due_at` | timestamptz | YES | SLA resolution deadline |
| `first_response_at` | timestamptz | YES | First staff response time |
| `resolved_at` | timestamptz | YES | Solved time (status → Resolved) |
| `csat_score` | int4 | YES | Customer rating 1–5 |
| `csat_rated_at` | timestamptz | YES | When CSAT was submitted |
| `category` | text | YES | Triage category |
| `skill` | text | YES | Required skill from triage |
| `created_by_id` | uuid | YES | Creator user id |
| `created_by_name` | text | YES | Creator display name |
| `created_at` | timestamptz | NO | **Ticket creation time** |
| `updated_at` | timestamptz | NO | Last modification time |

---

## 9. `ticket_notes`

Conversation / notes on a ticket.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `ticket_id` | uuid | NO | FK → `tickets.id` |
| `author_id` | uuid | YES | FK → `users.id` |
| `author_name` | text | NO | Author display name |
| `body` | text | NO | Note content |
| `visibility` | text | NO | `internal` (staff) or public/customer-visible |
| `created_at` | timestamptz | NO | Note time |

---

## 10. `ticket_presence`

Live “who is viewing this ticket” (heartbeat + TTL).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `organization_id` | uuid | NO | PK part; FK → `organizations.id` |
| `ticket_id` | uuid | NO | PK part; FK → `tickets.id` |
| `user_id` | uuid | NO | PK part; FK → `users.id` |
| `user_name` | text | NO | Viewer display name |
| `last_seen_at` | timestamptz | NO | Last heartbeat |

---

## 11. `ticket_statuses`

Per-org configurable ticket statuses (system + custom).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `status` | text | NO | Status key stored on `tickets.status` |
| `display_name` | text | NO | UI label |
| `is_system` | bool | NO | Built-in vs custom |
| `is_terminal` | bool | NO | End state (e.g. Resolved) |
| `sort_order` | int4 | NO | UI sort order |
| `active` | bool | NO | Whether selectable |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 12. `activity_logs`

Lightweight feed for dashboard “recent activity”.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `ticket_id` | uuid | YES | Optional FK → `tickets.id` |
| `text` | text | NO | Human-readable event text |
| `created_at` | timestamptz | NO | Event time |

---

## 13. `audit_events`

Append-only compliance trail.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `actor_id` | uuid | YES | Who performed the action |
| `actor_name` | text | YES | Actor display name |
| `action` | text | NO | e.g. `ticket.created`, `ticket.assigned`, `ticket.escalated` |
| `ticket_id` | uuid | YES | Related ticket UUID |
| `ticket_number` | text | YES | Related ticket number |
| `meta` | jsonb | NO | Extra details (from/to, fields, etc.) |
| `created_at` | timestamptz | NO | Event time |

---

## 14. `kb_articles`

Knowledge base articles (also feed public help center when Published).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `external_id` | text | YES | External article code |
| `title` | text | NO | Title |
| `content` | text | NO | Body |
| `category` | text | NO | e.g. Billing, Troubleshooting, Accounts, General |
| `author_name` | text | NO | Author display name |
| `author_id` | uuid | YES | FK → `users.id` |
| `status` | text | NO | `Published` / `Draft` |
| `views` | int4 | NO | View counter |
| `attachments` | text[] | NO | Attached file URLs |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 15. `macros`

Saved reply templates for agents.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `title` | text | NO | Macro name |
| `body` | text | NO | Template text |
| `created_by_id` | uuid | YES | Creator user id |
| `created_by_name` | text | YES | Creator name |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 16. `notifications`

In-app notifications per user.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `user_id` | uuid | YES | Recipient FK → `users.id` |
| `title` | text | NO | Short title |
| `message` | text | NO | Body |
| `ticket_id` | uuid | YES | Related ticket |
| `customer_name` | text | YES | Related customer label |
| `is_read` | bool | NO | Read flag |
| `kind` | text | YES | e.g. `sla`, assignment kinds |
| `created_at` | timestamptz | NO | Created time |

---

## 17. `dashboard_metrics`

Cached KPI snapshot (one row per org).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` (unique) |
| `open_tickets` | int4 | NO | Open count |
| `on_hold` | int4 | NO | On-hold / pending style count |
| `overdue` | int4 | NO | Overdue count |
| `due_today` | int4 | NO | Due today count |
| `unassigned` | int4 | NO | Unassigned count |
| `open_change` | text | NO | Change label (e.g. `+12%`) |
| `on_hold_change` | text | NO | Change label |
| `overdue_change` | text | NO | Change label |
| `due_today_change` | text | NO | Change label |
| `unassigned_change` | text | NO | Change label |
| `captured_at` | timestamptz | NO | When metrics were refreshed |

---

## 18. `sla_policy_defaults`

Global default SLA hours by priority (seed source for new orgs).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `priority` | text | NO | PK — `urgent` / `high` / `medium` / `low` |
| `resolution_hours` | int4 | NO | Hours until resolution due |
| `first_response_hours` | int4 | NO | Hours until first-response target |
| `updated_at` | timestamptz | NO | Last update |

Default seed: urgent 4/1, high 8/2, medium 24/4, low 72/8.

---

## 19. `sla_policies`

Per-organization SLA windows (used to set `tickets.due_at`).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `priority` | text | NO | Priority key (unique per org) |
| `resolution_hours` | int4 | NO | Resolution SLA hours |
| `first_response_hours` | int4 | NO | First-response SLA hours |
| `display_name` | text | YES | UI label |
| `is_system` | bool | NO | Built-in system priority |
| `sort_order` | int4 | NO | UI sort |
| `active` | bool | NO | Whether usable |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 20. `automation_rules`

Org if/then rules after ticket create/update.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `name` | text | NO | Rule name |
| `event` | text | NO | `ticket.created` / `ticket.updated` |
| `enabled` | bool | NO | Active flag |
| `priority` | int4 | NO | Run order (lower first) |
| `conditions` | jsonb | NO | Match conditions (channel, subject, priority, unassigned, …) |
| `actions` | jsonb | NO | Actions (setPriority, setQueue, assign, notify, …) |
| `created_by_id` | uuid | YES | Creator id |
| `created_by_name` | text | YES | Creator name |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 21. `org_api_keys`

Integration API keys (`wt_live_…`). Plaintext shown once; only hash stored.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `name` | text | NO | Key label |
| `key_prefix` | text | NO | Visible prefix for recognition |
| `key_hash` | text | NO | SHA-256 of full key (unique) |
| `created_by_id` | uuid | YES | Creator id |
| `created_by_name` | text | YES | Creator name |
| `last_used_at` | timestamptz | YES | Last successful use |
| `revoked_at` | timestamptz | YES | Revoked when set |
| `created_at` | timestamptz | NO | Created time |

---

## 22. `org_widgets`

Embeddable Help widgets (public `wgt_…` id).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `name` | text | NO | Widget name |
| `public_id` | text | NO | Public embed id (`wgt_…`) |
| `allowed_origins` | text[] | NO | CORS allowed origins |
| `enabled` | bool | NO | Active flag |
| `button_label` | text | NO | Button text (default `Help`) |
| `created_by_id` | uuid | YES | Creator id |
| `created_by_name` | text | YES | Creator name |
| `created_at` | timestamptz | NO | Created time |
| `updated_at` | timestamptz | NO | Last update time |

---

## 23. `email_message_refs`

Maps inbound email `Message-ID` → ticket for reply threading.

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `message_id` | text | NO | Email Message-ID (unique per org) |
| `ticket_id` | uuid | NO | FK → `tickets.id` |
| `ticket_number` | text | NO | Ticket number |
| `created_at` | timestamptz | NO | Created time |

---

## 24. `outbound_email_log`

Log of emails sent to customers (create / reply / resolve).

| Column | Type | Null | Description |
|--------|------|------|-------------|
| `id` | uuid | NO | Primary key |
| `organization_id` | uuid | NO | FK → `organizations.id` |
| `ticket_id` | uuid | YES | Related ticket UUID |
| `ticket_number` | text | YES | Related ticket number |
| `kind` | text | NO | `ticket_created` / `ticket_reply` / `ticket_resolved` |
| `to_email` | text | NO | Recipient |
| `subject` | text | NO | Email subject |
| `body_preview` | text | YES | Short body preview |
| `status` | text | NO | e.g. `queued`, sent, failed |
| `error` | text | YES | Error message if failed |
| `created_at` | timestamptz | NO | Log time |

---

## Relationship sketch

```text
ticketing.organizations
  ├── users ── user_sessions, user_login_events, notifications
  ├── customers
  ├── agent_queues ── agent_queue_members ── users
  ├── tickets
  │     ├── ticket_notes
  │     ├── ticket_presence
  │     ├── activity_logs
  │     ├── audit_events
  │     ├── email_message_refs
  │     └── outbound_email_log
  ├── ticket_statuses
  ├── sla_policies  ← seeded from sla_policy_defaults
  ├── kb_articles, macros, dashboard_metrics
  ├── automation_rules
  ├── org_api_keys, org_widgets
```

---

## Useful queries

```sql
-- List all ticketing tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'ticketing' AND table_type = 'BASE TABLE'
ORDER BY 1;

-- Columns for one table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'ticketing' AND table_name = 'tickets'
ORDER BY ordinal_position;

-- Ticket timing sample
SELECT ticket_number, status, priority, created_at, due_at, resolved_at
FROM ticketing.tickets
ORDER BY created_at DESC
LIMIT 20;
```
