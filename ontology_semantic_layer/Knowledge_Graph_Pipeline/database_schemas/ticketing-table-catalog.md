# Ticketing table catalog (purpose, columns, categoricals, samples)

Schema: **`ticketing`** (Postgres). Multi-tenant: almost every row is scoped by **`organization_id`** = `accounts.organizations.id`.

**Hub/spoke:** org/staff SoR = MyAccount (`accounts.*`); person SoR = CDP via `contact_profile.cdp_id`; products = `inventory.products`.  
See [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md).

**Dropped (do not use):** `organizations`, `users`, `customers`, `accounts`, `products`, `contact_products`, `account_products`, `customer_products`.

Samples below are from live org **1000** (ZIFO) where data exists. Sensitive hashes are redacted. Empty tables use an **illustrative** example.

---

## Table index

| # | Table | Purpose |
|---|-------|---------|
| 1 | [`org_settings`](#1-org_settings) | Spoke org preferences |
| 2 | [`agents`](#2-agents) | Staff bridge → MyAccount `setup_users` |
| 3 | [`user_sessions`](#3-user_sessions) | Staff console sessions |
| 4 | [`user_login_events`](#4-user_login_events) | Staff login history |
| 5 | [`contact_profile`](#5-contact_profile) | Support contact ops + portal auth |
| 6 | [`customer_portal_sessions`](#6-customer_portal_sessions) | Customer portal sessions |
| 7 | [`customer_otp_challenges`](#7-customer_otp_challenges) | Portal OTP challenges |
| 8 | [`customer_password_tokens`](#8-customer_password_tokens) | Portal password set/reset tokens |
| 9 | [`ticketing_accounts`](#9-ticketing_accounts) | B2B client accounts (not MyAccount) |
| 10 | [`agent_queues`](#10-agent_queues) | Support teams / queues |
| 11 | [`agent_queue_members`](#11-agent_queue_members) | Queue membership |
| 12 | [`tickets`](#12-tickets) | Support cases |
| 13 | [`ticket_notes`](#13-ticket_notes) | Ticket conversation thread |
| 14 | [`ticket_presence`](#14-ticket_presence) | Who is viewing a ticket |
| 15 | [`ticket_statuses`](#15-ticket_statuses) | Org status catalog |
| 16 | [`sla_policy_defaults`](#16-sla_policy_defaults) | Global default SLA hours |
| 17 | [`sla_policies`](#17-sla_policies) | Per-org SLA by priority |
| 18 | [`activity_logs`](#18-activity_logs) | Home activity feed lines |
| 19 | [`audit_events`](#19-audit_events) | Compliance audit trail |
| 20 | [`kb_articles`](#20-kb_articles) | Knowledge base |
| 21 | [`macros`](#21-macros) | Saved reply templates |
| 22 | [`notifications`](#22-notifications) | In-app staff notifications |
| 23 | [`dashboard_metrics`](#23-dashboard_metrics) | Cached home KPIs |
| 24 | [`automation_rules`](#24-automation_rules) | If/then ticket rules |
| 25 | [`org_api_keys`](#25-org_api_keys) | Integration API keys |
| 26 | [`org_widgets`](#26-org_widgets) | Embeddable help widgets |
| 27 | [`email_message_refs`](#27-email_message_refs) | Inbound email → ticket map |
| 28 | [`outbound_email_log`](#28-outbound_email_log) | Outbound mail log |
| 29 | [`ticket_event_outbox`](#29-ticket_event_outbox) | Webhook/event outbox |
| 30 | [`conversation_contexts`](#30-conversation_contexts) | Co-worker chat state |
| 31 | [`workflow_events`](#31-workflow_events) | Chat workflow event history |
| 32 | [`proactive_outbox`](#32-proactive_outbox) | Proactive agent event feed |
| 33 | [`proactive_recommendations`](#33-proactive_recommendations) | Proactive suggestions |
| 34 | [`proactive_approvals`](#34-proactive_approvals) | Human approvals for tools |
| 35 | [`proactive_audit`](#35-proactive_audit) | Proactive decision audit |
| 36 | [`proactive_embeddings`](#36-proactive-embeddings) | Proactive search embeddings |
| 37 | [`proactive_routing_weights`](#37-proactive_routing_weights) | Learned routing weights |

---

## Shared categoricals (quick reference)

| Domain | Allowed values |
|--------|----------------|
| Active/Inactive status | `Active`, `Inactive` |
| Agent role | `admin`, `agent`, `resolver`, `customer`, `viewer` |
| Portal auth mode | `otp`, `password` |
| Ticket status (system) | `Open`, `Pending`, `Reopened`, `Resolved`, `Overdue` (+ custom via `ticket_statuses`) |
| Ticket priority | `urgent`, `high`, `medium`, `low` |
| Ticket channel | `Email`, `Chat`, `Phone`, `Web` |
| Note visibility | `internal`, `public` |
| Queue type | `Private`, `Shared` |
| Queue SLA status | `On Track`, `At Risk` |
| KB status | `Published`, `Draft` |
| Notification kind | `assignment`, `update`, `sla`, `security`, `product` |
| OTP channel | `email`, `phone` |
| Automation event | `ticket.created`, `ticket.updated` |
| CSAT | integer `1`–`5` |
| MyAccount business type (hub) | `b2b`, `b2c` |

---

## 1. `org_settings`

**What this table is for:** Spoke-only org preferences. Company display name comes from MyAccount `accounts.organizations.company_name`, not here.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `organization_id` | bigint | NO | — | PK; FK → `accounts.organizations.id` |
| `ticket_prefix` | text | NO | — | Prefix for ticket numbers (e.g. `#`) |
| `portal_label` | text | YES | — | Optional support-portal branding label |
| `display_timezone` | text | NO | — | Timezone for “due today” / display dates |
| `portal_auth_mode` | text | NO | `otp`, `password` | How customers log into the portal |
| `portal_slug` | text | YES | — | URL slug for `/support/{slug}` and `/hc/{slug}` |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (live):**

```json
{
  "organization_id": 1000,
  "ticket_prefix": "#",
  "portal_label": null,
  "display_timezone": "UTC",
  "portal_auth_mode": "otp",
  "portal_slug": "zifo-mt1g9pve",
  "created_at": "2026-08-20T11:41:31.539429+00:00",
  "updated_at": "2026-08-20T11:41:31.539429+00:00"
}
```

---

## 2. `agents`

**What this table is for:** Thin staff bridge. Local `id` is used by tickets/sessions/notes. Identity (name, email, password, skills) lives in `accounts.setup_users` via `setup_user_id`. **Never INSERT into MyAccount from Ticketing.**

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Local PK (assignee / session FK target) |
| `organization_id` | bigint | NO | — | FK → `accounts.organizations.id` |
| `setup_user_id` | bigint | NO | — | FK → `accounts.setup_users.id` (required, unique) |
| `support_email` | text | YES | — | Optional spoke email copy for mail |
| `support_phone` | text | YES | — | Optional spoke phone |
| `status` | text | NO | `Active`, `Inactive` | Bridge active for assignment/login |
| `role` | text | NO | `admin`, `agent`, `resolver`, `customer`, `viewer` | Spoke RBAC role mirror |
| `last_login_at` | timestamptz | YES | — | Last staff console login |
| `two_factor_enabled` | boolean | NO | `true`, `false` | Account-settings 2FA flag |
| `language` | text | NO | — | UI language preference |
| `timezone` | text | NO | — | Personal timezone preference |
| `date_format` | text | NO | — | Date display preference |
| `notify_ticket_assignments` | boolean | NO | `true`, `false` | Pref: assignment notifications |
| `notify_ticket_updates` | boolean | NO | `true`, `false` | Pref: update notifications |
| `notify_security_alerts` | boolean | NO | `true`, `false` | Pref: security notifications |
| `notify_sla_alerts` | boolean | NO | `true`, `false` | Pref: SLA notifications |
| `notify_product_updates` | boolean | NO | `true`, `false` | Pref: product notifications |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (live):**

```json
{
  "id": 1000,
  "organization_id": 1000,
  "setup_user_id": 1000,
  "support_email": "yaswanthmg1@gmail.com",
  "support_phone": null,
  "status": "Active",
  "role": "resolver",
  "last_login_at": "2026-08-20T11:43:02.314059+00:00",
  "two_factor_enabled": false,
  "language": "English",
  "timezone": "Asia/Kolkata",
  "date_format": "DD/MM/YYYY",
  "notify_ticket_assignments": true,
  "notify_ticket_updates": true,
  "notify_security_alerts": true,
  "notify_sla_alerts": true,
  "notify_product_updates": false,
  "created_at": "2026-08-20T11:41:32.194904+00:00",
  "updated_at": "2026-08-25T12:04:45.603641+00:00"
}
```

---

## 3. `user_sessions`

**What this table is for:** Staff console signed-in devices / JWT sessions. `user_id` → `agents.id`.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Session PK |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | NO | — | FK → `agents.id` |
| `device_label` | text | YES | — | Friendly device label |
| `browser` | text | YES | — | Browser name |
| `os` | text | YES | — | OS name |
| `location` | text | YES | — | Coarse location label |
| `user_agent` | text | YES | — | Raw User-Agent |
| `ip_address` | text | YES | — | Client IP |
| `is_current` | boolean | NO | `true`, `false` | Marked as current session |
| `last_active_at` | timestamptz | YES | — | Last activity |
| `created_at` | timestamptz | NO | — | Session start |
| `revoked_at` | timestamptz | YES | — | Null = still valid |

**Sample row (live):**

```json
{
  "id": 1019,
  "organization_id": 1000,
  "user_id": 1005,
  "device_label": "macOS — Chrome",
  "browser": "Chrome",
  "os": "macOS",
  "location": "Local",
  "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)…",
  "ip_address": "127.0.0.1",
  "is_current": false,
  "last_active_at": "2026-08-22T09:00:32.534737+00:00",
  "created_at": "2026-08-22T08:55:20.755156+00:00",
  "revoked_at": null
}
```

---

## 4. `user_login_events`

**What this table is for:** Append-only staff login history for the account security UI.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Event PK |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | NO | — | FK → `agents.id` |
| `device_label` | text | YES | — | Device label at login |
| `location` | text | YES | — | Location label |
| `ip_address` | text | YES | — | IP at login |
| `created_at` | timestamptz | NO | — | Login time |

**Sample row (illustrative shape):**

```json
{
  "id": 1030,
  "organization_id": 1000,
  "user_id": 1005,
  "device_label": "macOS — Chrome",
  "location": "Local",
  "ip_address": "127.0.0.1",
  "created_at": "2026-08-22T08:55:20.755156+00:00"
}
```

---

## 5. `contact_profile`

**What this table is for:** Support contact ops + customer portal credentials. **No** `name` / `email` / `phone` columns — resolve person fields from CDP using `cdp_id`.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Local contact PK (`tickets.customer_id`) |
| `organization_id` | bigint | NO | — | Tenant |
| `external_id` | text | YES | — | Optional external/CRM id |
| `cdp_id` | text | NO | — | CDP person id (unique per org) |
| `status` | text | NO | `Active`, `Inactive` | Contact usable for tickets/portal |
| `total_tickets` | integer | NO | — | Cached ticket count |
| `account_id` | bigint | YES | — | Optional FK → `ticketing_accounts.id` |
| `password_hash` | text | YES | — | Portal password hash (bcrypt); null if OTP-only |
| `password_set_at` | timestamptz | YES | — | When portal password was set |
| `last_portal_login_at` | timestamptz | YES | — | Last portal login |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (live):**

```json
{
  "id": 1000,
  "organization_id": 1000,
  "external_id": "CUST-MT1GMKGK-FLI",
  "status": "Active",
  "total_tickets": 1,
  "created_at": "2026-08-20T11:51:31.052423+00:00",
  "updated_at": "2026-08-22T08:59:27.851399+00:00",
  "account_id": null,
  "password_hash": null,
  "password_set_at": null,
  "last_portal_login_at": null,
  "cdp_id": "074a11ae-ca5e-465e-9212-164a1a031b0f"
}
```

---

## 6. `customer_portal_sessions`

**What this table is for:** Signed-in customer portal sessions.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Session PK |
| `organization_id` | bigint | NO | — | Tenant |
| `customer_id` | bigint | NO | — | FK → `contact_profile.id` |
| `device_label` | text | YES | — | Device label |
| `ip_address` | text | YES | — | Client IP |
| `user_agent` | text | YES | — | User-Agent |
| `last_active_at` | timestamptz | NO | — | Last activity |
| `created_at` | timestamptz | NO | — | Session start |
| `revoked_at` | timestamptz | YES | — | Null = active |

**Sample row (live):**

```json
{
  "id": 1000,
  "organization_id": 1000,
  "customer_id": 1001,
  "device_label": "Support portal",
  "ip_address": "127.0.0.1",
  "user_agent": "Mozilla/5.0 …",
  "last_active_at": "2026-08-25T04:35:44.413959+00:00",
  "created_at": "2026-08-21T16:01:54.626095+00:00",
  "revoked_at": null
}
```

---

## 7. `customer_otp_challenges`

**What this table is for:** One-time password challenges for portal login.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Challenge PK |
| `organization_id` | bigint | NO | — | Tenant |
| `customer_id` | bigint | NO | — | FK → `contact_profile.id` |
| `identifier` | text | NO | — | Email or phone OTP was sent to |
| `channel` | text | NO | `email`, `phone` | Delivery channel |
| `code_hash` | text | NO | — | Hash of OTP code |
| `attempts` | integer | NO | — | Failed verify attempts |
| `expires_at` | timestamptz | NO | — | Expiry |
| `consumed_at` | timestamptz | YES | — | When successfully used |
| `created_at` | timestamptz | NO | — | Created at |

**Sample row (live):**

```json
{
  "id": 1000,
  "organization_id": 1000,
  "customer_id": 1001,
  "identifier": "smohamedfazil16@gmail.com",
  "channel": "email",
  "code_hash": "<redacted>",
  "attempts": 1,
  "expires_at": "2026-08-21T16:11:14.919478+00:00",
  "consumed_at": "2026-08-21T16:01:54.473134+00:00",
  "created_at": "2026-08-21T16:01:14.919478+00:00"
}
```

---

## 8. `customer_password_tokens`

**What this table is for:** One-time tokens for portal password set/reset links.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Token PK |
| `organization_id` | bigint | NO | — | Tenant |
| `customer_id` | bigint | NO | — | FK → `contact_profile.id` |
| `token_hash` | text | NO | — | Hash of raw token |
| `expires_at` | timestamptz | NO | — | Expiry |
| `consumed_at` | timestamptz | YES | — | When used |
| `created_at` | timestamptz | NO | — | Created at |

**Sample row (illustrative — often empty):**

```json
{
  "id": 1,
  "organization_id": 1000,
  "customer_id": 1001,
  "token_hash": "<redacted>",
  "expires_at": "2026-08-21T12:00:00+00:00",
  "consumed_at": null,
  "created_at": "2026-08-21T11:00:00+00:00"
}
```

---

## 9. `ticketing_accounts`

**What this table is for:** B2B **client** accounts inside Ticketing (companies your end-customers belong to). **Not** MyAccount `accounts.*`.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | B2B account PK |
| `organization_id` | bigint | NO | — | Tenant (support org) |
| `name` | text | NO | — | Client company name |
| `status` | text | NO | `Active`, `Inactive` | Active for linking contacts |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (illustrative — currently empty):**

```json
{
  "id": 1,
  "organization_id": 1000,
  "name": "Acme Corp",
  "status": "Active",
  "created_at": "2026-08-20T12:00:00+00:00",
  "updated_at": "2026-08-20T12:00:00+00:00"
}
```

---

## 10. `agent_queues`

**What this table is for:** Support teams / queues used for routing and workload.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Queue PK |
| `organization_id` | bigint | NO | — | Tenant |
| `external_id` | text | YES | — | Optional external id |
| `queue_name` | text | NO | — | Team/queue display name |
| `description` | text | NO | — | Scope / purpose text |
| `type` | text | NO | `Private`, `Shared` | Queue visibility model |
| `open_tickets` | integer | NO | — | Cached open count |
| `assigned` | integer | NO | — | Cached assigned count |
| `sla_status` | text | NO | `On Track`, `At Risk` | Queue SLA health |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (live):**

```json
{
  "id": 1000,
  "organization_id": 1000,
  "external_id": null,
  "queue_name": "Bug Solvers",
  "type": "Shared",
  "open_tickets": 17,
  "assigned": 17,
  "sla_status": "At Risk",
  "description": "This team specializes strictly in CCaaS backend infrastructure…",
  "created_at": "2026-08-20T16:31:53.60564+00:00",
  "updated_at": "2026-08-25T12:03:02.497044+00:00"
}
```

---

## 11. `agent_queue_members`

**What this table is for:** Which agents belong to which queue.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Membership PK |
| `organization_id` | bigint | NO | — | Tenant |
| `queue_id` | bigint | NO | — | FK → `agent_queues.id` |
| `user_id` | bigint | NO | — | FK → `agents.id` |
| `created_at` | timestamptz | NO | — | Added at |

**Sample row (live):**

```json
{
  "id": 1000,
  "organization_id": 1000,
  "queue_id": 1000,
  "user_id": 1000,
  "created_at": "2026-08-20T16:31:53.919633+00:00"
}
```

---

## 12. `tickets`

**What this table is for:** Core support cases (the main work item).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Ticket PK |
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_number` | text | NO | — | Human number, e.g. `#20` |
| `subject` | text | NO | — | Short title |
| `description` | text | YES | — | Full issue / intake body |
| `status` | text | NO | `Open`, `Pending`, `Reopened`, `Resolved`, `Overdue` (+ custom) | Lifecycle status |
| `priority` | text | NO | `urgent`, `high`, `medium`, `low` | SLA priority key |
| `channel` | text | NO | `Email`, `Chat`, `Phone`, `Web` | Intake channel |
| `category` | text | YES | `Billing`, `Troubleshooting`, `Accounts`, `General`, `Database`, `Testing`, *(free text)* | Triage category |
| `skill` | text | YES | — | Skill tag for auto-assign |
| `customer_id` | bigint | YES | — | FK → `contact_profile.id` |
| `customer_name` | text | YES | — | Display snapshot (CDP is SoR) |
| `customer_email` | text | YES | — | Display snapshot |
| `customer_phone` | text | YES | — | Display snapshot |
| `assignee_id` | bigint | YES | — | L1 FK → `agents.id` |
| `assignee_name` | text | YES | `Unassigned` or person name | Display assignee |
| `resolver_id` | bigint | YES | — | L2 FK → `agents.id` |
| `resolver_name` | text | YES | — | Display resolver |
| `queue_id` | bigint | YES | — | FK → `agent_queues.id` |
| `queue_name` | text | YES | — | Display queue name |
| `attachments` | text[] | NO | — | Attachment refs |
| `due_at` | timestamptz | YES | — | SLA resolution deadline |
| `first_response_at` | timestamptz | YES | — | First staff public response |
| `resolved_at` | timestamptz | YES | — | Entered terminal status |
| `csat_score` | integer | YES | `1`, `2`, `3`, `4`, `5` | CSAT rating |
| `csat_rated_at` | timestamptz | YES | — | When CSAT submitted |
| `created_by_id` | bigint | YES | — | Creator agent or null |
| `created_by_name` | text | YES | — | Creator label (`API:…` / name) |
| `ai_summary` | text | YES | — | LLM short summary |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Status meaning**

| Value | Terminal? | Meaning |
|-------|-----------|---------|
| `Open` | No | New / not yet in progress |
| `Pending` | No | In progress (UI: “In Progress”) |
| `Reopened` | No | Was resolved, then reopened |
| `Resolved` | **Yes** | Closed |
| `Overdue` | No | Past SLA, still unresolved |

**Sample row (live):**

```json
{
  "id": 1019,
  "organization_id": 1000,
  "ticket_number": "#20",
  "subject": "E2E test — chatbot ticket creation check",
  "status": "Open",
  "priority": "low",
  "channel": "Chat",
  "category": "Testing",
  "skill": "troubleshooting",
  "customer_id": 1001,
  "customer_name": "Mohamed Fazil",
  "customer_email": "smohamedfazil16@gmail.com",
  "customer_phone": "9597036512",
  "assignee_id": 1001,
  "assignee_name": "Mohammed Fazil",
  "resolver_id": 1003,
  "resolver_name": "Sri Annamalai",
  "queue_id": 1000,
  "queue_name": "Bug Solvers",
  "attachments": [],
  "due_at": "2026-08-28T06:03:25.576+00:00",
  "first_response_at": null,
  "csat_score": null,
  "csat_rated_at": null,
  "created_by_id": null,
  "created_by_name": "API:Website + email integrations",
  "resolved_at": null,
  "ai_summary": "An E2E test ticket was created via webchat to verify the chatbot's ticket creation functionality.",
  "created_at": "2026-08-25T06:03:09.427512+00:00",
  "updated_at": "2026-08-25T06:03:27.925828+00:00"
}
```

---

## 13. `ticket_notes`

**What this table is for:** Conversation thread on a ticket (public replies + internal notes).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Note PK |
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_id` | bigint | NO | — | FK → `tickets.id` |
| `author_id` | bigint | YES | — | FK → `agents.id` |
| `author_name` | text | YES | — | Author display name |
| `body` | text | NO | — | Note / reply text |
| `visibility` | text | NO | `internal`, `public` | Staff-only vs customer-visible |
| `created_at` | timestamptz | NO | — | Created at |

**Sample row (live):**

```json
{
  "id": 1012,
  "organization_id": 1000,
  "ticket_id": 1008,
  "author_id": 1005,
  "author_name": "Deva NS",
  "body": "Dear Mohamed Fazil, Thank you for reaching out…",
  "visibility": "public",
  "created_at": "2026-08-24T10:04:43.223526+00:00"
}
```

---

## 14. `ticket_presence`

**What this table is for:** Who is currently viewing a ticket (collision UI).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_id` | bigint | NO | — | FK → `tickets.id` |
| `user_id` | bigint | NO | — | FK → `agents.id` |
| `user_name` | text | YES | — | Viewer display name |
| `last_seen_at` | timestamptz | NO | — | Last heartbeat |

**Sample row (live):**

```json
{
  "organization_id": 1000,
  "ticket_id": 1008,
  "user_id": 1005,
  "user_name": "Deva NS",
  "last_seen_at": "2026-08-24T09:40:43.827066+00:00"
}
```

---

## 15. `ticket_statuses`

**What this table is for:** Per-org catalog of allowed ticket statuses (system + custom).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Row PK |
| `organization_id` | bigint | NO | — | Tenant |
| `status` | text | NO | system: `Open`, `Pending`, `Reopened`, `Resolved`, `Overdue` | Stored status key |
| `display_name` | text | NO | — | UI label |
| `is_system` | boolean | NO | `true`, `false` | Built-in; not deletable |
| `is_terminal` | boolean | NO | `true`, `false` | Closes the ticket |
| `sort_order` | integer | NO | — | Picker order |
| `active` | boolean | NO | `true`, `false` | Available for use |

**Sample rows (live org 1000):**

```json
[
  {"status": "Open", "display_name": "Open", "is_system": true, "is_terminal": false, "sort_order": 1, "active": true},
  {"status": "Pending", "display_name": "In Progress", "is_system": true, "is_terminal": false, "sort_order": 2, "active": true},
  {"status": "Reopened", "display_name": "Reopened", "is_system": true, "is_terminal": false, "sort_order": 3, "active": true},
  {"status": "Resolved", "display_name": "Resolved", "is_system": true, "is_terminal": true, "sort_order": 4, "active": true},
  {"status": "Overdue", "display_name": "Overdue", "is_system": true, "is_terminal": false, "sort_order": 5, "active": true}
]
```

---

## 16. `sla_policy_defaults`

**What this table is for:** Global default SLA hours by priority (seed for new orgs).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `priority` | text | NO | `urgent`, `high`, `medium`, `low` | Priority key |
| `resolution_hours` | integer | NO | — | Hours create → due |
| `first_response_hours` | integer | NO | — | Hours to first response |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample rows (live):**

```json
[
  {"priority": "urgent", "resolution_hours": 4, "first_response_hours": 1},
  {"priority": "high", "resolution_hours": 8, "first_response_hours": 2},
  {"priority": "medium", "resolution_hours": 24, "first_response_hours": 4},
  {"priority": "low", "resolution_hours": 72, "first_response_hours": 8}
]
```

---

## 17. `sla_policies`

**What this table is for:** Per-org SLA windows by priority (what actually drives `tickets.due_at`).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Row PK |
| `organization_id` | bigint | NO | — | Tenant |
| `priority` | text | NO | `urgent`, `high`, `medium`, `low` | Priority key |
| `display_name` | text | YES | — | UI label |
| `resolution_hours` | integer | NO | — | Hours create → due |
| `first_response_hours` | integer | NO | — | Hours to first response |
| `active` | boolean | NO | `true`, `false` | In use |

**Sample rows (live):**

```json
[
  {"priority": "urgent", "display_name": "Urgent", "resolution_hours": 4, "first_response_hours": 1, "active": true},
  {"priority": "high", "display_name": "High", "resolution_hours": 8, "first_response_hours": 2, "active": true},
  {"priority": "medium", "display_name": "Medium", "resolution_hours": 24, "first_response_hours": 4, "active": true},
  {"priority": "low", "display_name": "Low", "resolution_hours": 72, "first_response_hours": 8, "active": true}
]
```

---

## 18. `activity_logs`

**What this table is for:** Short human-readable activity feed for home/activity UI.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Row PK |
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_id` | bigint | YES | — | Related ticket |
| `text` | text | NO | — | One-line activity text |
| `created_at` | timestamptz | NO | — | When logged |

**Sample row (live):**

```json
{
  "id": 1086,
  "organization_id": 1000,
  "ticket_id": 1013,
  "text": "Ticket #14 updated",
  "created_at": "2026-08-25T06:29:02.136653+00:00"
}
```

---

## 19. `audit_events`

**What this table is for:** Append-only compliance audit trail of important mutations.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Event PK |
| `organization_id` | bigint | NO | — | Tenant |
| `actor_id` | bigint | YES | — | Agent who acted |
| `actor_name` | text | YES | — | Actor display name |
| `action` | text | NO | `ticket.created`, `ticket.updated`, `ticket.status_changed`, `ticket.assigned`, `ticket.escalated`, `ticket.resolver_set` | Action code |
| `ticket_id` | bigint | YES | — | Related ticket |
| `ticket_number` | text | YES | — | Ticket number snapshot |
| `meta` | jsonb | NO | — | Change details JSON |
| `created_at` | timestamptz | NO | — | When audited |

**Sample row (live):**

```json
{
  "id": 1050,
  "organization_id": 1000,
  "actor_id": 1005,
  "actor_name": "Deva NS",
  "action": "ticket.updated",
  "ticket_id": 1019,
  "ticket_number": "#20",
  "meta": {"fields": {"queue": "Bug Solvers", "subject": false, "priority": "low"}},
  "created_at": "2026-08-25T06:03:25.585071+00:00"
}
```

---

## 20. `kb_articles`

**What this table is for:** Knowledge-base articles for help center / agent assist.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Article PK |
| `organization_id` | bigint | NO | — | Tenant |
| `external_id` | text | YES | — | Optional external id |
| `title` | text | NO | — | Title |
| `content` | text | NO | — | Body |
| `category` | text | NO | `Billing`, `Troubleshooting`, `Accounts`, `General`, *(free text)* | Category |
| `author_name` | text | NO | — | Author display name |
| `author_id` | bigint | YES | — | FK → `agents.id` |
| `status` | text | NO | `Published`, `Draft` | Publish state |
| `views` | integer | NO | — | View counter |
| `attachments` | text[] | NO | — | Attachment refs |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (live):**

```json
{
  "id": 1003,
  "organization_id": 1000,
  "external_id": "KB-MT2GGXQ3-6CZC",
  "title": "Teams",
  "content": "1.When creating or defining a team…",
  "category": "General",
  "author_name": "Deva NS",
  "author_id": 1005,
  "status": "Published",
  "views": 0,
  "attachments": [],
  "created_at": "2026-08-21T04:34:54.490313+00:00",
  "updated_at": "2026-08-21T04:34:54.490313+00:00"
}
```

---

## 21. `macros`

**What this table is for:** Saved reply templates for agents.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Macro PK |
| `organization_id` | bigint | NO | — | Tenant |
| `title` | text | NO | — | Picker name |
| `body` | text | NO | — | Template body |
| `created_by_id` | bigint | YES | — | Creator agent |
| `created_by_name` | text | YES | — | Creator name |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (live):**

```json
{
  "id": 1000,
  "organization_id": 1000,
  "title": "login in",
  "body": "Common Causes & FixesIncorrect Credentials: …",
  "created_by_id": 1005,
  "created_by_name": "Deva NS",
  "created_at": "2026-08-23T08:17:20.635349+00:00",
  "updated_at": "2026-08-23T08:17:20.635349+00:00"
}
```

---

## 22. `notifications`

**What this table is for:** In-app inbox notifications for staff (`user_id` → `agents.id`).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Notification PK |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | YES | — | Recipient → `agents.id` |
| `title` | text | NO | — | Title |
| `message` | text | NO | — | Body |
| `ticket_id` | bigint | YES | — | Related ticket |
| `customer_name` | text | YES | — | Related customer label |
| `is_read` | boolean | NO | `true`, `false` | Read state |
| `kind` | text | YES | `assignment`, `update`, `sla`, `security`, `product` | Preference bucket |
| `created_at` | timestamptz | NO | — | Created at |

**Sample row (live):**

```json
{
  "id": 1189,
  "organization_id": 1000,
  "user_id": 1003,
  "title": "SLA due within 1 hour",
  "message": "Ticket #10 (\"already given\") is due within one hour.",
  "ticket_id": 1009,
  "customer_name": "Mohamed Fazil",
  "is_read": false,
  "kind": "sla",
  "created_at": "2026-08-25T11:48:12.210794+00:00"
}
```

---

## 23. `dashboard_metrics`

**What this table is for:** Cached KPI snapshot for the home dashboard (one row per org typically).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Row PK |
| `organization_id` | bigint | NO | — | Tenant |
| `open_tickets` | integer | NO | — | Open count |
| `on_hold` | integer | NO | — | Legacy hold count (usually 0) |
| `overdue` | integer | NO | — | Overdue count |
| `due_today` | integer | NO | — | Due today count |
| `unassigned` | integer | NO | — | Unassigned count |
| `open_change` | text | NO | — | Trend label vs prior period |
| `on_hold_change` | text | NO | — | Trend label |
| `overdue_change` | text | NO | — | Trend label |
| `due_today_change` | text | NO | — | Trend label |
| `unassigned_change` | text | NO | — | Trend label |
| `captured_at` | timestamptz | NO | — | Snapshot time |

**Sample row (live):**

```json
{
  "id": 1000,
  "organization_id": 1000,
  "open_tickets": 19,
  "on_hold": 0,
  "overdue": 14,
  "due_today": 2,
  "unassigned": 0,
  "open_change": "—",
  "on_hold_change": "—",
  "overdue_change": "—",
  "due_today_change": "—",
  "unassigned_change": "—",
  "captured_at": "2026-08-25T12:02:57.697029+00:00"
}
```

---

## 24. `automation_rules`

**What this table is for:** If/then rules on ticket create/update.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Rule PK |
| `organization_id` | bigint | NO | — | Tenant |
| `name` | text | NO | — | Rule name |
| `event` | text | NO | `ticket.created`, `ticket.updated` | Trigger |
| `enabled` | boolean | NO | `true`, `false` | Active |
| `priority` | integer | NO | — | Evaluation order (lower first) — **not** ticket priority |
| `conditions` | jsonb | NO | — | Match conditions |
| `actions` | jsonb | NO | — | Actions to apply |
| `created_by_id` | bigint | YES | — | Creator agent |
| `created_by_name` | text | YES | — | Creator name |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (illustrative — often empty):**

```json
{
  "id": 1,
  "organization_id": 1000,
  "name": "Urgent → Bug Solvers",
  "event": "ticket.created",
  "enabled": true,
  "priority": 100,
  "conditions": {"priority": ["urgent"]},
  "actions": {"set_queue": "Bug Solvers"},
  "created_by_id": 1005,
  "created_by_name": "Admin",
  "created_at": "2026-08-20T12:00:00+00:00",
  "updated_at": "2026-08-20T12:00:00+00:00"
}
```

---

## 25. `org_api_keys`

**What this table is for:** Integration API keys (`wt_live_…`) for website/email intake.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Key PK |
| `organization_id` | bigint | NO | — | Tenant |
| `name` | text | NO | — | Label |
| `key_prefix` | text | NO | — | Public prefix shown in UI |
| `key_hash` | text | NO | — | Hash of secret (never store raw) |
| `created_by_id` | bigint | YES | — | Creator agent |
| `created_by_name` | text | YES | — | Creator name |
| `last_used_at` | timestamptz | YES | — | Last successful use |
| `revoked_at` | timestamptz | YES | — | Null = active |
| `created_at` | timestamptz | NO | — | Created at |

**Sample row (live):**

```json
{
  "id": 1003,
  "organization_id": 1000,
  "name": "Website + email integrations",
  "key_prefix": "wt_live_xnHWnX2S",
  "key_hash": "<redacted>",
  "created_by_id": 1005,
  "created_by_name": "Deva NS",
  "last_used_at": "2026-08-25T06:04:14.993125+00:00",
  "revoked_at": null,
  "created_at": "2026-08-25T05:51:32.486198+00:00"
}
```

---

## 26. `org_widgets`

**What this table is for:** Embeddable help-widget configuration.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Widget PK |
| `organization_id` | bigint | NO | — | Tenant |
| `name` | text | NO | — | Widget name |
| `config` | jsonb | YES | — | Widget JSON config |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |

**Sample row (illustrative — often empty):**

```json
{
  "id": 1,
  "organization_id": 1000,
  "name": "Help widget",
  "config": {"theme": "light"},
  "created_at": "2026-08-20T12:00:00+00:00",
  "updated_at": "2026-08-20T12:00:00+00:00"
}
```

---

## 27. `email_message_refs`

**What this table is for:** Maps inbound email `Message-ID` → ticket for threading.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Row PK |
| `organization_id` | bigint | NO | — | Tenant |
| `message_id` | text | NO | — | Email Message-ID header |
| `ticket_id` | bigint | NO | — | FK → `tickets.id` |
| `ticket_number` | text | NO | — | Ticket number snapshot |
| `created_at` | timestamptz | NO | — | Created at |

**Sample row (illustrative — often empty):**

```json
{
  "id": 1,
  "organization_id": 1000,
  "message_id": "<abc123@mail.example>",
  "ticket_id": 1019,
  "ticket_number": "#20",
  "created_at": "2026-08-25T06:03:09+00:00"
}
```

---

## 28. `outbound_email_log`

**What this table is for:** Log of outbound emails (customer, staff, SLA).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Log PK |
| `organization_id` | bigint | NO | — | Tenant |
| `ticket_id` | bigint | YES | — | Related ticket |
| `ticket_number` | text | YES | — | Ticket number |
| `kind` | text | NO | see below | Which mail flow |
| `to_email` | text | NO | — | Recipient |
| `subject` | text | NO | — | Subject |
| `body_preview` | text | YES | — | Short body preview |
| `status` | text | NO | `queued`, `sent`, `failed`, `skipped` | Delivery outcome |
| `error` | text | YES | — | Failure reason |
| `created_at` | timestamptz | NO | — | When logged |

**`kind` values**

| Value | Meaning |
|-------|---------|
| `ticket_created` | Customer “ticket created” |
| `ticket_reply` | Customer reply |
| `ticket_resolved` | Customer resolved |
| `staff_ticket_created` | Staff notify on create |
| `sla_reminder_1h` | ~1h before due |
| `sla_breach_admin` | Breach mail to admins |
| `dssa_deflection` | Self-service deflection |
| `portal_otp` | Portal OTP |
| `portal_set_password` | Portal password setup |
| `not_registered_customer` | Not-registered notice |

**Sample row (live):**

```json
{
  "id": 1084,
  "organization_id": 1000,
  "ticket_id": 1009,
  "ticket_number": "#10",
  "kind": "sla_reminder_1h",
  "to_email": "smohamedfazil16@gmail.com",
  "subject": "[SLA reminder] #10 due within 1 hour",
  "body_preview": "Hi Mohammed Fazil, Ticket #10 …",
  "status": "sent",
  "error": null,
  "created_at": "2026-08-25T11:48:10.949315+00:00"
}
```

---

## 29. `ticket_event_outbox`

**What this table is for:** Outbound webhook / event delivery queue for ticket changes.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Outbox PK |
| `organization_id` | bigint | NO | — | Tenant |
| `event_type` | text | NO | e.g. `ticket.updated` | Event type |
| `payload` | jsonb | NO | — | Event JSON |
| `webhook_url` | text | YES | — | Delivery URL |
| `status` | text | NO | `queued`, `pending`, `delivered`, `failed` | Delivery state |
| `attempts` | integer | NO | — | Attempt count |
| `last_error` | text | YES | — | Last error |
| `created_at` | timestamptz | NO | — | Created at |
| `delivered_at` | timestamptz | YES | — | Delivered at |

**Sample row (live):**

```json
{
  "id": 51,
  "organization_id": 1000,
  "event_type": "ticket.updated",
  "payload": {
    "type": "ticket.updated",
    "ticketId": "1019",
    "ticketNumber": "#20",
    "organizationId": "1000"
  },
  "webhook_url": null,
  "status": "queued",
  "attempts": 0,
  "last_error": null,
  "created_at": "2026-08-25T06:03:25.585958+00:00",
  "delivered_at": null
}
```

---

## 30. `conversation_contexts`

**What this table is for:** Co-worker / LangGraph chat conversation state (active + parked workflows, recent history).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Context PK |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | YES | — | Optional FK → `agents.id` |
| `user_key` | text | NO | — | Stable chat user key |
| `session_key` | text | NO | — | Chat session key |
| `context` | jsonb | NO | — | State JSON (workflows, history) |
| `version` | bigint | NO | — | Optimistic concurrency version |
| `created_at` | timestamptz | NO | — | Created at |
| `updated_at` | timestamptz | NO | — | Updated at |
| `expires_at` | timestamptz | YES | — | Expiry |

**Sample row (live, truncated):**

```json
{
  "id": 543,
  "organization_id": 1000,
  "user_id": null,
  "user_key": "1005",
  "session_key": "cw_1005_s-1787655167546-d5e11j7o",
  "context": {
    "recent_history": [
      {"role": "user", "text": "hello"},
      {"role": "assistant", "text": "Hello! How can I help you today?"}
    ],
    "active_workflow": null,
    "parked_workflows": []
  },
  "version": 2,
  "created_at": "2026-08-25T10:52:59.373569+00:00",
  "updated_at": "2026-08-25T10:53:03.402566+00:00",
  "expires_at": "2026-09-24T10:53:03.402566+00:00"
}
```

---

## 31. `workflow_events`

**What this table is for:** Workflow / agent event history (e.g. create-ticket chat flow).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Event PK |
| `organization_id` | bigint | NO | — | Tenant |
| `user_id` | bigint | YES | — | Optional agent |
| `user_key` | text | NO | — | Chat user key |
| `session_key` | text | NO | — | Session key |
| `request_id` | text | NO | — | Per-turn request id |
| `conversation_context_id` | bigint | YES | — | FK → `conversation_contexts` |
| `workflow_id` | text | YES | — | Workflow instance id |
| `workflow_type` | text | NO | e.g. `create_ticket` | Workflow type |
| `event_type` | text | NO | e.g. `workflow_started` | Event type |
| `event_data` | jsonb | NO | — | Payload |
| `version` | bigint | NO | — | State version |
| `created_at` | timestamptz | NO | — | Created at |
| `expires_at` | timestamptz | YES | — | Expiry |

**Sample row (live):**

```json
{
  "id": 177,
  "organization_id": 1000,
  "user_id": null,
  "user_key": "1001",
  "session_key": "portal_zifo-mt1g9pve_1001_befb7965-d222-4131-b750-1b833c1ade49",
  "request_id": "a31f0126-6310-47e0-902f-0b6418190909",
  "conversation_context_id": 396,
  "workflow_id": "create_ticket",
  "workflow_type": "create_ticket",
  "event_type": "workflow_started",
  "event_data": {"workflow": "create_ticket", "state_version": 5},
  "version": 5,
  "created_at": "2026-08-22T10:40:52.511917+00:00",
  "expires_at": "2026-09-21T10:40:53.441576+00:00"
}
```

---

## 32. `proactive_outbox`

**What this table is for:** Events consumed by proactive agents (SEMA / WLOA / TIAA / RCAA).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Event PK |
| `organization_id` | bigint | NO | — | Tenant |
| `event_type` | text | NO | `ticket.created`, `ticket.updated`, `ticket.comment_added`, `customer.replied`, `ticket.escalated`, `ticket.sla_at_risk`, `inbound.message`, `schedule.sema`, `schedule.wloa`, `schedule.tiaa`, `schedule.rcaa` | Event type |
| `ticket_id` | text | YES | — | Related ticket id (text) |
| `ticket_number` | text | YES | — | Ticket number |
| `actor` | text | YES | — | Who triggered |
| `payload` | jsonb | NO | — | Event payload |
| `created_at` | timestamptz | NO | — | Created at |
| `processed_at` | timestamptz | YES | — | When consumed |

**Sample row (live):**

```json
{
  "id": 77,
  "organization_id": 1000,
  "event_type": "ticket.updated",
  "ticket_id": "1013",
  "ticket_number": "#14",
  "actor": null,
  "payload": {
    "new_status": "Overdue",
    "prev_status": "Open",
    "sla_breached": true,
    "statusChanged": true,
    "ticket_number": "#14"
  },
  "created_at": "2026-08-25T06:29:01.561175+00:00",
  "processed_at": "2026-08-25T06:29:01.572112+00:00"
}
```

---

## 33. `proactive_recommendations`

**What this table is for:** Proactive suggestions shown to agents.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Recommendation PK |
| `organization_id` | bigint | NO | — | Tenant |
| `agent_id` | text | YES | e.g. `sema`, `wloa`, `tiaa`, `rcaa` | **Proactive agent code** (not `agents.id`) |
| `ticket_id` | text | YES | — | Related ticket |
| `status` | text | NO | `open`, `accepted`, `dismissed` | Agent decision |
| `payload` / related JSON | jsonb | — | — | Recommendation content |
| `reason` | text | YES | — | Why recommended |
| `dedupe_key` | text | YES | — | Dedup key |
| `created_at` | timestamptz | NO | — | Created at |

**`status` meaning:** `open` = waiting; `accepted` = agent accepted; `dismissed` = agent dismissed.

---

## 34. `proactive_approvals`

**What this table is for:** Human-in-the-loop approvals for proactive tool actions.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Approval PK |
| `organization_id` | bigint | NO | — | Tenant |
| `agent_id` | text | YES | proactive code | Which proactive agent |
| `ticket_id` | text | YES | — | Related ticket |
| `status` | text | NO | `pending`, `approved`, `rejected` | Human decision |
| `tool_name` | text | YES | — | Tool awaiting approval |
| `payload` | jsonb | YES | — | Tool args / context |
| `created_at` | timestamptz | NO | — | Created at |

---

## 35. `proactive_audit`

**What this table is for:** Proactive agent decision audit log (learning / explainability).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Audit PK |
| `organization_id` | bigint | NO | — | Tenant |
| `agent_id` | text | YES | proactive code | Which agent decided |
| `ticket_id` | text | YES | — | Related ticket |
| `event_id` | text | YES | — | Related outbox event |
| `decision` | text | YES | e.g. `execute`, `skip` | Decision outcome |
| `reason` | text | YES | — | Why |
| `tool_name` | text | YES | — | Tool involved |
| `payload` | jsonb | YES | — | Decision details / weights |
| `created_at` | timestamptz | NO | — | Created at |

---

## 36. `proactive_embeddings`

**What this table is for:** Embedding tokens for proactive search / similarity.

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `id` | bigint | NO | — | Row PK |
| `organization_id` | bigint | NO | — | Tenant |
| `token` | text | YES | — | Embedding key/token |
| `embedding` | — | YES | — | Vector / serialized embedding |
| `created_at` | timestamptz | NO | — | Created at |

**Sample row (illustrative — often empty):**

```json
{
  "id": 1,
  "organization_id": 1000,
  "token": "example-token",
  "embedding": "<vector omitted>",
  "created_at": "2026-08-20T12:00:00+00:00"
}
```

---

## 37. `proactive_routing_weights`

**What this table is for:** Per-org learned routing weights and recurring-issue hints (RCAA).

| Column | Type | Null | Categorical values | Meaning |
|--------|------|------|--------------------|---------|
| `organization_id` | bigint | NO | — | PK / tenant |
| `weights` | jsonb | NO | — | Skill weights + recurring issues |
| `updated_at` | timestamptz | NO | — | Last learning update |

**Sample row (live, truncated):**

```json
{
  "organization_id": 1000,
  "weights": {
    "skill_weights": {"team": 1, "agent": 0.5, "skill": 1},
    "recurring_issues": [
      {
        "theme": "CCaaS Live Agent Connection Failures",
        "routing_hint": "Route to 'solve backend issues' skill; high priority infrastructure bug."
      }
    ]
  },
  "updated_at": "2026-08-25T12:03:11.848206+00:00"
}
```

---

## Hub tables Ticketing reads (not owned here)

| Schema.table | Role |
|--------------|------|
| `accounts.organizations` | Tenant company (`company_name`, `business_type` = `b2b`\|`b2c`, `support_portal_*`) |
| `accounts.setup_users` | Staff identity, password hash, skills |
| `accounts.setup_roles` | Role names |
| `accounts.setup_user_product_access` | Who has product `ticketing` |
| `accounts.setup_teams` | Optional teams (read); queues still spoke |
| `cdp.customer_profile` | Person names |
| `cdp.identity_keys` | Email / phone identities |
| `inventory.products` | Product catalog |

---

## Related docs

- [ticketing-hub-spoke-ownership.md](./ticketing-hub-spoke-ownership.md) — ownership rules
- [ticketing-tables-and-labels.md](./ticketing-tables-and-labels.md) — enum/label reference
- [ticketing-schema.md](./ticketing-schema.md) — deeper schema notes
