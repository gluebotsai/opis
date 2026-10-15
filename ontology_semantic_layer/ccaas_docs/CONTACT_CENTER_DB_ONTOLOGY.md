# Contact Center product database — PostgreSQL tables, columns, entities

**Audience:** people who need to understand what Contact Center stores in Postgres and how it relates to Accounts and CDP.

All of this data lives in **PostgreSQL**, typically database `worktual_bigint`.

| Schema | What it is | Who writes it |
|--------|------------|----------------|
| `accounts` | Tenant setup: org, users, teams, channels, queues, hours, voice DIDs, recording settings | My Account / admin setup |
| `ccass` | Live contact center: conversations, routing, presence, bot, co-worker, team chat | cc-core, chat, social, NLP |
| `cdp` | The customer: profile, identities, a projection of conversations, orders | Contact Center writes profiles and projections; commerce owns orders |

`accounts` is the source of truth for **configuration**. `ccass` is the source of truth for **live operations**. `cdp` is the **customer**. Do not route calls from CDP.

This document covers tables **Contact Center uses**. It does not list billing, reseller, partner, or quotation tables in `accounts`, and it does not list the full CDP analytics warehouse.

**Sources (September 2026):** `packages/db-cc/prisma/schema.prisma` for `accounts` and `ccass`. CDP and `ccass.call_cdr` come from the SQL Contact Center runs, because those tables are not Prisma models.

IDs are **bigint** unless noted. APIs usually return them as strings. `cdp.customer_profile.cdp_id` is **text**, and `ccass.conversations.contact_id` stores that same text.

```sql
SELECT * FROM ccass.conversations WHERE organization_id = 1000;
SELECT * FROM cdp.customer_profile WHERE organization_id = 1000;
```

---

## How to read this document

Each table has:

1. **Purpose** — why Contact Center has this table
2. **Keys** — primary key, declared foreign keys (Postgres `REFERENCES` inside the schema), and logical refs (same id, no Postgres FK)
3. **Columns** — type, required, allowed values when they are a fixed set, and why the column exists
4. **Example row** — one realistic row using the shared ids below

**Declared FK** means Postgres will enforce it. **Logical ref** means the application joins on that id, but the database will not cascade-delete across schemas.

---

## Shared example IDs

| Symbol | Example | Meaning |
|--------|---------|---------|
| `ORG_ID` | `1000` | `accounts.organizations.id` |
| `USER_ID` | `1005` | `accounts.setup_users.id` |
| `AGENT_ID` | `301` | `ccass.agents.id` |
| `QUEUE_ID` | `401` | `ccass.queues.id` |
| `SETUP_QUEUE_ID` | `55` | `accounts.setup_ccaas_queues.id` |
| `CONV_ID` | `9001` | `ccass.conversations.id` |
| `CONTACT_ID` | `9000000000000000123` | `cdp.customer_profile.cdp_id` |

---

# Core product entities

| Entity | What it is | Home |
|--------|------------|------|
| Organization | The company. All rows are isolated by this id. | `accounts.organizations` |
| User | A person who logs in. | `accounts.setup_users` |
| Role | What that user may do. | `accounts.setup_roles` + `setup_user_product_access` |
| Team | Group that owns queues. | `accounts.setup_teams` |
| Channel | Web chat, email, social, or voice configuration. | `accounts.setup_channel_configs` and child tables |
| Setup queue | Queue as authored by an admin. | `accounts.setup_ccaas_queues` |
| Queue | Published copy used for live routing. | `ccass.queues` |
| Agent | Published user used by routing. | `ccass.agents` |
| Presence | Whether the agent can take work right now. | `ccass.agent_presence` |
| Conversation | One customer session on one channel. | `ccass.conversations` |
| Message | One turn in that session. | `ccass.conversation_messages` |
| Assignment | An offer to an agent. | `ccass.conversation_assignments` |
| Contact | The person. | `cdp.customer_profile` |
| Identity | An email or phone for that person. | `cdp.identity_keys` |
| Interaction | Customer-timeline copy of a conversation. | `cdp.interactions` |
| Task | Callback or follow-up in the agent inbox. | `ccass.agent_tasks` |
| Team chat | Agent-to-agent chat, not the customer. | `ccass.internal_chat_*` |

### How the main rows connect

```text
Organization 1──* User 1──1 Agent
Organization 1──* Setup queue ──publish──* Queue
Setup queue 1──* Setup queue agent ──publish──* Queue member (Agent)
User *── HAS_ROLE ──* Role

Conversation *── channel config, queue, agent, user
Conversation *── contact_id ── Contact 1──* Identity key
Conversation 1──* Message, Assignment, Transfer, Disposition, Note
Conversation 1──1 SLA state, Webchat session, NLP session, Interaction

Channel config 1──1 Webchat or Email or Social config
Channel config 1──1 Channel automation policy ── default queue
```

Publish path:

```text
accounts.setup_ccaas_queues        →  ccass.queues.setup_queue_id
accounts.setup_ccaas_queue_agents  →  ccass.agents + ccass.queue_members
accounts.setup_users               →  ccass.agents.setup_user_id
```

---

# Schema `accounts` (setup Contact Center uses)

28 tables. Billing, leads, quotations, partners, and resellers are omitted.

---

## `accounts.organizations`

**Purpose:** Tenant company. Every Contact Center row is isolated by this id.

**Keys:** PK `id`. Declared FK `reseller_id` → `accounts.resellers.id`; `source_lead_id` → `accounts.leads.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `tenant_id` | varchar(16) | yes |  | Tenant id. |
| `company_name` | varchar(255) | no |  | Company name. |
| `industry_type` | varchar(128) | no |  | Industry type. |
| `contact_name` | varchar(255) | no |  | Contact name. |
| `designation` | varchar(128) | no |  | Designation. |
| `work_email` | varchar(255) | no |  | Work email. |
| `admin_email` | varchar(255) | no |  | Admin email. |
| `tax_number` | varchar(64) | no |  | Tax number. |
| `billing_address` | text | no |  | Billing address. |
| `website_url` | varchar(512) | no |  | Website url. |
| `country` | varchar(128) | no |  | Country. |
| `company_size` | varchar(64) | no |  | Company size. |
| `mobile_country_code` | varchar(8) | no |  | Mobile country code. |
| `mobile_number` | varchar(32) | no |  | Mobile number. |
| `lifecycle_status` | varchar(32) | yes default `active` |  | Lifecycle status. |
| `converted_at` | timestamptz | yes default `now()` |  | Converted at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `business_type` | varchar(64) | no |  | Business type. |
| `support_portal_slug` | varchar(63) | no |  | Support portal slug. |
| `support_portal_enabled` | boolean | yes default `false` | `true`, `false` | Support portal enabled. |
| `support_portal_welcome` | text | no |  | Support portal welcome. |
| `id` | bigint | yes |  | Primary key. |
| `sip_domain_name` | varchar(255) | yes |  | Sip domain name. |
| `reseller_id` | bigint | no |  | Declared FK → `accounts.resellers.id`. |
| `source_lead_id` | bigint | no |  | Declared FK → `accounts.leads.id`. |

**Example row:** `company_name=Acme Retail, work_email=priya.sharma@example.com, lifecycle_status=active, converted_at=2026-09-20T10:00:00Z, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, id=1001`

---
## `accounts.organization_locations`

**Purpose:** Branch / office addresses under the tenant. Users can point at a location id.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | varchar(128) | yes |  | Primary key. |
| `label` | varchar(128) | no |  | Label. |
| `address` | text | no |  | Address. |
| `country` | varchar(128) | no |  | Country. |
| `tax_number` | varchar(64) | no |  | Tax number. |
| `contact_name` | varchar(255) | no |  | Contact name. |
| `designation` | varchar(128) | no |  | Designation. |
| `work_email` | varchar(255) | no |  | Work email. |
| `is_primary` | boolean | yes default `false` | `true`, `false` | Is primary. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `inactivated_at` | timestamptz | no |  | Inactivated at. |
| `inactivated_by` | varchar(255) | no |  | Inactivated by. |
| `inactivation_reason` | text | no |  | Inactivation reason. |
| `scheduled_drop_at` | timestamptz | no |  | Scheduled drop at. |
| `scheduled_drop_by` | varchar(255) | no |  | Scheduled drop by. |
| `scheduled_drop_reason` | text | no |  | Scheduled drop reason. |
| `city` | varchar(128) | no |  | City. |
| `timezone` | varchar(64) | no |  | Timezone. |
| `industry_type` | varchar(128) | no |  | Industry type. |
| `mobile_country_code` | varchar(8) | no |  | Mobile country code. |
| `mobile_number` | varchar(32) | no |  | Mobile number. |
| `secondary_mobile_country_code` | varchar(8) | no |  | Secondary mobile country code. |
| `secondary_mobile_number` | varchar(32) | no |  | Secondary mobile number. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `scheduled_drop_request_id` | bigint | no |  | Scheduled drop request id. |

**Example row:** `id=1001, label=Resolved, work_email=priya.sharma@example.com, is_primary=false, status=active, inactivated_at=2026-09-20T10:00:00Z, organization_id=1000`

---
## `accounts.setup_users`

**Purpose:** People who log in: agents, supervisors, admins. Source of agent identity before publish.

**Keys:** PK `id`. Declared FK `business_hours_id` → `accounts.setup_business_hours.id`; `organization_id` → `accounts.organizations.id`; `team_id` → `accounts.setup_teams.id`. Logical `location_id` → `accounts.organization_locations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `employee_id` | varchar(64) | no |  | Employee id. |
| `first_name` | varchar(128) | yes |  | First name. |
| `last_name` | varchar(128) | yes |  | Last name. |
| `work_email` | varchar(255) | yes |  | Work email. |
| `mobile_number` | varchar(32) | no |  | Mobile number. |
| `primary_language` | varchar(64) | no |  | Primary language. |
| `secondary_language` | varchar(64) | no |  | Secondary language. |
| `location_id` | varchar(128) | no |  | Logical ref → `accounts.organization_locations.id` (no Postgres FK). |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `shift_types` | jsonb | no |  | Shift types. |
| `password_hash` | text | no |  | Password hash. |
| `invite_status` | varchar(32) | no |  | Invite status. |
| `password_set_at` | timestamptz | no |  | Password set at. |
| `invited_at` | timestamptz | no |  | Invited at. |
| `skills` | jsonb | yes default `[]` |  | Skills. |
| `city` | varchar(128) | no |  | City. |
| `state` | varchar(128) | no |  | Workflow state of this offer, transfer, or operation. |
| `country` | varchar(128) | no |  | Country. |
| `business_hours_id` | bigint | no |  | Declared FK → `accounts.setup_business_hours.id`. |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `team_id` | bigint | no |  | Declared FK → `accounts.setup_teams.id`. |
| `ext` | integer | no |  | Ext. |
| `sip_login_id` | varchar(32) | no |  | Sip login id. |
| `sip_password` | varchar(32) | no |  | Sip password. |

**Example row:** `first_name=Priya, last_name=Sharma, work_email=priya.sharma@example.com, status=active, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000`

---
## `accounts.setup_teams`

**Purpose:** Teams that own queues and group users.

**Keys:** PK `id`. Declared FK `business_hours_id` → `accounts.setup_business_hours.id`; `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `description` | text | no |  | Longer explanation. |
| `available_products` | jsonb | yes default `[]` |  | Available products. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `member_ids` | jsonb | no |  | Member ids. |
| `business_hours_id` | bigint | no |  | Declared FK → `accounts.setup_business_hours.id`. |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |

**Example row:** `name=Billing, available_products={}, status=active, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, member_ids={}, id=1001, organization_id=1000`

---
## `accounts.setup_roles`

**Purpose:** Named permission sets (view/create/edit/delete/export/approve) per product.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`. Logical `product_id` → `platform product id (string), not inventory.products`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `description` | text | no |  | Longer explanation. |
| `accessible_products` | jsonb | yes default `[]` |  | Accessible products. |
| `module_permission` | varchar(128) | no |  | Module permission. |
| `can_view` | boolean | yes default `true` | `true`, `false` | Can view. |
| `can_create` | boolean | yes default `false` | `true`, `false` | Can create. |
| `can_edit` | boolean | yes default `false` | `true`, `false` | Can edit. |
| `can_delete` | boolean | yes default `false` | `true`, `false` | Can delete. |
| `can_export` | boolean | yes default `false` | `true`, `false` | Can export. |
| `can_approve` | boolean | yes default `false` | `true`, `false` | Can approve. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `product_id` | varchar(128) | no |  | Logical ref → `platform product id (string), not inventory.products` (no Postgres FK). |
| `module_permissions` | jsonb | no |  | Module permissions. |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |

**Example row:** `name=Billing, accessible_products={}, can_view=true, can_create=false, can_edit=false, can_delete=false, id=1001, organization_id=1000`

---
## `accounts.setup_user_product_access`

**Purpose:** Which user has which role on which product (for example contact center).

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`; `role_id` → `accounts.setup_roles.id`; `user_id` → `accounts.setup_users.id`. Logical `product_id` → `platform product id (string), not inventory.products`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `product_id` | varchar(128) | yes |  | Logical ref → `platform product id (string), not inventory.products` (no Postgres FK). |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `role_id` | bigint | yes |  | Declared FK → `accounts.setup_roles.id`. |
| `user_id` | bigint | yes |  | Declared FK → `accounts.setup_users.id`. |

**Example row:** `created_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000, role_id=1, user_id=1005`

---
## `accounts.setup_user_invite_tokens`

**Purpose:** One-time invite links so a new user can set a password.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`; `user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `token_hash` | varchar(128) | yes |  | Token hash. |
| `expires_at` | timestamptz | yes |  | When an unanswered offer expires. |
| `used_at` | timestamptz | no |  | Used at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `created_by` | bigint | no |  | Created by. |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `user_id` | bigint | yes |  | Declared FK → `accounts.setup_users.id`. |

**Example row:** `expires_at=2026-09-20T10:00:00Z, used_at=2026-09-20T10:00:00Z, created_at=2026-09-20T10:00:00Z, created_by=1, id=1001, organization_id=1000`

---
## `accounts.setup_business_hours`

**Purpose:** Open/close profile and timezone. Queues, teams, and users can follow one.

**Keys:** PK `id`. Declared FK `holiday_calendar_id` → `accounts.setup_holiday_calendars.id`; `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `description` | text | no |  | Longer explanation. |
| `timezone` | varchar(64) | no |  | Timezone. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `open_time` | time | no |  | Open time. |
| `close_time` | time | no |  | Close time. |
| `working_days` | jsonb | no |  | Working days. |
| `timing_mode` | varchar(16) | yes default `same` |  | Timing mode. |
| `day_timings` | jsonb | yes default `{}` |  | Day timings. |
| `holiday_calendar_id` | bigint | no |  | Declared FK → `accounts.setup_holiday_calendars.id`. |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |

**Example row:** `name=Billing, status=active, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, open_time=2026-09-20T10:00:00Z, close_time=2026-09-20T10:00:00Z, id=1001, organization_id=1000`

---
## `accounts.setup_business_hour_shifts`

**Purpose:** Per-day shift windows inside a business-hours profile.

**Keys:** PK `id`. Declared FK `business_hours_id` → `accounts.setup_business_hours.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `shift_type` | varchar(32) | yes default `Regular` |  | Shift type. |
| `day_of_week` | varchar(16) | yes |  | Day of week. |
| `end_day_of_week` | varchar(16) | no |  | End day of week. |
| `start_time` | time | yes |  | Start time. |
| `end_time` | time | yes |  | End time. |
| `crosses_midnight` | boolean | yes default `false` | `true`, `false` | Crosses midnight. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `break_start_time` | time | no |  | Break start time. |
| `break_end_time` | time | no |  | Break end time. |
| `break_start_time_2` | time | no |  | Break start time 2. |
| `break_end_time_2` | time | no |  | Break end time 2. |
| `business_hours_id` | bigint | yes |  | Declared FK → `accounts.setup_business_hours.id`. |
| `id` | bigint | yes |  | Primary key. |

**Example row:** `shift_type=Regular, start_time=2026-09-20T10:00:00Z, end_time=2026-09-20T10:00:00Z, crosses_midnight=false, created_at=2026-09-20T10:00:00Z, break_start_time=2026-09-20T10:00:00Z, id=1001`

---
## `accounts.setup_holiday_calendars`

**Purpose:** Named holiday calendar for a country, attached to business hours.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `country` | varchar(128) | no |  | Country. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |

**Example row:** `name=Billing, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000`

---
## `accounts.setup_holidays`

**Purpose:** One holiday date on a calendar.

**Keys:** PK `id`. Declared FK `calendar_id` → `accounts.setup_holiday_calendars.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `holiday_date` | date | yes |  | Holiday date. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `calendar_id` | bigint | yes |  | Declared FK → `accounts.setup_holiday_calendars.id`. |
| `id` | bigint | yes |  | Primary key. |

**Example row:** `name=Billing, holiday_date=2026-09-20T10:00:00Z, created_at=2026-09-20T10:00:00Z, calendar_id=1, id=1001`

---
## `accounts.setup_channel_configs`

**Purpose:** Parent channel row: web chat, email, social, or voice. Child configs hang off this id.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `channel_type` | varchar(32) | yes | web_chat, email, social, voice | Channel type. |
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `status` | varchar(32) | yes default `pending` | pending, active, inactive | Lifecycle or on/off state for this row. |
| `product_ids` | jsonb | yes default `[]` |  | Product ids. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |

**Example row:** `channel_type=web_chat, name=Billing, status=active, product_ids={}, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000`

---
## `accounts.setup_webchat_configs`

**Purpose:** Web chat widget: greeting, title, and which setup queue it routes to.

**Keys:** PK `channel_config_id`. Declared FK `channel_config_id` → `accounts.setup_channel_configs.id`; `routing_queue_id` → `accounts.setup_ccaas_queues.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `webchat_id` | varchar(64) | yes |  | Webchat id. |
| `title` | varchar(255) | yes |  | Short title. |
| `alias_title` | varchar(255) | yes |  | Alias title. |
| `description` | text | no |  | Longer explanation. |
| `greeting_message` | text | yes |  | Greeting message. |
| `trigger_message` | text | no |  | Trigger message. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `personalisation` | jsonb | yes default `{}` |  | Personalisation. |
| `channel_config_id` | bigint | yes |  | Which setup channel (widget, mailbox, or social app) this uses. Declared FK → `accounts.setup_channel_configs.id`. |
| `routing_queue_id` | bigint | no |  | Declared FK → `accounts.setup_ccaas_queues.id`. |

**Example row:** `created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, personalisation={}, channel_config_id=1, routing_queue_id=1`

---
## `accounts.setup_email_configs`

**Purpose:** Mailbox connection for a channel (SMTP/IMAP or OAuth). Secrets stay encrypted.

**Keys:** PK `id`. Declared FK `channel_config_id` → `accounts.setup_channel_configs.id`; `oauth_connection_id` → `accounts.mail_oauth_connections.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `provider_type` | varchar(32) | yes |  | Provider type. |
| `third_party_mode` | varchar(32) | no |  | Third party mode. |
| `sender_email` | varchar(255) | no |  | Sender email. |
| `sender_name` | varchar(255) | no |  | Sender name. |
| `reply_to` | varchar(255) | no |  | Reply to. |
| `domain` | varchar(255) | no |  | Domain. |
| `domain_verification_status` | varchar(32) | no |  | Domain verification status. |
| `domain_verification_token` | varchar(128) | no |  | Domain verification token. |
| `smtp_host` | varchar(255) | no |  | Smtp host. |
| `smtp_port` | integer | no |  | Smtp port. |
| `smtp_secure` | boolean | no | `true`, `false` | Smtp secure. |
| `imap_host` | varchar(255) | no |  | Imap host. |
| `imap_port` | integer | no |  | Imap port. |
| `imap_secure` | boolean | no | `true`, `false` | Imap secure. |
| `smtp_user_encrypted` | text | no |  | Smtp user encrypted. |
| `smtp_pass_encrypted` | text | no |  | Smtp pass encrypted. |
| `imap_user_encrypted` | text | no |  | Imap user encrypted. |
| `imap_pass_encrypted` | text | no |  | Imap pass encrypted. |
| `requested_local_part` | varchar(128) | no |  | Requested local part. |
| `hosted_domain` | varchar(255) | yes default `vectone.tech` |  | Hosted domain. |
| `provisioning_status` | varchar(32) | no |  | Provisioning status. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `oauth_provider` | varchar(32) | no |  | Oauth provider. |
| `ccaas_handler` | varchar(32) | no |  | Ccaas handler. |
| `is_bot` | boolean | yes default `false` | `true`, `false` | Is bot. |
| `channel_config_id` | bigint | yes |  | Which setup channel (widget, mailbox, or social app) this uses. Declared FK → `accounts.setup_channel_configs.id`. |
| `id` | bigint | yes |  | Primary key. |
| `oauth_connection_id` | bigint | no |  | Declared FK → `accounts.mail_oauth_connections.id`. |

**Example row:** `smtp_port=1, smtp_secure=true, imap_port=1, imap_secure=true, hosted_domain=vectone.tech, created_at=2026-09-20T10:00:00Z, id=1001`

---
## `accounts.setup_social_configs`

**Purpose:** WhatsApp, Instagram, and Facebook connector settings for a channel.

**Keys:** PK `channel_config_id`. Declared FK `channel_config_id` → `accounts.setup_channel_configs.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `provider` | varchar(32) | yes |  | Provider. |
| `bot_enabled` | boolean | yes default `false` | `true`, `false` | Bot enabled. |
| `usage_mode` | varchar(32) | yes default `inbox` |  | Usage mode. |
| `display_number` | varchar(64) | no |  | Display number. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `access_token_encrypted` | text | no |  | Access token encrypted. |
| `token_expires_at` | timestamptz | no |  | Token expires at. |
| `meta_user_id` | varchar(64) | no |  | Meta user id. |
| `meta_user_name` | varchar(255) | no |  | Meta user name. |
| `waba_id` | varchar(64) | no |  | Waba id. |
| `phone_number_id` | varchar(64) | no |  | Phone number id. |
| `page_id` | varchar(64) | no |  | Page id. |
| `ig_business_account_id` | varchar(64) | no |  | Ig business account id. |
| `meta_connected_at` | timestamptz | no |  | Meta connected at. |
| `meta_connection_status` | varchar(32) | yes default `disconnected` |  | Meta connection status. |
| `ig_graph_account_id` | varchar(64) | no |  | Ig graph account id. |
| `ig_login_user_id` | varchar(64) | no |  | Ig login user id. |
| `ig_login_scoped_id` | varchar(64) | no |  | Ig login scoped id. |
| `ig_webhook_account_id` | varchar(64) | no |  | Ig webhook account id. |
| `meta_auth_type` | varchar(32) | no |  | Meta auth type. |
| `meta_app_id` | varchar(64) | no |  | Meta app id. |
| `granted_scopes` | text | no |  | Granted scopes. |
| `channel_config_id` | bigint | yes |  | Which setup channel (widget, mailbox, or social app) this uses. Declared FK → `accounts.setup_channel_configs.id`. |

**Example row:** `bot_enabled=false, usage_mode=inbox, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, token_expires_at=2026-09-20T10:00:00Z, meta_connected_at=2026-09-20T10:00:00Z`

---
## `accounts.setup_crm_channel_agents`

**Purpose:** Which setup users are allowed on a CRM channel config.

**Keys:** PK `id`. Declared FK `channel_config_id` → `accounts.setup_channel_configs.id`; `user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `channel_config_id` | bigint | yes |  | Which setup channel (widget, mailbox, or social app) this uses. Declared FK → `accounts.setup_channel_configs.id`. |
| `id` | bigint | yes |  | Primary key. |
| `user_id` | bigint | yes |  | Declared FK → `accounts.setup_users.id`. |

**Example row:** `created_at=2026-09-20T10:00:00Z, channel_config_id=1, id=1001, user_id=1005`

---
## `accounts.setup_ccaas_queues`

**Purpose:** Queue authored in My Account. Published into ccass.queues for live routing.

**Keys:** PK `id`. Declared FK `business_hours_id` → `accounts.setup_business_hours.id`; `organization_id` → `accounts.organizations.id`; `team_id` → `accounts.setup_teams.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `description` | text | no |  | Longer explanation. |
| `shift_types` | jsonb | yes default `[]` |  | Shift types. |
| `skills` | jsonb | yes default `[]` |  | Skills. |
| `missed_callback_grace_minutes` | integer | no |  | Missed callback grace minutes. |
| `max_handle_minutes` | integer | yes default `10` |  | Max handle minutes. |
| `wrap_up_minutes` | integer | yes default `1` |  | Wrap up minutes. |
| `max_wait_mode` | varchar(16) | yes default `unlimited` |  | Max wait mode. |
| `max_wait_minutes` | integer | no |  | Max wait minutes. |
| `max_wait_callback` | boolean | yes default `false` | `true`, `false` | Max wait callback. |
| `max_wait_voicemail` | boolean | yes default `false` | `true`, `false` | Max wait voicemail. |
| `announcement_frequency_seconds` | integer | yes default `30` |  | Announcement frequency seconds. |
| `announcement_slot_id` | varchar(64) | yes default `queue_position` |  | Announcement slot id. |
| `announcement_audio_path` | varchar(512) | no |  | Announcement audio path. |
| `announcement_audio_name` | varchar(255) | no |  | Announcement audio name. |
| `business_hours_id` | bigint | no |  | Declared FK → `accounts.setup_business_hours.id`. |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `team_id` | bigint | yes |  | Declared FK → `accounts.setup_teams.id`. |

**Example row:** `name=Billing, status=active, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, shift_types={}, skills={}, id=1001, organization_id=1000`

---
## `accounts.setup_ccaas_queue_agents`

**Purpose:** Which users sit on a setup queue, and which channels they handle.

**Keys:** PK `id`. Declared FK `queue_id` → `accounts.setup_ccaas_queues.id`; `user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `handles_calls` | boolean | yes default `false` | `true`, `false` | Handles calls. |
| `handles_email` | boolean | yes default `false` | `true`, `false` | Handles email. |
| `handles_social` | boolean | yes default `false` | `true`, `false` | Handles social. |
| `handles_chat` | boolean | yes default `false` | `true`, `false` | Handles chat. |
| `chat_concurrency` | integer | yes default `1` |  | Chat concurrency. |
| `email_concurrency` | integer | yes default `1` |  | Email concurrency. |
| `social_concurrency` | integer | yes default `1` |  | Social concurrency. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `handles_whatsapp` | boolean | yes default `false` | `true`, `false` | Handles whatsapp. |
| `handles_instagram` | boolean | yes default `false` | `true`, `false` | Handles instagram. |
| `handles_facebook` | boolean | yes default `false` | `true`, `false` | Handles facebook. |
| `whatsapp_concurrency` | integer | yes default `1` |  | Whatsapp concurrency. |
| `instagram_concurrency` | integer | yes default `1` |  | Instagram concurrency. |
| `facebook_concurrency` | integer | yes default `1` |  | Facebook concurrency. |
| `call_type` | varchar(16) | yes default `both` |  | Call type. |
| `shift_type` | varchar(32) | yes default `Regular` |  | Shift type. |
| `handles_inbound` | boolean | yes default `false` | `true`, `false` | Handles inbound. |
| `handles_outbound` | boolean | yes default `false` | `true`, `false` | Handles outbound. |
| `handles_outbound_campaign` | boolean | yes default `false` | `true`, `false` | Handles outbound campaign. |
| `id` | bigint | yes |  | Primary key. |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `accounts.setup_ccaas_queues.id`. |
| `user_id` | bigint | yes |  | Declared FK → `accounts.setup_users.id`. |

**Example row:** `handles_calls=false, handles_email=false, handles_social=false, handles_chat=false, chat_concurrency=1, email_concurrency=1, id=1001, queue_id=401`

---
## `accounts.setup_ccaas_queue_prompt_slots`

**Purpose:** Voice prompt slots on a setup queue (greeting, hold, connecting audio).

**Keys:** PK `id`. Declared FK `queue_id` → `accounts.setup_ccaas_queues.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `accounts.setup_ccaas_queues.id`. |
| `slot_id` | varchar(64) | yes | connecting_audio, queue_greeting, queue_audio, hold_audio | Slot id. |
| `text` | text | no |  | Text. |
| `audio_path` | varchar(512) | no |  | Audio path. |
| `audio_name` | varchar(255) | no |  | Audio name. |
| `source` | varchar(16) | yes default `none` | none, tts, upload | Who or what created the row. |
| `status` | varchar(16) | yes default `pending` | pending, ready, failed | Lifecycle or on/off state for this row. |
| `error` | text | no |  | Error. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, queue_id=401, source=none, status=active, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z`

---
## `accounts.setup_queue_routing_profiles`

**Purpose:** Intents, keywords, and example phrases used to classify work onto a setup queue.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`; `queue_id` → `accounts.setup_ccaas_queues.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `description` | text | yes |  | Longer explanation. |
| `supported_intents` | jsonb | yes default `[]` |  | Supported intents. |
| `example_phrases` | jsonb | yes default `[]` |  | Example phrases. |
| `language_codes` | jsonb | yes default `[\"en\"]` |  | Language codes. |
| `skill_mapping` | jsonb | yes default `{}` |  | Skill mapping. |
| `classifier_version` | varchar(64) | yes default `v1` |  | Classifier version. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `accounts.setup_ccaas_queues.id`. |

**Example row:** `supported_intents={}, example_phrases={}, language_codes={}, skill_mapping={}, classifier_version=v1, created_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000`

---
## `accounts.routing_profile_types`

**Purpose:** Lookup of org routing styles: long wait, sticky, skill.

**Keys:** PK `id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | integer | yes | 1 long_wait, 2 sticky, 3 skill | Primary key. |
| `code` | varchar(32) | yes | long_wait, sticky, skill | Code. |
| `name` | varchar(128) | yes |  | Name shown in the UI. |
| `description` | text | yes |  | Longer explanation. |
| `sort_order` | integer | yes default `0` |  | Sort order. |

**Example row:** `id=1001, code=resolved, name=Billing, sort_order=0`

---
## `accounts.setup_organization_routing_profiles`

**Purpose:** The one routing style this organization uses, plus long-wait seconds when that style is selected.

**Keys:** PK `organization_id`. Declared FK `organization_id` → `accounts.organizations.id`; `routing_type_id` → `accounts.routing_profile_types.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `routing_type_id` | integer | yes |  | 1 long wait, 2 sticky, 3 skill. Declared FK → `accounts.routing_profile_types.id`. |
| `long_wait_seconds` | integer | no |  | Wait threshold used only when routing type is long wait. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `organization_id=1000, routing_type_id=1, long_wait_seconds=1, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z`

---
## `accounts.setup_organization_recording_settings`

**Purpose:** Whether voice calls are recorded, inbound/outbound, consent prompt, and whether agents may listen.

**Keys:** PK `organization_id`. Declared FK `organization_id` → `accounts.organizations.id`; `consent_prompt_id` → `accounts.setup_voice_prompt_profiles.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `recording_enabled` | boolean | yes default `false` | `true`, `false` | Master switch for voice recording. |
| `inbound_enabled` | boolean | yes default `true` | `true`, `false` | Record inbound calls when recording is on. |
| `outbound_enabled` | boolean | yes default `true` | `true`, `false` | Record outbound calls when recording is on. |
| `consent_notice_enabled` | boolean | yes default `false` | `true`, `false` | Play a prompt before recording. |
| `consent_prompt_id` | bigint | no |  | Declared FK → `accounts.setup_voice_prompt_profiles.id`. |
| `agent_access_enabled` | boolean | yes default `false` | `true`, `false` | Whether agents may open recordings. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `organization_id=1000, recording_enabled=false, inbound_enabled=true, outbound_enabled=true, consent_notice_enabled=false, consent_prompt_id=1`

---
## `accounts.setup_voice_dids`

**Purpose:** Phone numbers (DIDs) and where they route: a setup queue or a user.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`; `prompt_profile_id` → `accounts.setup_voice_prompt_profiles.id`; `routing_queue_id` → `accounts.setup_ccaas_queues.id`; `routing_user_id` → `accounts.setup_users.id`. Logical `product_id` → `platform product id (string), not inventory.products`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `phone_number` | varchar(64) | yes |  | Phone number. |
| `product_id` | varchar(64) | yes |  | Logical ref → `platform product id (string), not inventory.products` (no Postgres FK). |
| `routing_type` | varchar(16) | no |  | Routing type. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `prompt_profile_id` | bigint | no |  | Declared FK → `accounts.setup_voice_prompt_profiles.id`. |
| `routing_queue_id` | bigint | no |  | Declared FK → `accounts.setup_ccaas_queues.id`. |
| `routing_user_id` | bigint | no |  | Declared FK → `accounts.setup_users.id`. |

**Example row:** `status=active, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000, prompt_profile_id=1`

---
## `accounts.setup_voice_prompt_profiles`

**Purpose:** Named voice prompt (IVR slots) played on a DID or as a recording consent notice.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `description` | text | no |  | Longer explanation. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `slots` | jsonb | yes default `[]` |  | Slots. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |

**Example row:** `name=Billing, status=active, slots={}, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000`

---
## `accounts.setup_knowledge_documents`

**Purpose:** Files uploaded for bot and copilot knowledge retrieval.

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`. Logical `product_id` → `platform product id (string), not inventory.products`; `uploaded_by` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `category` | varchar(64) | yes |  | Category. |
| `file_name` | varchar(512) | yes |  | Original file name. |
| `file_type` | varchar(32) | yes |  | File type. |
| `file_size_bytes` | bigint | yes |  | File size bytes. |
| `storage_path` | text | yes |  | Storage path. |
| `all_branches` | boolean | yes default `false` | `true`, `false` | All branches. |
| `assigned_branch_ids` | jsonb | yes default `[]` |  | Assigned branch ids. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `product_id` | varchar(64) | no |  | Logical ref → `platform product id (string), not inventory.products` (no Postgres FK). |
| `ccaas_audience` | varchar(32) | no |  | Ccaas audience. |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |
| `uploaded_by` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |

**Example row:** `file_size_bytes=1, all_branches=false, assigned_branch_ids={}, created_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000`

---
## `accounts.setup_knowledge_org_profiles`

**Purpose:** Org-level knowledge profile (product and business JSON) for RAG.

**Keys:** PK `organization_id`. Declared FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `product` | jsonb | no |  | Product. |
| `business` | jsonb | no |  | Business. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |

**Example row:** `product={}, business={}, updated_at=2026-09-20T10:00:00Z, organization_id=1000`

---
## `accounts.setup_app_connections`

**Purpose:** External app connection configured in setup (OAuth-style integration metadata).

**Keys:** PK `id`. Declared FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `app_key` | varchar(64) | yes |  | App key. |
| `provider` | varchar(32) | yes |  | Provider. |
| `status` | varchar(32) | yes default `disconnected` |  | Lifecycle or on/off state for this row. |
| `account_email` | varchar(255) | no |  | Account email. |
| `account_name` | varchar(255) | no |  | Account name. |
| `external_account_id` | varchar(255) | no |  | External account id. |
| `scopes` | text | no |  | Scopes. |
| `access_token_encrypted` | text | no |  | Access token encrypted. |
| `refresh_token_encrypted` | text | no |  | Refresh token encrypted. |
| `token_expires_at` | timestamptz | no |  | Token expires at. |
| `metadata` | jsonb | yes default `{}` |  | Extra JSON the product can extend without a migration. |
| `connected_at` | timestamptz | no |  | Connected at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Declared FK → `accounts.organizations.id`. |

**Example row:** `status=active, token_expires_at=2026-09-20T10:00:00Z, metadata={}, connected_at=2026-09-20T10:00:00Z, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z, id=1001, organization_id=1000`

---

# Schema `ccass` (live Contact Center)

65 tables. This is the operational database.

---

## `ccass.agents`

**Purpose:** Live agent identity published from setup_users. Routing and workspace use this id, not the login user id.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `setup_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `display_name` | varchar(255) | yes |  | Display name. |
| `email` | varchar(255) | no |  | Email. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `setup_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |

**Example row:** `id=1001, organization_id=1000, display_name=Priya Sharma, email=priya.sharma@example.com, status=active, created_at=2026-09-20T10:00:00Z`

---
## `ccass.agent_presence`

**Purpose:** Current presence of one agent (ready, busy, not ready, and so on). Routing reads this.

**Keys:** PK `id`. Declared FK `agent_id` → `ccass.agents.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `agent_id` | bigint | yes |  | The live agent. Declared FK → `ccass.agents.id`. |
| `status` | varchar(32) | yes default `offline` | offline, ready, not_ready, break, away, busy, after_contact_work (legacy copy of presence_state) | Lifecycle or on/off state for this row. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `presence_state` | varchar(32) | yes default `offline` | offline, ready, not_ready, break, away, busy, after_contact_work | What routing should treat the agent as right now. |
| `reason_code` | varchar(64) | no |  | Code from the presence or missed-contact catalog. |
| `heartbeat_at` | timestamptz | no |  | Last heartbeat. A stale heartbeat means the agent is gone. |
| `lease_expires_at` | timestamptz | no |  | When the presence lease expires if heartbeats stop. |
| `version` | integer | yes default `1` |  | Optimistic lock. Writers increment it so two updates do not overwrite each other. |
| `source` | varchar(32) | yes default `system` | system, agent, supervisor | Who or what created the row. |

**Example row:** `id=1001, organization_id=1000, agent_id=301, status=active, updated_at=2026-09-20T10:00:00Z, presence_state=ready`

---
## `ccass.agent_presence_history`

**Purpose:** Append-only log of presence changes for attendance and audit.

**Keys:** PK `id`. Declared FK `agent_id` → `ccass.agents.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `agent_id` | bigint | yes |  | The live agent. Declared FK → `ccass.agents.id`. |
| `previous_state` | varchar(32) | no |  | Previous state. |
| `new_state` | varchar(32) | yes |  | New state. |
| `reason_code` | varchar(64) | no |  | Code from the presence or missed-contact catalog. |
| `source` | varchar(32) | yes default `agent` | agent, system, supervisor | Who or what created the row. |
| `started_at` | timestamptz | yes default `now()` |  | Started at. |
| `ended_at` | timestamptz | no |  | When the session ended. |

**Example row:** `id=1001, organization_id=1000, agent_id=301, source=agent, started_at=2026-09-20T10:00:00Z, ended_at=2026-09-20T10:00:00Z`

---
## `ccass.presence_reason_codes`

**Purpose:** Org catalog of break/training/not-ready reason codes.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `code` | varchar(64) | yes |  | Code. |
| `label` | varchar(255) | yes |  | Label. |
| `presence_state` | varchar(32) | yes default `not_ready` |  | What routing should treat the agent as right now. |
| `requires_note` | boolean | yes default `false` | `true`, `false` | Requires note. |
| `is_active` | boolean | yes default `true` | `true`, `false` | Inactive rows stay in the database but drop out of pickers. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, code=resolved, label=Resolved, presence_state=ready, requires_note=false`

---
## `ccass.agent_capacity`

**Purpose:** How many conversations an agent may hold on one channel, and how many are active or reserved.

**Keys:** PK `id`. Declared FK `agent_id` → `ccass.agents.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `agent_id` | bigint | yes |  | The live agent. Declared FK → `ccass.agents.id`. |
| `channel` | varchar(32) | yes default `chat` |  | Which channel this row is about. |
| `max_concurrency` | integer | yes default `1` |  | How many conversations this agent may hold on this channel. |
| `reserved_count` | integer | yes default `0` |  | Offers ringing that are not accepted yet. |
| `active_count` | integer | yes default `0` |  | Conversations currently connected. |
| `version` | integer | yes default `1` |  | Optimistic lock. Writers increment it so two updates do not overwrite each other. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, agent_id=301, channel=webchat, max_concurrency=1, reserved_count=0`

---
## `ccass.skills`

**Purpose:** Skill catalog for skill-based routing.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `key` | varchar(128) | yes |  | Key. |
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `description` | text | no |  | Longer explanation. |
| `is_active` | boolean | yes default `true` | `true`, `false` | Inactive rows stay in the database but drop out of pickers. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, name=Billing, is_active=true, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z`

---
## `ccass.agent_skills`

**Purpose:** Skills an agent has, with proficiency.

**Keys:** PK `id`. Declared FK `agent_id` → `ccass.agents.id`; `skill_id` → `ccass.skills.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `agent_id` | bigint | yes |  | The live agent. Declared FK → `ccass.agents.id`. |
| `skill_id` | bigint | yes |  | Declared FK → `ccass.skills.id`. |
| `proficiency` | integer | yes default `1` |  | How strong the agent is at this skill (integer). |
| `priority` | integer | yes default `0` |  | Higher means more urgent where the product sorts by it. |
| `verified_at` | timestamptz | no |  | Verified at. |
| `expires_at` | timestamptz | no |  | When an unanswered offer expires. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, agent_id=301, skill_id=1, proficiency=1, priority=0`

---
## `ccass.agent_missed_contacts`

**Purpose:** A contact the agent did not take (timeout, reject, no agent). Drives the missed inbox and callbacks.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `assigned_user_id` → `accounts.setup_users.id`; `contact_id` → `cdp.customer_profile.cdp_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `agent_id` | bigint | no |  | The live agent. |
| `assigned_user_id` | bigint | no |  | Login user for that agent (accounts.setup_users). Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. |
| `assignment_id` | bigint | no |  | Assignment id. |
| `contact_id` | text | no |  | The customer. Text equal to cdp.customer_profile.cdp_id (no cross-schema foreign key). Logical ref → `cdp.customer_profile.cdp_id` (no Postgres FK). |
| `queue_id` | bigint | no |  | The queue. |
| `channel` | varchar(32) | yes |  | Which channel this row is about. |
| `reason` | varchar(32) | yes default `offer_timeout` | offer_timeout, manual_reject, no_agent_available, routing_exhausted, handoff_failure | Why this state happened. |
| `customer_name` | text | yes |  | Name captured at the time of the miss, so the inbox still shows it if the profile changes. |
| `customer_email` | text | no |  | Customer email. |
| `customer_phone` | text | no |  | Customer phone. |
| `offered_at` | timestamptz | no |  | When the offer was shown. |
| `missed_at` | timestamptz | yes default `now()` |  | When the contact was missed. |
| `acknowledged_at` | timestamptz | no |  | When someone acknowledged the miss. |
| `metadata` | jsonb | yes default `{}` |  | Extra JSON the product can extend without a migration. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, agent_id=301, assigned_user_id=1005, conversation_id=9001, assignment_id=1, contact_id=9000000000000000123, queue_id=401`

---
## `ccass.missed_contact_reasons`

**Purpose:** Lookup of missed-contact reason codes and labels.

**Keys:** PK `id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | integer | yes |  | Primary key. |
| `code` | varchar(32) | yes |  | Code. |
| `name` | varchar(128) | yes |  | Name shown in the UI. |
| `description` | text | yes |  | Longer explanation. |
| `sort_order` | integer | yes default `0` |  | Sort order. |

**Example row:** `id=1001, code=resolved, name=Billing, sort_order=0`

---
## `ccass.onboarding_dashboard_codes`

**Purpose:** Short-lived hashed code that sends a new user from set-password into the Contact Center dashboard.

**Keys:** PK `id`. Logical `setup_user_id` → `accounts.setup_users.id`; `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `code_hash` | varchar(64) | yes |  | Code hash. |
| `setup_user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `email` | varchar(255) | yes |  | Email. |
| `expires_at` | timestamptz | yes |  | When an unanswered offer expires. |
| `consumed_at` | timestamptz | no |  | Consumed at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, setup_user_id=1005, organization_id=1000, email=priya.sharma@example.com, expires_at=2026-09-20T10:00:00Z, consumed_at=2026-09-20T10:00:00Z`

---
## `ccass.queues`

**Purpose:** Live queue snapshot published from setup_ccaas_queues. Conversations are offered from here.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `setup_queue_id` → `accounts.setup_ccaas_queues.id`; `team_id` → `accounts.setup_teams.id`; `business_hours_id` → `accounts.setup_business_hours.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `setup_queue_id` | bigint | yes |  | Logical ref → `accounts.setup_ccaas_queues.id` (no Postgres FK). |
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `team_id` | bigint | yes |  | Logical ref → `accounts.setup_teams.id` (no Postgres FK). |
| `business_hours_id` | bigint | no |  | Logical ref → `accounts.setup_business_hours.id` (no Postgres FK). |
| `shift_types` | jsonb | yes default `[]` |  | Shift types. |
| `skills` | jsonb | yes default `[]` |  | Skills. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `published_at` | timestamptz | yes default `now()` |  | Published at. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, setup_queue_id=1, name=Billing, team_id=21, business_hours_id=1, status=active`

---
## `ccass.queue_members`

**Purpose:** Which agents belong to a live queue, and their per-channel concurrency.

**Keys:** PK `id`. Declared FK `agent_id` → `ccass.agents.id`; `queue_id` → `ccass.queues.id`. Logical `setup_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `ccass.queues.id`. |
| `agent_id` | bigint | yes |  | The live agent. Declared FK → `ccass.agents.id`. |
| `setup_user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `shift_type` | varchar(32) | yes default `Regular` |  | Shift type. |
| `handles_calls` | boolean | yes default `false` | `true`, `false` | Handles calls. |
| `handles_email` | boolean | yes default `false` | `true`, `false` | Handles email. |
| `handles_social` | boolean | yes default `false` | `true`, `false` | Handles social. |
| `handles_chat` | boolean | yes default `false` | `true`, `false` | Handles chat. |
| `chat_concurrency` | integer | yes default `1` |  | Chat concurrency. |
| `email_concurrency` | integer | yes default `1` |  | Email concurrency. |
| `social_concurrency` | integer | yes default `1` |  | Social concurrency. |
| `handles_whatsapp` | boolean | yes default `false` | `true`, `false` | Handles whatsapp. |
| `handles_instagram` | boolean | yes default `false` | `true`, `false` | Handles instagram. |
| `handles_facebook` | boolean | yes default `false` | `true`, `false` | Handles facebook. |
| `whatsapp_concurrency` | integer | yes default `1` |  | Whatsapp concurrency. |
| `instagram_concurrency` | integer | yes default `1` |  | Instagram concurrency. |
| `facebook_concurrency` | integer | yes default `1` |  | Facebook concurrency. |
| `call_type` | varchar(16) | yes default `both` | inbound, outbound, both | Call type. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, queue_id=401, agent_id=301, setup_user_id=1005, shift_type=Regular, handles_calls=false`

---
## `ccass.queue_skills`

**Purpose:** Skills a queue requires or prefers.

**Keys:** PK `id`. Declared FK `queue_id` → `ccass.queues.id`; `skill_id` → `ccass.skills.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `ccass.queues.id`. |
| `skill_id` | bigint | yes |  | Declared FK → `ccass.skills.id`. |
| `requirement_type` | varchar(16) | yes default `required` | required, preferred | Whether the queue must have this skill or only prefers it. |
| `min_proficiency` | integer | yes default `1` |  | Minimum proficiency to be eligible. |
| `weight` | integer | yes default `1` |  | How much this skill matters when scoring agents. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, queue_id=401, skill_id=1, requirement_type=required, min_proficiency=1`

---
## `ccass.queue_routing_profiles`

**Purpose:** Published classifier metadata (intents, keywords) for a live queue.

**Keys:** PK `id`. Declared FK `queue_id` → `ccass.queues.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `ccass.queues.id`. |
| `description` | text | yes |  | Longer explanation. |
| `supported_intents` | jsonb | yes default `[]` |  | Supported intents. |
| `example_phrases` | jsonb | yes default `[]` |  | Example phrases. |
| `keywords` | jsonb | yes default `[]` |  | Keywords. |
| `language_codes` | jsonb | yes default `[\"en\"]` |  | Language codes. |
| `skill_mapping` | jsonb | yes default `{}` |  | Skill mapping. |
| `classifier_version` | varchar(32) | yes default `v1` |  | Classifier version. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, queue_id=401, supported_intents={}, example_phrases={}, keywords={}`

---
## `ccass.routing_policies`

**Purpose:** How a queue offers work: strategy, timeout, overflow queue, after-contact work, email SLAs.

**Keys:** PK `id`. Declared FK `overflow_queue_id` → `ccass.queues.id`; `queue_id` → `ccass.queues.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `ccass.queues.id`. |
| `strategy` | varchar(32) | yes default `skill_round_robin` | skill_round_robin, longest_idle, round_robin (application keys; default skill_round_robin) | How the queue picks the next agent. |
| `priority` | integer | yes default `0` |  | Higher means more urgent where the product sorts by it. |
| `offer_timeout_seconds` | integer | yes default `20` |  | How long an offer rings before it is a miss. |
| `max_attempts` | integer | yes default `3` |  | Max attempts. |
| `overflow_queue_id` | bigint | no |  | Queue to try after this queue cannot place the contact. Declared FK → `ccass.queues.id`. |
| `after_contact_work_seconds` | integer | yes default `60` |  | Wrap-up time after the contact ends. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `email_offer_timeout_seconds` | integer | yes default `3600` |  | Email offer timeout seconds. |
| `email_first_response_sla_seconds` | integer | yes default `14400` |  | Email first response sla seconds. |
| `email_resolution_sla_seconds` | integer | yes default `86400` |  | Email resolution sla seconds. |
| `email_after_contact_work_seconds` | integer | yes default `0` |  | Email after contact work seconds. |
| `missed_callback_grace_minutes` | integer | no |  | Missed callback grace minutes. |

**Example row:** `id=1001, organization_id=1000, queue_id=401, strategy=skill_round_robin, priority=0, offer_timeout_seconds=20`

---
## `ccass.routing_cursors`

**Purpose:** Round-robin pointer so the next offer does not always start at the same agent.

**Keys:** PK `id`. Declared FK `last_agent_id` → `ccass.agents.id`; `queue_id` → `ccass.queues.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `ccass.queues.id`. |
| `cursor_index` | integer | yes default `0` |  | Round-robin position. |
| `last_agent_id` | bigint | no |  | Last agent the cursor offered. Declared FK → `ccass.agents.id`. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, queue_id=401, cursor_index=0, last_agent_id=1, updated_at=2026-09-20T10:00:00Z`

---
## `ccass.routing_attempts`

**Purpose:** One routing decision for a conversation: which queue and agent, and the outcome.

**Keys:** PK `id`. Declared FK `agent_id` → `ccass.agents.id`; `queue_id` → `ccass.queues.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. |
| `queue_id` | bigint | yes |  | The queue. Declared FK → `ccass.queues.id`. |
| `agent_id` | bigint | no |  | The live agent. Declared FK → `ccass.agents.id`. |
| `attempt_number` | integer | yes default `1` |  | Which try this is for the same conversation. |
| `outcome` | varchar(32) | yes default `pending` |  | What the attempt or routing decision did. |
| `candidate_scores` | jsonb | yes default `[]` |  | JSON scores of agents considered. |
| `skip_reasons` | jsonb | yes default `[]` |  | JSON reasons agents were skipped. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `completed_at` | timestamptz | no |  | When the task was finished. |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, queue_id=401, agent_id=301, attempt_number=1`

---
## `ccass.proactive_callback_attempts`

**Purpose:** Record that co-worker already tried to auto-create a callback for a missed contact.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `contact_id` → `cdp.customer_profile.cdp_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `missed_contact_id` | bigint | yes |  | Missed contact id. |
| `queue_id` | bigint | no |  | The queue. |
| `conversation_id` | bigint | no |  | The customer session this row belongs to. |
| `contact_id` | text | no |  | The customer. Text equal to cdp.customer_profile.cdp_id (no cross-schema foreign key). Logical ref → `cdp.customer_profile.cdp_id` (no Postgres FK). |
| `status` | varchar(32) | yes default `planned` |  | Lifecycle or on/off state for this row. |
| `task_id` | bigint | no |  | Task id. |
| `plan_json` | jsonb | yes default `{}` |  | Plan json. |
| `error_message` | text | no |  | Error message. |
| `acknowledged_at` | timestamptz | no |  | When someone acknowledged the miss. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, missed_contact_id=1, queue_id=401, conversation_id=9001, contact_id=9000000000000000123, status=active`

---
## `ccass.conversations`

**Purpose:** One customer session on one channel: bot, queue, agent, SLA clocks, and link to the CDP contact.

**Keys:** PK `id`. Declared FK `assigned_agent_id` → `ccass.agents.id`; `previous_conversation_id` → `ccass.conversations.id`; `queue_id` → `ccass.queues.id`. Logical `organization_id` → `accounts.organizations.id`; `contact_id` → `cdp.customer_profile.cdp_id`; `assigned_user_id` → `accounts.setup_users.id`; `mailbox_connection_id` → `accounts.mail_oauth_connections.id`; `channel_config_id` → `accounts.setup_channel_configs.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `channel` | varchar(32) | yes default `webchat` | webchat, email, whatsapp, instagram, facebook, voice | Which channel this row is about. |
| `external_thread_id` | varchar(128) | yes |  | Session id unique per org and channel. A new session gets a new id. |
| `webchat_id` | varchar(64) | no |  | Webchat id. |
| `visitor_id` | varchar(128) | no |  | Channel identity before a contact is resolved (visitor id, email, psid). |
| `contact_id` | text | no |  | The customer. Text equal to cdp.customer_profile.cdp_id (no cross-schema foreign key). Logical ref → `cdp.customer_profile.cdp_id` (no Postgres FK). |
| `profile_id` | bigint | no |  | Profile id. |
| `queue_id` | bigint | no |  | The queue. Declared FK → `ccass.queues.id`. |
| `assigned_agent_id` | bigint | no |  | Agent who currently owns the conversation. Declared FK → `ccass.agents.id`. |
| `assigned_user_id` | bigint | no |  | Login user for that agent (accounts.setup_users). Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `status` | varchar(32) | yes default `bot_active` | bot_active, queued, assigned, active, resolved, closed | Lifecycle or on/off state for this row. |
| `priority` | integer | yes default `0` |  | Higher means more urgent where the product sorts by it. |
| `subject` | varchar(512) | no |  | Email or conversation subject. |
| `handoff_reason` | varchar(128) | no |  | Why the bot sent the conversation to a queue. |
| `bot_active` | boolean | yes default `true` | `true`, `false` | True while the bot still owns the conversation. |
| `nlp_enabled` | boolean | yes default `true` | `true`, `false` | Whether NLP may run on this conversation. |
| `live_agent_enabled` | boolean | yes default `true` | `true`, `false` | Whether the bot may hand off to a person. |
| `version` | integer | yes default `1` |  | Optimistic lock. Writers increment it so two updates do not overwrite each other. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `queued_at` | timestamptz | no |  | When it entered a queue. |
| `assigned_at` | timestamptz | no |  | When an agent accepted it. |
| `first_response_at` | timestamptz | no |  | When the first response actually happened. |
| `resolved_at` | timestamptz | no |  | When it was resolved. |
| `closed_at` | timestamptz | no |  | When it was closed. |
| `lifecycle_state` | varchar(32) | yes default `bot` | bot, waiting, offered, connected, wrap_up, ended | Normalized state used by voice and the workspace. |
| `lifecycle_version` | integer | yes default `1` |  | Lifecycle version. |
| `ended_at` | timestamptz | no |  | When the session ended. |
| `end_reason` | varchar(128) | no |  | Why it ended. |
| `end_actor` | varchar(32) | no |  | Who ended it (customer, agent, system, bot). |
| `transferred_at` | timestamptz | no |  | Transferred at. |
| `disposition_code` | varchar(64) | no |  | Wrap-up code stored on the conversation after resolve. |
| `disposition_note` | text | no |  | Disposition note. |
| `resolution_code` | varchar(64) | no |  | Resolution code stored with wrap-up. |
| `resolution_summary` | text | no |  | Short text of how it was resolved. |
| `resolution_data` | jsonb | yes default `{}` |  | Resolution data. |
| `mailbox_connection_id` | bigint | no |  | Logical ref → `accounts.mail_oauth_connections.id` (no Postgres FK). |
| `automation_policy_version` | integer | no |  | Automation policy version. |
| `first_response_due_at` | timestamptz | no |  | SLA deadline for the first agent reply. |
| `resolution_due_at` | timestamptz | no |  | SLA deadline to resolve. |
| `first_agent_response_at` | timestamptz | no |  | When a human agent first replied (bot replies do not count). |
| `sla_status` | varchar(32) | yes default `not_started` | not_started, on_track, warning, breached, met, stopped | Whether the SLA clock is on track, warning, or breached. |
| `provider_thread_id` | varchar(128) | no |  | Provider thread (email chain, WhatsApp thread) that can span sessions. |
| `previous_conversation_id` | bigint | no |  | Earlier closed conversation in the same customer journey. Declared FK → `ccass.conversations.id`. |
| `channel_config_id` | bigint | no |  | Which setup channel (widget, mailbox, or social app) this uses. Logical ref → `accounts.setup_channel_configs.id` (no Postgres FK). |
| `event_sequence` | bigint | yes default `0` |  | Event sequence. |
| `visitor_session_token` | text | no |  | Visitor session token. |

**Example row:** `id=1001, organization_id=1000, channel=webchat, contact_id=9000000000000000123, profile_id=1, queue_id=401, status=active`

---
## `ccass.conversation_messages`

**Purpose:** Every inbound and outbound message on a conversation.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`; `reply_to_message_id` → `ccass.conversation_messages.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `external_id` | varchar(512) | no |  | Provider message id, used so retries do not insert twice. |
| `sender_type` | varchar(32) | yes | customer, agent, bot, system | Who sent the message. |
| `recipient_type` | varchar(32) | no |  | Recipient type. |
| `direction` | varchar(16) | yes default `inbound` | inbound, outbound | Customer started it (inbound) or the agent did (outbound). |
| `visibility` | varchar(16) | yes default `customer` | customer, internal, system | Whether the customer can see the message. |
| `body` | text | yes |  | The text the user reads. |
| `attachments` | jsonb | yes default `[]` |  | Attachments. |
| `reply_to_message_id` | bigint | no |  | Message this one replies to. Declared FK → `ccass.conversation_messages.id`. |
| `delivery_state` | varchar(32) | yes default `delivered` |  | Provider delivery state of the message. |
| `model_metadata` | jsonb | no |  | Model metadata. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `delivered_at` | timestamptz | no |  | Delivered at. |
| `message_type` | varchar(32) | yes default `text` |  | text, or a richer type such as voice or attachment. |
| `attachment_count` | integer | yes default `0` |  | Attachment count. |
| `sent_at` | timestamptz | no |  | Sent at. |
| `rfc_message_id` | varchar(998) | no |  | Rfc message id. |
| `in_reply_to` | varchar(998) | no |  | In reply to. |
| `references_header` | text | no |  | References header. |
| `provider_received_at` | timestamptz | no |  | Provider received at. |
| `provider_headers` | jsonb | yes default `{}` |  | Provider headers. |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, direction=inbound, visibility=customer, attachments={}`

---
## `ccass.conversation_message_attachments`

**Purpose:** Files attached to a conversation message.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`; `message_id` → `ccass.conversation_messages.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `message_id` | bigint | yes |  | Declared FK → `ccass.conversation_messages.id`. |
| `external_id` | varchar(512) | no |  | Provider message id, used so retries do not insert twice. |
| `storage_key` | text | yes |  | Object-storage path of the file. |
| `file_name` | varchar(512) | yes |  | Original file name. |
| `content_type` | varchar(255) | yes |  | MIME type. |
| `byte_size` | bigint | yes |  | File size in bytes. |
| `checksum_sha256` | varchar(64) | no |  | Hash so the same file can be detected. |
| `download_url` | text | no |  | Download url. |
| `status` | varchar(32) | yes default `available` | pending, available, blocked, expired | Lifecycle or on/off state for this row. |
| `metadata` | jsonb | yes default `{}` |  | Extra JSON the product can extend without a migration. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, message_id=1, byte_size=1, status=active`

---
## `ccass.conversation_participants`

**Purpose:** Who is on the conversation (customer, visitor, agent) by an identity string.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `participant_type` | varchar(32) | yes |  | Participant type. |
| `identity_ref` | varchar(128) | yes |  | Identity ref. |
| `joined_at` | timestamptz | yes default `now()` |  | Joined at. |
| `left_at` | timestamptz | no |  | Left at. |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, joined_at=2026-09-20T10:00:00Z, left_at=2026-09-20T10:00:00Z`

---
## `ccass.conversation_assignments`

**Purpose:** Offer to an agent: ringing, accepted, rejected, expired, or ended.

**Keys:** PK `id`. Declared FK `agent_id` → `ccass.agents.id`; `conversation_id` → `ccass.conversations.id`; `queue_id` → `ccass.queues.id`; `routing_attempt_id` → `ccass.routing_attempts.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `queue_id` | bigint | no |  | The queue. Declared FK → `ccass.queues.id`. |
| `agent_id` | bigint | no |  | The live agent. Declared FK → `ccass.agents.id`. |
| `routing_attempt_id` | bigint | no |  | Declared FK → `ccass.routing_attempts.id`. |
| `state` | varchar(32) | yes default `offered` | offered, accepted, rejected, expired, ended | Workflow state of this offer, transfer, or operation. |
| `reason` | varchar(128) | no |  | Why this state happened. |
| `offered_at` | timestamptz | yes default `now()` |  | When the offer was shown. |
| `accepted_at` | timestamptz | no |  | When it was accepted. |
| `rejected_at` | timestamptz | no |  | When it was rejected. |
| `expired_at` | timestamptz | no |  | When the offer timed out. |
| `ended_at` | timestamptz | no |  | When the session ended. |
| `expires_at` | timestamptz | no |  | When an unanswered offer expires. |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, queue_id=401, agent_id=301, routing_attempt_id=1`

---
## `ccass.conversation_transfers`

**Purpose:** Move a conversation to another queue or agent.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`; `from_agent_id` → `ccass.agents.id`; `accepted_agent_id` → `ccass.agents.id`; `from_queue_id` → `ccass.queues.id`; `offered_agent_id` → `ccass.agents.id`; `requested_agent_id` → `ccass.agents.id`; `routing_attempt_id` → `ccass.routing_attempts.id`; `to_queue_id` → `ccass.queues.id`. Logical `organization_id` → `accounts.organizations.id`; `from_user_id` → `accounts.setup_users.id`; `requested_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `from_queue_id` | bigint | no |  | Declared FK → `ccass.queues.id`. |
| `from_agent_id` | bigint | no |  | Declared FK → `ccass.agents.id`. |
| `from_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `to_queue_id` | bigint | yes |  | Declared FK → `ccass.queues.id`. |
| `requested_agent_id` | bigint | no |  | Declared FK → `ccass.agents.id`. |
| `offered_agent_id` | bigint | no |  | Declared FK → `ccass.agents.id`. |
| `accepted_agent_id` | bigint | no |  | Declared FK → `ccass.agents.id`. |
| `accepted_user_id` | bigint | no |  | Accepted user id. |
| `requested_by_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `state` | varchar(32) | yes default `requested` | requested, offered, accepted, completed, cancelled | Workflow state of this offer, transfer, or operation. |
| `notes` | text | no |  | Free-text note. |
| `disposition_code` | varchar(64) | no |  | Wrap-up code stored on the conversation after resolve. |
| `resolution_code` | varchar(64) | no |  | Resolution code stored with wrap-up. |
| `resolution_data` | jsonb | yes default `{}` |  | Resolution data. |
| `routing_attempt_id` | bigint | no |  | Declared FK → `ccass.routing_attempts.id`. |
| `requested_at` | timestamptz | yes default `now()` |  | Requested at. |
| `offered_at` | timestamptz | no |  | When the offer was shown. |
| `accepted_at` | timestamptz | no |  | When it was accepted. |
| `completed_at` | timestamptz | no |  | When the task was finished. |
| `rejected_at` | timestamptz | no |  | When it was rejected. |
| `expired_at` | timestamptz | no |  | When the offer timed out. |
| `cancelled_at` | timestamptz | no |  | Cancelled at. |
| `outcome_reason` | varchar(128) | no |  | Outcome reason. |
| `channel` | varchar(32) | no |  | Which channel this row is about. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, from_queue_id=1, from_agent_id=1, from_user_id=1, channel=webchat`

---
## `ccass.transfer_action_operations`

**Purpose:** Idempotent voice/ACD transfer command (consult, complete, cancel) and its result.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `requested_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `operation_id` | varchar(128) | yes |  | Operation id. |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. |
| `transfer_id` | bigint | yes |  | Transfer id. |
| `requested_by_user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `acd_session_id` | varchar(256) | yes |  | Acd session id. |
| `action` | integer | yes | 1 consult, 2 complete, 3 cancel, 4 merge, 5 hangup, 6 reject (smallint codes) | Action. |
| `state` | varchar(32) | yes default `pending` | pending, acknowledged, failed, timed_out | Workflow state of this offer, transfer, or operation. |
| `error_code` | varchar(128) | no |  | Error code. |
| `error_detail` | text | no |  | Error detail. |
| `evidence` | jsonb | yes default `{}` |  | Evidence. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `terminal_at` | timestamptz | no |  | Terminal at. |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, transfer_id=1, requested_by_user_id=1, action=1`

---
## `ccass.conversation_dispositions`

**Purpose:** Wrap-up code applied to a conversation, with optional note and resolution.

**Keys:** PK `id`. Declared FK `agent_id` → `ccass.agents.id`; `conversation_id` → `ccass.conversations.id`; `disposition_id` → `ccass.dispositions.id`; `transfer_id` → `ccass.conversation_transfers.id`. Logical `organization_id` → `accounts.organizations.id`; `applied_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `disposition_id` | bigint | yes |  | Declared FK → `ccass.dispositions.id`. |
| `agent_id` | bigint | no |  | The live agent. Declared FK → `ccass.agents.id`. |
| `note` | text | no |  | Note. |
| `applied_at` | timestamptz | yes default `now()` |  | Applied at. |
| `applied_by_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `source` | varchar(32) | yes default `agent` |  | Who or what created the row. |
| `resolution_code` | varchar(64) | no |  | Resolution code stored with wrap-up. |
| `resolution_data` | jsonb | yes default `{}` |  | Resolution data. |
| `is_final` | boolean | yes default `false` | `true`, `false` | Is final. |
| `transfer_id` | bigint | no |  | Declared FK → `ccass.conversation_transfers.id`. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, disposition_id=1, agent_id=301, applied_at=2026-09-20T10:00:00Z`

---
## `ccass.dispositions`

**Purpose:** Org catalog of wrap-up codes.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `code` | varchar(64) | yes |  | Code. |
| `label` | varchar(255) | yes |  | Label. |
| `requires_note` | boolean | yes default `false` | `true`, `false` | Requires note. |
| `is_active` | boolean | yes default `true` | `true`, `false` | Inactive rows stay in the database but drop out of pickers. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `description` | text | no |  | Longer explanation. |
| `category` | varchar(64) | yes default `general` |  | Category. |
| `outcome` | varchar(64) | no |  | What the attempt or routing decision did. |
| `requires_resolution` | boolean | yes default `false` | `true`, `false` | Requires resolution. |
| `sort_order` | integer | yes default `0` |  | Sort order. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, code=resolved, label=Resolved, requires_note=false, is_active=true`

---
## `ccass.conversation_notes`

**Purpose:** Internal work note an agent writes on a conversation.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`. Logical `organization_id` → `accounts.organizations.id`; `author_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `author_user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `title` | text | no |  | Short title. |
| `body` | text | yes |  | The text the user reads. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, author_user_id=1005, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z`

---
## `ccass.conversation_memory`

**Purpose:** Rolling summary and extracted facts the bot keeps for this conversation.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`; `latest_summarized_message_id` → `ccass.conversation_messages.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `rolling_summary` | text | no |  | Short memory the bot keeps as the chat grows. |
| `extracted_facts` | jsonb | yes default `[]` |  | JSON facts pulled from the conversation. |
| `latest_summarized_message_id` | bigint | no |  | Declared FK → `ccass.conversation_messages.id`. |
| `model_name` | varchar(128) | no |  | Model name. |
| `token_estimate` | integer | no |  | Token estimate. |
| `version` | integer | yes default `1` |  | Optimistic lock. Writers increment it so two updates do not overwrite each other. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, extracted_facts={}, latest_summarized_message_id=1, token_estimate=1`

---
## `ccass.conversation_sla_state`

**Purpose:** First-response and resolution due times, warnings, and breach for one conversation.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`; `sla_policy_id` → `ccass.sla_policies.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `sla_policy_id` | bigint | no |  | Declared FK → `ccass.sla_policies.id`. |
| `first_response_due_at` | timestamptz | no |  | SLA deadline for the first agent reply. |
| `resolution_due_at` | timestamptz | no |  | SLA deadline to resolve. |
| `first_response_warning_at` | timestamptz | no |  | First response warning at. |
| `resolution_warning_at` | timestamptz | no |  | Resolution warning at. |
| `breached_at` | timestamptz | no |  | Breached at. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, sla_policy_id=1, first_response_due_at=2026-09-20T10:00:00Z, resolution_due_at=2026-09-20T10:00:00Z`

---
## `ccass.sla_policies`

**Purpose:** SLA thresholds (seconds) the org defines. Conversation SLA state points at one of these.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `first_response_seconds` | integer | yes default `120` |  | First response seconds. |
| `resolution_seconds` | integer | yes default `3600` |  | Resolution seconds. |
| `warning_threshold_pct` | integer | yes default `80` |  | Warning threshold pct. |
| `business_hours_mode` | varchar(32) | yes default `queue` |  | Business hours mode. |
| `escalation_policy` | jsonb | yes default `{}` |  | Escalation policy. |
| `is_active` | boolean | yes default `true` | `true`, `false` | Inactive rows stay in the database but drop out of pickers. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, name=Billing, first_response_seconds=120, resolution_seconds=3600, warning_threshold_pct=80`

---
## `ccass.conversation_sentiment_turns`

**Purpose:** Customer and agent sentiment scored for one message.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. |
| `message_id` | bigint | yes |  | Message id. |
| `trigger_role` | varchar(16) | yes |  | Trigger role. |
| `customer_label` | varchar(32) | yes |  | Customer label. |
| `customer_score` | integer | yes |  | Customer score. |
| `agent_label` | varchar(32) | yes |  | Agent label. |
| `agent_score` | integer | yes |  | Agent score. |
| `confidence` | jsonb | yes default `{}` |  | Model confidence, 0 to 1. |
| `rationale` | jsonb | yes default `{}` |  | Rationale. |
| `signals` | jsonb | yes default `{}` |  | Signals. |
| `model_name` | varchar(128) | no |  | Model name. |
| `trace_id` | varchar(128) | no |  | Trace id. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, message_id=1, customer_score=1, agent_score=1`

---
## `ccass.webchat_sessions`

**Purpose:** Browser session for a web chat conversation (page URL, visitor, connection).

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `webchat_id` | varchar(64) | yes |  | Webchat id. |
| `visitor_id` | varchar(128) | yes |  | Channel identity before a contact is resolved (visitor id, email, psid). |
| `token_hash` | varchar(128) | no |  | Token hash. |
| `page_origin` | varchar(512) | no |  | Page origin. |
| `page_url` | text | no |  | Page url. |
| `consent` | jsonb | no |  | Consent. |
| `prechat_answers` | jsonb | no |  | Prechat answers. |
| `connection_state` | varchar(32) | yes default `connected` |  | Connection state. |
| `expires_at` | timestamptz | no |  | When an unanswered offer expires. |
| `connected_at` | timestamptz | yes default `now()` |  | Connected at. |
| `disconnected_at` | timestamptz | no |  | Disconnected at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `ended_at` | timestamptz | no |  | When the session ended. |
| `end_reason` | varchar(128) | no |  | Why it ended. |
| `ended_by` | varchar(32) | no |  | Ended by. |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, consent={}, prechat_answers={}, connection_state=connected`

---
## `ccass.message_receipts`

**Purpose:** Sent, delivered, and read timestamps for a message.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`; `message_id` → `ccass.conversation_messages.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `message_id` | bigint | yes |  | Declared FK → `ccass.conversation_messages.id`. |
| `recipient_type` | varchar(32) | yes |  | Recipient type. |
| `recipient_ref` | varchar(128) | yes |  | Recipient ref. |
| `status` | varchar(16) | yes default `sent` | sent, delivered, read | Lifecycle or on/off state for this row. |
| `sent_at` | timestamptz | no |  | Sent at. |
| `delivered_at` | timestamptz | no |  | Delivered at. |
| `read_at` | timestamptz | no |  | Read at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, message_id=1, status=active, sent_at=2026-09-20T10:00:00Z`

---
## `ccass.message_delivery_attempts`

**Purpose:** One try to deliver an outbound message to a provider.

**Keys:** PK `id`. Declared FK `message_id` → `ccass.conversation_messages.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `message_id` | bigint | yes |  | Declared FK → `ccass.conversation_messages.id`. |
| `destination` | varchar(64) | yes |  | Destination. |
| `attempt_number` | integer | yes default `1` |  | Which try this is for the same conversation. |
| `status` | varchar(32) | yes default `pending` |  | Lifecycle or on/off state for this row. |
| `provider_response` | jsonb | no |  | Provider response. |
| `error_message` | text | no |  | Error message. |
| `attempted_at` | timestamptz | yes default `now()` |  | Attempted at. |
| `delivered_at` | timestamptz | no |  | Delivered at. |

**Example row:** `id=1001, organization_id=1000, message_id=1, attempt_number=1, status=active, provider_response={}`

---
## `ccass.nlp_skills`

**Purpose:** Skill registered for the bot or copilot (key, name, draft/published state).

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `owner_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `skill_key` | varchar(128) | yes |  | Stable skill id string. |
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `description` | text | no |  | Longer explanation. |
| `skill_type` | varchar(32) | yes |  | Skill type. |
| `owner_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `state` | varchar(32) | yes default `draft` | draft, published, archived | Workflow state of this offer, transfer, or operation. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, name=Billing, owner_user_id=1, state=draft, created_at=2026-09-20T10:00:00Z`

---
## `ccass.nlp_skill_versions`

**Purpose:** Immutable version of a skill: prompt, schemas, and policies.

**Keys:** PK `id`. Declared FK `skill_id` → `ccass.nlp_skills.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `skill_id` | bigint | yes |  | Declared FK → `ccass.nlp_skills.id`. |
| `version_number` | integer | yes |  | Version number. |
| `prompt_template` | text | yes |  | Prompt text for this skill version. |
| `input_schema` | jsonb | yes default `{}` |  | Input schema. |
| `output_schema` | jsonb | yes default `{}` |  | Output schema. |
| `model_policy` | jsonb | yes default `{}` |  | Model policy. |
| `context_policy` | jsonb | yes default `{}` |  | Context policy. |
| `safety_policy` | jsonb | yes default `{}` |  | Safety policy. |
| `checksum` | varchar(128) | yes |  | Checksum. |
| `state` | varchar(32) | yes default `draft` | draft, published, archived | Workflow state of this offer, transfer, or operation. |
| `published_at` | timestamptz | no |  | Published at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, skill_id=1, version_number=1, input_schema={}, output_schema={}`

---
## `ccass.nlp_skill_bindings`

**Purpose:** Which skill version is active for a channel, surface, or role.

**Keys:** PK `id`. Declared FK `skill_version_id` → `ccass.nlp_skill_versions.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `skill_version_id` | bigint | yes |  | Declared FK → `ccass.nlp_skill_versions.id`. |
| `role` | varchar(32) | no |  | Role. |
| `surface` | varchar(64) | no |  | Surface. |
| `channel` | varchar(32) | no |  | Which channel this row is about. |
| `priority` | integer | yes default `0` |  | Higher means more urgent where the product sorts by it. |
| `effective_from` | timestamptz | yes default `now()` |  | Effective from. |
| `effective_to` | timestamptz | no |  | Effective to. |
| `enabled` | boolean | yes default `true` | `true`, `false` | Enabled. |
| `overrides` | jsonb | yes default `{}` |  | Overrides. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, skill_version_id=1, channel=webchat, priority=0, effective_from=2026-09-20T10:00:00Z`

---
## `ccass.nlp_skill_tools`

**Purpose:** Tools a skill version is allowed to call.

**Keys:** PK `id`. Declared FK `skill_version_id` → `ccass.nlp_skill_versions.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `skill_version_id` | bigint | yes |  | Declared FK → `ccass.nlp_skill_versions.id`. |
| `tool_key` | varchar(128) | yes |  | Stable tool id string. |
| `permission_class` | varchar(32) | yes default `tool_call` |  | Permission class. |
| `requires_confirmation` | boolean | yes default `false` | `true`, `false` | Requires confirmation. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, skill_version_id=1, permission_class=tool_call, requires_confirmation=false, created_at=2026-09-20T10:00:00Z`

---
## `ccass.nlp_skill_activation_history`

**Purpose:** Audit of skill publish/activate actions.

**Keys:** PK `id`. Declared FK `skill_id` → `ccass.nlp_skills.id`; `skill_version_id` → `ccass.nlp_skill_versions.id`. Logical `organization_id` → `accounts.organizations.id`; `actor_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `skill_id` | bigint | yes |  | Declared FK → `ccass.nlp_skills.id`. |
| `skill_version_id` | bigint | no |  | Declared FK → `ccass.nlp_skill_versions.id`. |
| `action` | varchar(32) | yes |  | Action. |
| `actor_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `metadata` | jsonb | yes default `{}` |  | Extra JSON the product can extend without a migration. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, skill_id=1, skill_version_id=1, actor_user_id=1, metadata={}`

---
## `ccass.nlp_conversations`

**Purpose:** Bot runtime session tied 1:1 to a conversation, including which skill version ran.

**Keys:** PK `id`. Declared FK `skill_version_id` → `ccass.nlp_skill_versions.id`; `conversation_id` → `ccass.conversations.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `runtime_type` | varchar(32) | yes default `webchat_bot` |  | Runtime type. |
| `skill_version_id` | bigint | no |  | Declared FK → `ccass.nlp_skill_versions.id`. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `started_at` | timestamptz | yes default `now()` |  | Started at. |
| `ended_at` | timestamptz | no |  | When the session ended. |
| `end_reason` | varchar(128) | no |  | Why it ended. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, runtime_type=webchat_bot, skill_version_id=1, status=active`

---
## `ccass.nlp_turns`

**Purpose:** One bot turn: customer text, reply, intent, sentiment, and whether handoff was recommended.

**Keys:** PK `id`. Declared FK `bot_message_id` → `ccass.conversation_messages.id`; `conversation_id` → `ccass.conversations.id`; `customer_message_id` → `ccass.conversation_messages.id`; `nlp_conversation_id` → `ccass.nlp_conversations.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `nlp_conversation_id` | bigint | yes |  | Declared FK → `ccass.nlp_conversations.id`. |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `turn_number` | integer | yes |  | Turn number. |
| `customer_message_id` | bigint | no |  | Declared FK → `ccass.conversation_messages.id`. |
| `bot_message_id` | bigint | no |  | Declared FK → `ccass.conversation_messages.id`. |
| `customer_text` | text | yes |  | Customer text. |
| `bot_reply` | text | no |  | Bot reply. |
| `confidence` | numeric(5, 4) | no |  | Model confidence, 0 to 1. |
| `intent` | varchar(128) | no |  | What the customer was trying to do on this turn. |
| `candidate_skills` | jsonb | yes default `[]` |  | Candidate skills. |
| `handoff_recommended` | boolean | yes default `false` | `true`, `false` | True when the bot thinks a person should take over. |
| `handoff_reason` | varchar(128) | no |  | Why the bot sent the conversation to a queue. |
| `skill_key` | varchar(128) | no |  | Stable skill id string. |
| `model_name` | varchar(128) | no |  | Model name. |
| `trace_id` | varchar(128) | no |  | Trace id. |
| `latency_ms` | integer | no |  | Latency ms. |
| `status` | varchar(32) | yes default `completed` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `summary` | text | no |  | Short summary for lists and co-worker context. |
| `sentiment` | varchar(50) | no |  | Detected sentiment label. |
| `important_facts` | jsonb | yes default `[]` |  | Important facts. |
| `selected_queue_key` | varchar(255) | no |  | Selected queue key. |
| `queue_profile_version` | varchar(64) | no |  | Queue profile version. |
| `grounded` | boolean | no | `true`, `false` | Grounded. |
| `guard_passed` | boolean | no | `true`, `false` | Guard passed. |
| `guard_reasons` | jsonb | yes default `[]` |  | Guard reasons. |
| `knowledge_references` | jsonb | yes default `[]` |  | Knowledge references. |
| `delivery_message_id` | bigint | no |  | Delivery message id. |

**Example row:** `id=1001, organization_id=1000, nlp_conversation_id=1, conversation_id=9001, turn_number=1, customer_message_id=1, status=active`

---
## `ccass.copilot_sessions`

**Purpose:** An agent's co-worker chat session (not the customer conversation).

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `role` | varchar(32) | yes default `agent` |  | Role. |
| `active_surface` | varchar(64) | no |  | Active surface. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `started_at` | timestamptz | yes default `now()` |  | Started at. |
| `last_activity_at` | timestamptz | yes default `now()` |  | Last activity at. |
| `ended_at` | timestamptz | no |  | When the session ended. |

**Example row:** `id=1001, organization_id=1000, user_id=1005, role=agent, status=active, started_at=2026-09-20T10:00:00Z`

---
## `ccass.copilot_turns`

**Purpose:** One co-worker prompt and reply, optionally tied to a customer conversation.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`; `sent_message_id` → `ccass.conversation_messages.id`; `session_id` → `ccass.copilot_sessions.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `session_id` | bigint | yes |  | Declared FK → `ccass.copilot_sessions.id`. |
| `conversation_id` | bigint | no |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `surface` | varchar(64) | no |  | Surface. |
| `turn_type` | varchar(32) | yes default `chat` |  | Turn type. |
| `agent_input` | text | no |  | Agent input. |
| `copilot_response` | text | no |  | Copilot response. |
| `suggestion_text` | text | no |  | Suggestion text. |
| `final_text` | text | no |  | Final text. |
| `accepted` | boolean | no | `true`, `false` | Accepted. |
| `sent_message_id` | bigint | no |  | Declared FK → `ccass.conversation_messages.id`. |
| `skill_key` | varchar(128) | no |  | Stable skill id string. |
| `model_name` | varchar(128) | no |  | Model name. |
| `latency_ms` | integer | no |  | Latency ms. |
| `status` | varchar(32) | yes default `completed` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `routing_chain` | jsonb | no |  | Routing chain. |
| `prompt_versions` | jsonb | no |  | Prompt versions. |
| `assist_state` | jsonb | no |  | Assist state. |

**Example row:** `id=1001, organization_id=1000, session_id=1, conversation_id=9001, turn_type=chat, accepted=true, status=active`

---
## `ccass.copilot_memory`

**Purpose:** Durable co-worker memory for a user or a conversation.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`. Logical `organization_id` → `accounts.organizations.id`; `user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `conversation_id` | bigint | no |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `memory_type` | varchar(32) | yes |  | Memory type. |
| `content` | jsonb | yes default `{}` |  | Content. |
| `provenance` | varchar(64) | no |  | Provenance. |
| `expires_at` | timestamptz | no |  | When an unanswered offer expires. |
| `version` | integer | yes default `1` |  | Optimistic lock. Writers increment it so two updates do not overwrite each other. |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, user_id=1005, conversation_id=9001, content={}, expires_at=2026-09-20T10:00:00Z`

---
## `ccass.copilot_skill_executions`

**Purpose:** One tool/skill call the co-worker made, with latency and status.

**Keys:** PK `id`. Declared FK `session_id` → `ccass.copilot_sessions.id`; `turn_id` → `ccass.copilot_turns.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `session_id` | bigint | no |  | Declared FK → `ccass.copilot_sessions.id`. |
| `turn_id` | bigint | no |  | Declared FK → `ccass.copilot_turns.id`. |
| `skill_key` | varchar(128) | yes |  | Stable skill id string. |
| `tool_key` | varchar(128) | no |  | Stable tool id string. |
| `status` | varchar(32) | yes default `started` |  | Lifecycle or on/off state for this row. |
| `token_usage` | jsonb | no |  | Token usage. |
| `latency_ms` | integer | no |  | Latency ms. |
| `error_message` | text | no |  | Error message. |
| `trace_id` | varchar(128) | no |  | Trace id. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `agent_name` | varchar(128) | no |  | Agent name. |
| `agent_layer` | varchar(32) | no |  | Agent layer. |
| `server_key` | varchar(128) | no |  | Server key. |
| `argument_bytes` | integer | no |  | Argument bytes. |
| `result_bytes` | integer | no |  | Result bytes. |
| `outcome` | varchar(32) | no |  | What the attempt or routing decision did. |
| `metadata` | jsonb | yes default `{}` |  | Extra JSON the product can extend without a migration. |

**Example row:** `id=1001, organization_id=1000, session_id=1, turn_id=1, status=active, token_usage={}`

---
## `ccass.channel_automation_policies`

**Purpose:** Per channel config: bot on/off, confidence, default queue, and what to do when no agent is free.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `channel_config_id` → `accounts.setup_channel_configs.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `channel_config_id` | bigint | yes |  | Which setup channel (widget, mailbox, or social app) this uses. Logical ref → `accounts.setup_channel_configs.id` (no Postgres FK). |
| `channel` | varchar(32) | yes | webchat, email, whatsapp, social (later migrations also allow instagram, facebook) | Which channel this row is about. |
| `bot_enabled` | boolean | yes default `true` | `true`, `false` | Bot enabled. |
| `live_agent_enabled` | boolean | yes default `true` | `true`, `false` | Whether the bot may hand off to a person. |
| `automation_mode` | varchar(32) | yes default `auto_send` | auto_send, draft_only, disabled | Automation mode. |
| `confidence_threshold` | numeric(4, 3) | yes default `0.850` |  | Confidence threshold. |
| `default_queue_id` | bigint | no |  | Default queue id. |
| `allowed_queue_ids` | bigint[] | yes default `[]` |  | Allowed queue ids. |
| `handoff_message` | text | no |  | Handoff message. |
| `no_agent_behavior` | varchar(32) | yes default `queue_and_notify` | queue_and_notify, bot_continue, close_with_message | No agent behavior. |
| `inactivity_close_seconds` | integer | yes default `86400` |  | Inactivity close seconds. |
| `shadow_mode` | boolean | yes default `false` | `true`, `false` | Shadow mode. |
| `policy_version` | integer | yes default `1` |  | Policy version. |
| `status` | varchar(16) | yes default `active` | active, inactive | Lifecycle or on/off state for this row. |
| `channel_settings` | jsonb | yes default `{}` |  | Channel settings. |
| `source_metadata` | jsonb | yes default `{}` |  | Source metadata. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, channel_config_id=1, channel=webchat, bot_enabled=true, live_agent_enabled=true, status=active`

---
## `ccass.email_mailbox_policies`

**Purpose:** Per mailbox: bot, shadow mode, default queue, and close-after-hours.

**Keys:** PK `id`. Declared FK `default_queue_id` → `ccass.queues.id`. Logical `organization_id` → `accounts.organizations.id`; `connection_id` → `accounts.mail_oauth_connections.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `connection_id` | bigint | yes |  | Logical ref → `accounts.mail_oauth_connections.id` (no Postgres FK). |
| `account_email` | varchar(255) | yes |  | Account email. |
| `bot_enabled` | boolean | yes default `false` | `true`, `false` | Bot enabled. |
| `live_agent_enabled` | boolean | yes default `true` | `true`, `false` | Whether the bot may hand off to a person. |
| `shadow_mode` | boolean | yes default `true` | `true`, `false` | Shadow mode. |
| `auto_send_enabled` | boolean | yes default `false` | `true`, `false` | Auto send enabled. |
| `confidence_threshold` | numeric(4, 3) | yes default `0.850` |  | Confidence threshold. |
| `default_queue_id` | bigint | no |  | Declared FK → `ccass.queues.id`. |
| `allowed_queue_ids` | jsonb | yes default `[]` |  | Allowed queue ids. |
| `approved_service_message` | text | no |  | Approved service message. |
| `business_hours_mode` | varchar(32) | yes default `queue_policy` |  | Business hours mode. |
| `policy_version` | integer | yes default `1` |  | Policy version. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `inactivity_close_hours` | integer | yes default `72` |  | Inactivity close hours. |

**Example row:** `id=1001, organization_id=1000, connection_id=1, bot_enabled=false, live_agent_enabled=true, shadow_mode=true, status=active`

---
## `ccass.email_provider_events`

**Purpose:** Inbound Gmail/Graph event ids so the same webhook is not processed twice.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `connection_id` → `accounts.mail_oauth_connections.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `connection_id` | bigint | no |  | Logical ref → `accounts.mail_oauth_connections.id` (no Postgres FK). |
| `provider` | varchar(32) | yes default `gmail` |  | Provider. |
| `event_id` | varchar(255) | yes |  | Event id. |
| `mailbox_email` | varchar(255) | yes |  | Mailbox email. |
| `status` | varchar(32) | yes default `processing` |  | Lifecycle or on/off state for this row. |
| `attempt_count` | integer | yes default `1` |  | Attempt count. |
| `last_error` | text | no |  | Last error. |
| `processing_started_at` | timestamptz | yes default `now()` |  | Processing started at. |
| `processed_at` | timestamptz | no |  | Processed at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, connection_id=1, provider=gmail, status=active, attempt_count=1`

---
## `ccass.email_delivery_outbox`

**Purpose:** Outbound email waiting to be sent, with retries.

**Keys:** PK `id`. Declared FK `conversation_id` → `ccass.conversations.id`; `message_id` → `ccass.conversation_messages.id`; `source_message_id` → `ccass.conversation_messages.id`. Logical `organization_id` → `accounts.organizations.id`; `connection_id` → `accounts.mail_oauth_connections.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `conversation_id` | bigint | yes |  | The customer session this row belongs to. Declared FK → `ccass.conversations.id`. |
| `message_id` | bigint | yes |  | Declared FK → `ccass.conversation_messages.id`. |
| `source_message_id` | bigint | yes |  | Declared FK → `ccass.conversation_messages.id`. |
| `connection_id` | bigint | yes |  | Logical ref → `accounts.mail_oauth_connections.id` (no Postgres FK). |
| `recipient_email` | varchar(320) | yes |  | Recipient email. |
| `subject` | varchar(512) | yes |  | Email or conversation subject. |
| `provider_thread_id` | varchar(255) | no |  | Provider thread (email chain, WhatsApp thread) that can span sessions. |
| `in_reply_to` | varchar(998) | no |  | In reply to. |
| `references_header` | text | no |  | References header. |
| `status` | varchar(32) | yes default `pending` | pending, sending, sent, failed | Lifecycle or on/off state for this row. |
| `attempt_count` | integer | yes default `0` |  | Attempt count. |
| `next_attempt_at` | timestamptz | yes default `now()` |  | Next attempt at. |
| `provider_message_id` | varchar(255) | no |  | Provider message id. |
| `provider_rfc_message_id` | varchar(998) | no |  | Provider rfc message id. |
| `last_error` | text | no |  | Last error. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |
| `delivered_at` | timestamptz | no |  | Delivered at. |

**Example row:** `id=1001, organization_id=1000, conversation_id=9001, message_id=1, source_message_id=1, connection_id=1, status=active`

---
## `ccass.whatsapp_channel_policies`

**Purpose:** WhatsApp-specific bot, default queue, and inactivity close.

**Keys:** PK `id`. Declared FK `default_queue_id` → `ccass.queues.id`. Logical `organization_id` → `accounts.organizations.id`; `channel_config_id` → `accounts.setup_channel_configs.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `channel_config_id` | bigint | yes |  | Which setup channel (widget, mailbox, or social app) this uses. Logical ref → `accounts.setup_channel_configs.id` (no Postgres FK). |
| `bot_enabled` | boolean | yes default `false` | `true`, `false` | Bot enabled. |
| `live_agent_enabled` | boolean | yes default `true` | `true`, `false` | Whether the bot may hand off to a person. |
| `confidence_threshold` | numeric(4, 3) | yes default `0.500` |  | Confidence threshold. |
| `default_queue_id` | bigint | no |  | Declared FK → `ccass.queues.id`. |
| `approved_handoff_message` | text | no |  | Approved handoff message. |
| `inactivity_close_hours` | integer | yes default `24` |  | Inactivity close hours. |
| `status` | varchar(32) | yes default `active` |  | Lifecycle or on/off state for this row. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, channel_config_id=1, bot_enabled=false, live_agent_enabled=true, confidence_threshold=0.500, status=active`

---
## `ccass.agent_tasks`

**Purpose:** Agent inbox: callbacks, follow-ups, escalations, and co-worker suggestions.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `assigned_user_id` → `accounts.setup_users.id`; `created_by_user_id` → `accounts.setup_users.id`; `contact_id` → `cdp.customer_profile.cdp_id`; `assigned_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `assigned_user_id` | bigint | yes |  | Login user for that agent (accounts.setup_users). Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `created_by_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `contact_id` | text | no |  | The customer. Text equal to cdp.customer_profile.cdp_id (no cross-schema foreign key). Logical ref → `cdp.customer_profile.cdp_id` (no Postgres FK). |
| `conversation_id` | bigint | no |  | The customer session this row belongs to. |
| `task_type` | varchar(32) | yes | follow_up, callback, escalation, suggestion | What kind of inbox item this is. |
| `status` | varchar(32) | yes default `open` | open, completed, dismissed | Lifecycle or on/off state for this row. |
| `priority` | varchar(16) | yes default `normal` | low, normal, high, critical | Higher means more urgent where the product sorts by it. |
| `source` | varchar(16) | yes | self, admin, coworker, system | Who or what created the row. |
| `title` | text | yes |  | Short title. |
| `summary` | text | yes |  | Short summary for lists and co-worker context. |
| `notes` | text | no |  | Free-text note. |
| `channel` | varchar(32) | no |  | Which channel this row is about. |
| `due_at` | timestamptz | no |  | When the agent should do the task. |
| `completed_at` | timestamptz | no |  | When the task was finished. |
| `dismissed_at` | timestamptz | no |  | When the agent dismissed it without completing it. |
| `assigned_by_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `assigned_by_label` | text | no |  | Assigned by label. |
| `metadata` | jsonb | yes default `{}` |  | Extra JSON the product can extend without a migration. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, assigned_user_id=1005, created_by_user_id=1005, contact_id=9000000000000000123, conversation_id=9001, task_type=callback, status=active`

---
## `ccass.workspace_common_notes`

**Purpose:** Shared notes on the workspace, not tied to one conversation.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `author_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `author_user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `title` | text | no |  | Short title. |
| `body` | text | yes |  | The text the user reads. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, author_user_id=1005, created_at=2026-09-20T10:00:00Z, updated_at=2026-09-20T10:00:00Z`

---
## `ccass.scheduled_reports`

**Purpose:** A saved schedule that emails a performance PDF/CSV.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `created_by_user_id` → `accounts.setup_users.id`; `target_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `created_by_user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `enabled` | boolean | yes default `true` | `true`, `false` | Enabled. |
| `schedule` | varchar(32) | yes | daily, weekly, monthly | Schedule. |
| `weekday` | varchar(16) | yes default `monday` |  | Weekday. |
| `month_day` | integer | yes default `1` |  | Month day. |
| `send_mode` | varchar(32) | yes default `custom_time` | custom_time | Send mode. |
| `send_at` | varchar(8) | yes default `09:00` |  | Send at. |
| `time_zone` | varchar(64) | yes default `Asia/Kolkata` |  | Time zone. |
| `period` | varchar(16) | yes default `yesterday` | yesterday, last_7_days, last_30_days | Period. |
| `formats` | jsonb | yes default `{\"pdf\": true, \"csv\": false}` |  | Formats. |
| `included_sections` | jsonb | yes default `{\"dashboardKpis\": true, \"agentTable\": true, ` |  | Included sections. |
| `report_scope` | varchar(32) | yes default `organization` |  | Report scope. |
| `target_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `next_run_at` | timestamptz | no |  | Next run at. |
| `last_run_at` | timestamptz | no |  | Last run at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, created_by_user_id=1005, name=Billing, enabled=true, weekday=monday`

---
## `ccass.scheduled_report_runs`

**Purpose:** One execution of a scheduled report, including file path and status.

**Keys:** PK `id`. Declared FK `scheduled_report_id` → `ccass.scheduled_reports.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `scheduled_report_id` | bigint | yes |  | Declared FK → `ccass.scheduled_reports.id`. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `status` | varchar(32) | yes default `pending` | pending, running, succeeded, failed | Lifecycle or on/off state for this row. |
| `period_start` | timestamptz | yes |  | Period start. |
| `period_end` | timestamptz | yes |  | Period end. |
| `period_label` | varchar(255) | yes |  | Period label. |
| `pdf_path` | text | no |  | Pdf path. |
| `pdf_bytes` | bytes | no |  | Pdf bytes. |
| `summary_text` | text | no |  | Summary text. |
| `sent_to_email` | varchar(255) | no |  | Sent to email. |
| `sent_from_email` | varchar(255) | no |  | Sent from email. |
| `error_code` | varchar(64) | no |  | Error code. |
| `error_message` | text | no |  | Error message. |
| `started_at` | timestamptz | no |  | Started at. |
| `finished_at` | timestamptz | no |  | Finished at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, scheduled_report_id=1, organization_id=1000, status=active, period_start=2026-09-20T10:00:00Z, period_end=2026-09-20T10:00:00Z`

---
## `ccass.internal_chat_rooms`

**Purpose:** Team chat room: a group or a direct message. Not a customer conversation.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `created_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `room_type` | varchar(8) | yes | group, dm | Group room or direct message. |
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `description` | text | no |  | Longer explanation. |
| `category` | varchar(32) | no |  | Category. |
| `avatar_storage_key` | varchar(512) | no |  | Avatar storage key. |
| `created_by_user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, room_type=dm, name=Billing, created_by_user_id=1005, created_at=2026-09-20T10:00:00Z`

---
## `ccass.internal_chat_room_members`

**Purpose:** Who is in a team-chat room, their role, and how far they have read.

**Keys:** PK `id`. Declared FK `room_id` → `ccass.internal_chat_rooms.id`. Logical `organization_id` → `accounts.organizations.id`; `user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `room_id` | bigint | yes |  | Declared FK → `ccass.internal_chat_rooms.id`. |
| `user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `role` | varchar(16) | yes default `member` | admin, member | Role. |
| `favourite` | boolean | yes default `false` | `true`, `false` | Favourite. |
| `last_read_at` | timestamptz | no |  | How far this member has read. Unread count is messages after this. |
| `joined_at` | timestamptz | yes default `now()` |  | Joined at. |
| `left_at` | timestamptz | no |  | Left at. |

**Example row:** `id=1001, organization_id=1000, room_id=1, user_id=1005, role=member, favourite=false`

---
## `ccass.internal_chat_dm_pairs`

**Purpose:** Ensures two users share at most one direct-message room.

**Keys:** PK `id`. Declared FK `room_id` → `ccass.internal_chat_rooms.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `user_low_id` | bigint | yes |  | User low id. |
| `user_high_id` | bigint | yes |  | User high id. |
| `room_id` | bigint | yes |  | Declared FK → `ccass.internal_chat_rooms.id`. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, user_low_id=1, user_high_id=1, room_id=1, created_at=2026-09-20T10:00:00Z`

---
## `ccass.internal_chat_messages`

**Purpose:** One team-chat message (text, voice, or attachment bundle).

**Keys:** PK `id`. Declared FK `room_id` → `ccass.internal_chat_rooms.id`. Logical `organization_id` → `accounts.organizations.id`; `sender_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `room_id` | bigint | yes |  | Declared FK → `ccass.internal_chat_rooms.id`. |
| `sender_user_id` | bigint | yes |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `body` | text | yes |  | The text the user reads. |
| `message_type` | varchar(100) | yes default `text` | text, voice, attachment_bundle | text, or a richer type such as voice or attachment. |
| `voice_duration_ms` | integer | no |  | Voice duration ms. |
| `voice_storage_key` | varchar(512) | no |  | Voice storage key. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `edited_at` | timestamptz | no |  | Edited at. |
| `deleted_at` | timestamptz | no |  | Deleted at. |

**Example row:** `id=1001, organization_id=1000, room_id=1, sender_user_id=1, message_type=text, voice_duration_ms=1`

---
## `ccass.internal_chat_message_attachments`

**Purpose:** File on a team-chat message.

**Keys:** PK `id`. Declared FK `message_id` → `ccass.internal_chat_messages.id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `message_id` | bigint | yes |  | Declared FK → `ccass.internal_chat_messages.id`. |
| `storage_key` | varchar(512) | yes |  | Object-storage path of the file. |
| `file_name` | varchar(512) | yes |  | Original file name. |
| `content_type` | varchar(255) | yes |  | MIME type. |
| `byte_size` | bigint | yes default `0` |  | File size in bytes. |
| `checksum_sha256` | varchar(64) | no |  | Hash so the same file can be detected. |
| `metadata` | jsonb | yes default `{}` |  | Extra JSON the product can extend without a migration. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, message_id=1, byte_size=0, metadata={}, created_at=2026-09-20T10:00:00Z`

---
## `ccass.dashboard_analytics_incidents`

**Purpose:** Detected operational incident (SLA, backlog, and similar) shown on the admin dashboard.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `fingerprint` | varchar(255) | yes |  | Fingerprint. |
| `incident_type` | varchar(64) | yes |  | Incident type. |
| `status` | varchar(32) | yes default `active` | candidate, active, cooling, resolved | Lifecycle or on/off state for this row. |
| `severity` | varchar(16) | yes default `medium` | low, medium, high, critical | Severity. |
| `version` | integer | yes default `1` |  | Optimistic lock. Writers increment it so two updates do not overwrite each other. |
| `scope_json` | jsonb | yes default `{}` |  | Scope json. |
| `current_facts_json` | jsonb | yes default `{}` |  | Current facts json. |
| `baseline_facts_json` | jsonb | yes default `{}` |  | Baseline facts json. |
| `headline` | text | yes |  | Headline. |
| `summary` | text | yes |  | Short summary for lists and co-worker context. |
| `source` | varchar(32) | yes default `rules` |  | Who or what created the row. |
| `schema_version` | integer | yes default `1` |  | Schema version. |
| `prompt_version` | varchar(64) | no |  | Prompt version. |
| `model_name` | varchar(128) | no |  | Model name. |
| `input_hash` | varchar(128) | no |  | Input hash. |
| `first_detected_at` | timestamptz | yes default `now()` |  | First detected at. |
| `last_detected_at` | timestamptz | yes default `now()` |  | Last detected at. |
| `resolved_at` | timestamptz | no |  | When it was resolved. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, status=active, severity=medium, version=1, scope_json={}`

---
## `ccass.dashboard_analytics_forecast_runs`

**Purpose:** One volume-forecast run for the dashboard (baseline plus optional model adjustment).

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `forecast_date` | date | yes |  | Forecast date. |
| `history_days` | integer | yes default `56` |  | History days. |
| `horizon_hours` | integer | yes default `168` |  | Horizon hours. |
| `method` | varchar(64) | yes default `seasonal_baseline_plus_llm_adjustment` |  | Method. |
| `status` | varchar(32) | yes default `completed` |  | Lifecycle or on/off state for this row. |
| `input_hash` | varchar(128) | yes |  | Input hash. |
| `baseline_json` | jsonb | yes default `{}` |  | Baseline json. |
| `llm_adjustment_json` | jsonb | no |  | Llm adjustment json. |
| `forecast_json` | jsonb | yes default `{}` |  | Forecast json. |
| `summary_json` | jsonb | yes default `{}` |  | Summary json. |
| `schema_version` | integer | yes default `1` |  | Schema version. |
| `prompt_version` | varchar(64) | no |  | Prompt version. |
| `model_name` | varchar(128) | no |  | Model name. |
| `validation_status` | varchar(32) | yes default `valid` |  | Validation status. |
| `generated_at` | timestamptz | yes default `now()` |  | Generated at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, forecast_date=2026-09-20T10:00:00Z, history_days=56, horizon_hours=168, method=seasonal_baseline_plus_llm_adjustment, status=active`

---
## `ccass.dashboard_analytics_workforce_plans`

**Purpose:** Suggested staffing plan produced from a forecast.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `forecast_run_id` | bigint | no |  | Forecast run id. |
| `plan_date` | date | yes |  | Plan date. |
| `input_signature` | varchar(128) | yes |  | Input signature. |
| `plan_fingerprint` | varchar(128) | yes |  | Plan fingerprint. |
| `decision` | varchar(32) | yes default `update` |  | Decision. |
| `status` | varchar(32) | yes default `draft` |  | Lifecycle or on/off state for this row. |
| `previous_plan_id` | bigint | no |  | Previous plan id. |
| `plan_json` | jsonb | yes default `{}` |  | Plan json. |
| `source` | varchar(32) | yes default `rules` |  | Who or what created the row. |
| `schema_version` | integer | yes default `1` |  | Schema version. |
| `prompt_version` | varchar(64) | no |  | Prompt version. |
| `model_name` | varchar(128) | no |  | Model name. |
| `reviewed_by_user_id` | bigint | no |  | Reviewed by user id. |
| `reviewed_at` | timestamptz | no |  | Reviewed at. |
| `applied_at` | timestamptz | no |  | Applied at. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |
| `updated_at` | timestamptz | yes default `now()` |  | When the row last changed (UTC). |

**Example row:** `id=1001, organization_id=1000, forecast_run_id=1, plan_date=2026-09-20T10:00:00Z, decision=update, status=active`

---
## `ccass.audit_log`

**Purpose:** Sensitive action audit (who changed what, before/after JSON).

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`; `actor_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes |  | Primary key. |
| `organization_id` | bigint | yes |  | Tenant. Every query must filter this. Logical ref → `accounts.organizations.id` (no Postgres FK). |
| `actor_user_id` | bigint | no |  | Logical ref → `accounts.setup_users.id` (no Postgres FK). |
| `actor_type` | varchar(32) | yes default `system` |  | Actor type. |
| `action` | varchar(128) | yes |  | Action. |
| `entity_type` | varchar(64) | yes |  | Entity type. |
| `entity_id` | bigint | no |  | Entity id. |
| `before_state` | jsonb | no |  | Before state. |
| `after_state` | jsonb | no |  | After state. |
| `trace_id` | varchar(128) | no |  | Trace id. |
| `created_at` | timestamptz | yes default `now()` |  | When the row was created (UTC). |

**Example row:** `id=1001, organization_id=1000, actor_user_id=1, actor_type=system, entity_id=1, before_state={}`

---
## `ccass.schema_migrations`

**Purpose:** Ledger of SQL files already applied to the ccass schema.

**Keys:** PK `id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | integer | yes |  | Primary key. |
| `name` | varchar(255) | yes |  | Name shown in the UI. |
| `checksum` | varchar(64) | yes |  | Checksum. |
| `applied_at` | timestamptz | yes default `now()` |  | Applied at. |

**Example row:** `id=1001, name=Billing, applied_at=2026-09-20T10:00:00Z`

---

## `ccass.agent_not_ready_escalations`

**Purpose:** Supervisor alert after an agent dismisses Not Ready reminders and stays unavailable. Written by Contact Center; not yet a Prisma model.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`. Logical `agent_id` → `ccass.agents.id`. Logical `setup_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Primary key. |
| `organization_id` | bigint | yes | | Tenant. |
| `agent_id` | bigint | yes | | Agent who stayed not ready. |
| `setup_user_id` | bigint | no | | Login user for that agent. |
| `agent_name` | text | yes | | Name at escalation time. |
| `escalated_at` | timestamptz | yes | | When the supervisor was notified. |
| `acknowledged_at` | timestamptz | no | | When a supervisor acknowledged it. |
| `metadata` | jsonb | yes | | Extra context. |

**Example row:** `id=12, organization_id=1000, agent_id=301, setup_user_id=1005, agent_name=Priya Sharma, escalated_at=2026-09-20T10:00:00Z, acknowledged_at=null`

---


# Schema `cdp` (tables Contact Center reads and writes)

CDP is a shared customer store. Contact Center does **not** migrate the full CDP warehouse (campaigns, gold metrics, partitioned events). These are the tables the workspace, identity resolution, projections, and customer panel use.

IDs on `customer_profile.cdp_id` and `identity_keys.cdp_id` are **text**. `conversations.contact_id` stores that same text. There is **no** Postgres foreign key across schemas.

---

## `cdp.customer_profile`

**Purpose:** The contact shown in the workspace: name, company, location, and a JSON bag for extra fields. Email and phone are not columns here; they are `identity_keys`.

**Keys:** PK `cdp_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `cdp_id` | text | yes | | Contact id. Stored on conversations and tasks as `contact_id`. |
| `organization_id` | bigint | yes | | Tenant. |
| `first_name` | text | no | | Given name. |
| `last_name` | text | no | | Family name. |
| `gender` | text | no | | Profile field. |
| `date_of_birth` | date | no | | Profile field. |
| `company` | text | no | | Company name. |
| `city` | text | no | | City. |
| `region` | text | no | | Region or state. |
| `country` | text | no | | Country. |
| `language` | text | no | | Preferred language. |
| `timezone` | text | no | | IANA timezone. |
| `contact_type` | varchar | no | | Optional classification added by Contact Center. |
| `blocked` | boolean | no | `true`, `false` | When true, voice to this contact should be blocked. |
| `custom_fields` | jsonb | no | | Extra attributes, including the omni-channel summary. |
| `acquisition_channel` | text | no | | How the contact was acquired. |
| `first_seen_at` | timestamptz | no | | First time we saw them. |
| `last_seen_at` | timestamptz | no | | Last activity. |
| `created_at` | timestamptz | no | | Created. |
| `updated_at` | timestamptz | no | | Last change. |

**Example row:** `cdp_id=9000000000000000123, organization_id=1000, first_name=Priya, last_name=Sharma, company=Acme Retail, city=Bengaluru, country=India, contact_type=customer`

---

## `cdp.identity_keys`

**Purpose:** One reachable identity for a contact. Inbound email, phone, WhatsApp, and social ids are matched here to find `cdp_id`.

**Keys:** PK `identity_id`. Logical `cdp_id` → `cdp.customer_profile.cdp_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `identity_id` | text | yes | | Primary key. |
| `cdp_id` | text | yes | | Which contact owns this identity. |
| `organization_id` | bigint | yes | | Tenant. |
| `key_type` | text | yes | `email`, `email_secondary`, `phone`, `phone_secondary`, `webchat_visitor`, `whatsapp_phone`, `instagram_user`, `facebook_user` | Kind of identity. |
| `key_value` | text | yes | | Normalized value (lowercase email, phone digits as stored). |
| `source_system` | text | no | | Where it was learned (webchat, whatsapp, agent). |
| `confidence_score` | numeric | no | | How sure the match is, when set. |
| `verified` | boolean | no | `true`, `false` | Whether it was verified. |
| `created_at` | timestamptz | no | | Created. |

**Example row:** `identity_id=ik-1, cdp_id=9000000000000000123, organization_id=1000, key_type=email, key_value=priya.sharma@example.com, verified=false`

---

## `cdp.contact_identities`

**Purpose:** Earlier identity map (email, phone, webchat visitor, WhatsApp). Still present in some databases. New matching uses `identity_keys`.

**Keys:** PK `id`. Logical `contact_id` → contact / `customer_profile.cdp_id`. Logical `organization_id` → `accounts.organizations.id`. Unique (`organization_id`, `identity_type`, `identity_value`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | uuid | yes | | Primary key. |
| `organization_id` | uuid or bigint | yes | | Tenant. Older DDL used uuid; live type follows the database. |
| `contact_id` | uuid or text | yes | | Contact this identity belongs to. |
| `identity_type` | varchar(32) | yes | `email`, `phone`, `webchat_visitor`, `whatsapp_phone` | Kind. |
| `identity_value` | varchar(320) | yes | | The address, number, or visitor id. |
| `source_channel` | varchar(32) | no | | Channel that first saw it. |
| `first_seen_at` | timestamptz | yes | | First seen. |
| `last_seen_at` | timestamptz | yes | | Last seen. |
| `created_at` / `updated_at` | timestamptz | yes | | Audit. |

**Example row:** `identity_type=phone, identity_value=+919800000000, source_channel=whatsapp, contact_id=9000000000000000123`

---

## `cdp.interactions`

**Purpose:** One row per conversation, copied for the customer timeline. Do not route from this table. `ccass.conversations` is the live source.

**Keys:** PK `id`. Unique (`organization_id`, `conversation_id`). Logical `conversation_id` → `ccass.conversations.id`. Logical `contact_id` → `cdp.customer_profile.cdp_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Primary key. |
| `organization_id` | bigint | yes | | Tenant. |
| `conversation_id` | bigint | yes | | Source conversation. |
| `contact_id` | text | no | | Contact, when resolved. |
| `profile_id` | bigint | no | | Optional profile pointer kept from the conversation. |
| `visitor_id` | varchar | no | | Channel visitor id. |
| `channel` | varchar | yes | same as conversations.channel | Channel. |
| `queue_id` | bigint | no | | Queue at projection time. |
| `agent_id` | bigint | no | | Agent at projection time. |
| `status` | varchar | yes | same as conversations.status | Status copy. |
| `started_at` | timestamptz | yes | | When the conversation started. |
| `ended_at` | timestamptz | no | | When it ended. |
| `outcome` | varchar | no | | Resolution or end reason. |
| `summary` | text | no | | Rolling summary if one exists. |
| `disposition_code` | varchar | no | | Wrap-up code. |
| `topics` | jsonb | no | | Topic tags, when set. |
| `sentiment` | varchar | no | | Sentiment, when set. |
| `sla_result` | varchar | no | | SLA result, when set. |
| `last_activity_at` | timestamptz | yes | | Last projection update. |
| `created_at` / `updated_at` | timestamptz | yes | | Audit. |

**Example row:** `id=77, organization_id=1000, conversation_id=9001, contact_id=9000000000000000123, channel=webchat, status=active`

---

## `cdp.interaction_events`

**Purpose:** Timeline under an interaction: a message, handoff, or resolve. Used when rebuilding contact history.

**Keys:** PK `id`. Declared FK `interaction_id` → `cdp.interactions.id` (CASCADE) in the Contact Center migration.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Primary key. |
| `organization_id` | bigint | yes | | Tenant. |
| `interaction_id` | bigint | yes | | Parent interaction. |
| `conversation_id` | bigint | yes | | Source conversation. |
| `message_id` | bigint | no | | Source message, when the event is a message. |
| `event_type` | varchar | yes | message, handoff, resolve, transfer, and similar | What happened. |
| `metadata` | jsonb | yes | | Extra payload. |
| `occurred_at` | timestamptz | yes | | When it happened. |

**Example row:** `interaction_id=77, conversation_id=9001, event_type=handoff, occurred_at=2026-09-20T10:05:00Z`

---

## `cdp.orders`

**Purpose:** Orders shown on the customer panel. Contact Center only reads them.

**Keys:** PK `order_id`. Logical `cdp_id` → `cdp.customer_profile.cdp_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `order_id` | bigint | yes | | Primary key. |
| `cdp_id` | text | no | | Contact who placed it. Also check `custom_fields.proposed_cdp_id`. |
| `organization_id` | bigint | yes | | Tenant. |
| `order_number` | text | no | | Human order number. |
| `status` | text | no | | Order status. |
| `payment_status` | text | no | | Payment status. |
| `fulfillment_status` | text | no | | Fulfillment status. |
| `total_amount` | numeric | no | | Total. |
| `currency` | text | no | | Currency code. |
| `custom_fields` | jsonb | no | | Address, tracking, courier, and links. |
| `created_at` | timestamptz | no | | When the order was placed. |

**Example row:** `order_id=5001, organization_id=1000, cdp_id=9000000000000000123, order_number=WIPL-2026-0042, status=fulfilled, currency=INR, total_amount=2499.00`

---

## `cdp.order_items`

**Purpose:** Lines on an order (quantity and price) for the customer panel.

**Keys:** PK `order_item_id`. Logical `order_id` → `cdp.orders.order_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `order_item_id` | bigint | yes | | Primary key. |
| `order_id` | bigint | yes | | Parent order. |
| `organization_id` | bigint | yes | | Tenant. |
| `quantity` | numeric | no | | How many. |
| `unit_price` | numeric | no | | Price each. |
| `custom_fields` | jsonb | no | | Product name and other line details. |

**Example row:** `order_item_id=1, order_id=5001, organization_id=1000, quantity=1, unit_price=2499.00`

---

# Telephony table used by recordings

## `ccass.call_cdr`

**Purpose:** Call detail record from the voice platform. The recordings page lists rows that have a playable `recording_url`. This table is **not** in the Contact Center Prisma schema; telephony owns the full column set. Below is what Contact Center reads.

**Keys:** PK `id`. Logical `domain_id` → `accounts.organizations.id` (telephony tenant column, not `organization_id`). Logical `queue_id` may match `ccass.queues.id` or `ccass.queues.setup_queue_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Recording id in the UI. |
| `domain_id` | bigint | yes | | Tenant. |
| `session_start_time` | timestamptz | no | | When the call session started. |
| `created_at` | timestamptz | no | | Row time, used if session start is empty. |
| `is_inbound` | boolean | no | `true`, `false` | Inbound vs outbound. |
| `customer_number` | text | no | | Phone number, matched to `cdp.identity_keys`. |
| `agent_ext` | text | no | | Extension, matched to `accounts.setup_users.ext`. |
| `queue_id` | bigint | no | | Queue id or setup queue id. |
| `recording_duration` | integer | no | | Length. |
| `recording_url` | text | no | | URL the player opens. |

**Example row:** `id=88001, domain_id=1000, is_inbound=true, customer_number=+919800000000, agent_ext=1005, queue_id=401, recording_url=https://recordings.example/88001.wav`

---

## What this file leaves out on purpose

- `accounts` billing, subscriptions, invoices, leads, quotations, partners, resellers
- CDP analytics warehouse: campaigns, gold metrics, partitioned `customer_events` / `customer_journey`
- High-volume fact tables are included when the product writes them (`conversation_messages`, `nlp_turns`) because the team asked for tables in use, not only the ontology graph

Column lists for `accounts` and `ccass` match Prisma. If a live database has an extra column from a SQL migration not yet pulled into Prisma, it will be missing here until the schema is regenerated.
