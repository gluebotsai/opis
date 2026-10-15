# Campaign platform — database schema reference

**Source of truth:** [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma)  
**Last aligned with schema:** August 2026

This document lists every table the Campaign microservice reads or writes: the **`campaign`** schema (Prisma), plus shared **`accounts.*`** and **`cdp.*`** tables accessed via raw SQL (`ACCOUNT_DATABASE_URL`).

---

## Database topology

| Connection | Env var | PostgreSQL schema | Access |
|------------|---------|-------------------|--------|
| Campaign (Prisma) | `DATABASE_URL` / `CAMPAIGN_DATABASE_URL` | `campaign` | Full CRUD via Prisma |
| Account + CDP (pg pool) | `ACCOUNT_DATABASE_URL` | `accounts`, `cdp` | Read users/config; CRUD contacts on **existing columns only** (no `ALTER`) |

All three schemas typically live in the same database (`worktual_bigint`). Tenant isolation uses **`tenant_id`** (= `accounts.organizations.id`, exposed to the API as a stable UUID string) and **`branch_id`** for campaign workspace scoping.

### External references (not stored in `campaign`)

These columns are **foreign logical refs** — no Prisma FK to account/CDP:

| Column | Points to | Used in |
|--------|-----------|---------|
| `tenant_id` | `accounts.organizations.id` | Most tables |
| `created_by_user_id` | `accounts.setup_users.id` | campaigns, agent sessions, recommendations |
| `contact_id` | `cdp.customer_profile.cdp_id` | audience, send recipients, push endpoints, engagement |
| `user_id` (notifications) | `accounts.setup_users.id` | `app_notifications` (nullable = tenant-wide) |
| `channel_config_id` | `accounts.setup_channel_configs.id` | `regulated_channel_templates` (internal only) |

---

## ID conventions

- **Campaign schema IDs:** `bigint` autoincrement (`@id @default(autoincrement())`). The API serializes them as strings.
- **Legacy CSV docs** under `docs/schema/` sometimes say `uuid`; the live Prisma schema uses **bigint**.
- **CDP contact id:** `cdp.customer_profile.cdp_id` — campaign stores this in `contact_id` columns.
- **Agent session id:** Client-supplied or server-generated bigint; create-campaign draft URLs use `/campaigns/create/{sessionId}`.

---

## Enums (`campaign` schema)

| Enum | Values | Used by |
|------|--------|---------|
| `ProductCode` | `campaign`, `crm` | `organization_products.product_code` |
| `ProductStatus` | `active`, `inactive` | `organization_products.status` |
| `CampaignStatus` | `draft`, `scheduled`, `live`, `completed`, `cancelled` | `campaigns.status` |
| `SourceChannel` | `standalone_campaign`, `crm_marketing` | `campaigns.source_channel` |
| `ChannelConfigStatus` | `not_started`, `in_progress`, `ready`, `blocked` | `channel_sending_profiles.status` |
| `RegulatedTemplateStatus` | `draft`, `pending`, `approved`, `rejected`, `paused`, `disabled` | `regulated_channel_templates.status` |

---

## `campaign` schema — tables (27)

### Org & entitlements

#### `branches`

Workspace branch under a tenant (default branch created on first login).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | PK |
| `tenant_id` | bigint | NO | | Owning org |
| `name` | text | NO | | Display name |
| `is_default` | boolean | NO | `false` | Default branch for tenant |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Indexes:** `(tenant_id)`, `(tenant_id, is_default)`

#### `organization_products`

Product entitlement per branch (Campaign app vs CRM).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | PK |
| `tenant_id` | bigint | NO | | |
| `branch_id` | bigint | NO | | FK → `branches.id` CASCADE |
| `product_code` | enum | NO | | `campaign` \| `crm` |
| `status` | enum | NO | `active` | |
| `starts_at` | timestamptz | YES | | |
| `ends_at` | timestamptz | YES | | |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(tenant_id, branch_id, product_code)`

---

### Campaign lifecycle

#### `campaigns`

Persisted campaign after save/launch from the create-campaign agent.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | PK |
| `tenant_id` | bigint | NO | | |
| `branch_id` | bigint | NO | | FK → `branches.id` |
| `name` | text | NO | | |
| `description` | text | YES | | |
| `status` | enum | NO | `draft` | Lifecycle |
| `starts_at` | timestamptz | YES | | UTC launch instant |
| `ends_at` | timestamptz | YES | | UTC end |
| `source_channel` | enum | NO | `standalone_campaign` | Origin surface |
| `created_by_user_id` | bigint | NO | | User ref |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |
| `goal` | text | YES | | Business goal |
| `objective` | text | YES | | Measurable objective |
| `session_id` | bigint | YES | | **Unique** — agent session saved from |
| `audience_summary` | text | YES | | Human-readable audience |
| `audience_filters` | jsonb | YES | | Filter definition snapshot |
| `audience_count` | int | NO | `0` | Count at save/launch |
| `launch_plan` | jsonb | YES | | Schedule, channels, A/B, `channel_run` |
| `launch_local_date` | text | YES | | Local `YYYY-MM-DD` |
| `launch_local_time` | text | YES | | Local `HH:mm` |
| `timezone` | text | YES | `Asia/Kolkata` | IANA timezone |

**Indexes:** `(tenant_id, branch_id)`, `(tenant_id, branch_id, status)`, `(tenant_id, branch_id, starts_at)`

#### `campaign_channels`

One row per channel on a saved campaign.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | PK |
| `campaign_id` | bigint | NO | | FK → `campaigns.id` CASCADE |
| `tenant_id` | bigint | NO | | Denormalized |
| `channel` | text | NO | | `email`, `sms`, `whatsapp`, `push`, `web`, … |
| `template_id` | bigint | YES | | Optional template ref |
| `how_it_works` | text | YES | | Channel plan notes |
| `planned_launch_at` | text | YES | | Planned launch string |
| `status` | text | NO | `ready` | Channel readiness |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(campaign_id, channel)`

#### `campaign_audience`

Frozen contact refs at save/launch time.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `campaign_id` | bigint | NO | | PK part; FK → `campaigns.id` CASCADE |
| `contact_id` | bigint | NO | | PK part; ref `cdp.customer_profile.cdp_id` |
| `created_at` | timestamptz | NO | `now()` | |

**Primary key:** `(campaign_id, contact_id)`

---

### Create-campaign agent (draft)

#### `campaign_agent_sessions`

Draft chat session for create-campaign (and persisted copies for contacts/monitoring modules). Full agent state lives in **`payload` JSONB**; normalized child tables hold audience refs and channel templates.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | | PK (often client/agent supplied) |
| `tenant_id` | bigint | NO | | |
| `branch_id` | bigint | NO | | FK → `branches.id` |
| `created_by_user_id` | bigint | NO | | |
| `module` | text | NO | `create_campaign` | Agent module key |
| `stage` | text | NO | `intake` | Wizard stage |
| `payload` | jsonb | NO | | See [Agent session payload](#agent-session-payload) |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

#### `campaign_audience_refs`

Draft audience contact refs before campaign persist.

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `session_id` | bigint | NO | PK; FK → `campaign_agent_sessions.id` CASCADE |
| `contact_id` | bigint | NO | PK; CDP contact ref |

#### `campaign_channel_templates`

Per-channel template draft in a session (`id` = template_id in API).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | PK = template_id |
| `session_id` | bigint | NO | | FK → sessions CASCADE |
| `tenant_id` | bigint | NO | | |
| `branch_id` | bigint | NO | | |
| `channel` | text | NO | | |
| `logo` | text | YES | | |
| `launch_at` | text | YES | | |
| `how_it_works` | text | YES | | |
| `fields` | jsonb | NO | | Structured shell fields for FE |
| `generation_batch_id` | bigint | YES | | Groups AI generations |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

#### `campaign_template_messages`

Edit-space chat for one channel template (ordered by `seq`).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | PK |
| `template_id` | bigint | NO | | FK → `campaign_channel_templates.id` CASCADE |
| `role` | text | NO | | `user` \| `assistant` \| `system` |
| `seq` | int | NO | | Order within template |
| `kind` | text | NO | | `text` \| `template` |
| `payload` | jsonb | NO | | Message body / content |
| `created_at` | timestamptz | NO | `now()` | |

**Unique:** `(template_id, seq)`

---

### Channel configuration

#### `channel_sending_profiles`

Per-tenant channel readiness checklist (email gate, etc.).

| Column | Type | Null | Default |
|--------|------|------|---------|
| `id` | bigint | NO | autoincrement |
| `tenant_id` | bigint | NO | |
| `channel` | text | NO | |
| `status` | enum | NO | `not_started` |
| `checklist` | jsonb | YES | |
| `created_at` | timestamptz | NO | `now()` |
| `updated_at` | timestamptz | NO | auto |

**Unique:** `(tenant_id, channel)`

#### `push_channel_settings`

Web push / app push provider credentials.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `channel` | text | NO | | `web_push` \| `app_push` |
| `settings` | jsonb | NO | `{}` | VAPID / FCM / APNs (secrets server-side) |
| `status` | text | NO | `not_started` | |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(tenant_id, channel)`

#### `email_org_profiles`

CAN-SPAM / compliance postal address (one per tenant).

| Column | Type | Null |
|--------|------|------|
| `id` | bigint | NO |
| `tenant_id` | bigint | NO (unique) |
| `legal_name` | text | NO |
| `street` | text | NO |
| `city` | text | NO |
| `country` | text | NO |
| `phone` | text | YES |
| `created_at` | timestamptz | NO |
| `updated_at` | timestamptz | NO |

#### `email_senders`

From addresses; one `is_active` sender per tenant drives the email worker.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `display_name` | text | NO | | |
| `from_email` | text | NO | | |
| `reply_to` | text | YES | | |
| `status` | text | NO | `pending_verification` | |
| `verify_token` | text | YES | | |
| `verify_expires_at` | timestamptz | YES | | |
| `verified_at` | timestamptz | YES | | |
| `is_active` | boolean | NO | `false` | Active From for worker |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(tenant_id, from_email)`

#### `email_domains`

Sending domain authentication (SPF/DKIM/DMARC + ESP sync).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `domain` | text | NO | | |
| `spf_ok` | boolean | NO | `false` | |
| `dkim_ok` | boolean | NO | `false` | |
| `dmarc_ok` | boolean | NO | `false` | |
| `status` | text | NO | `not_started` | |
| `provider_domain_id` | text | YES | | ESP domain id |
| `dns_records` | jsonb | YES | | DNS records for operator |
| `dkim_selector` | text | YES | | e.g. `campaign` |
| `dkim_public_key` | text | YES | | Base64 public key |
| `dkim_private_key_encrypted` | text | YES | | AES-GCM PEM — never exposed to FE |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(tenant_id, domain)`

#### `email_return_paths`

Bounce / return-path domain (one per tenant).

| Column | Type | Null | Default |
|--------|------|------|---------|
| `id` | bigint | NO | autoincrement |
| `tenant_id` | bigint | NO (unique) |
| `domain` | text | NO |
| `status` | text | NO | `not_started` |
| `created_at` | timestamptz | NO | `now()` |
| `updated_at` | timestamptz | NO | auto |

#### `email_sending_caps`

Batch size, rate caps, warmup, send health.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO (unique) | | |
| `batch_size` | int | NO | `200` | |
| `hourly_cap` | int | NO | `500` | |
| `daily_cap` | int | NO | `1000` | |
| `warmup_stage` | int | NO | `0` | |
| `health_status` | text | NO | `healthy` | |
| `health_stats` | jsonb | YES | | `{ sent, hardBounce, complaint, windowStart }` |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

#### `email_suppressions`

Durable unsub / hard-bounce / complaint list.

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `id` | bigint | NO | PK |
| `tenant_id` | bigint | NO | |
| `email` | text | NO | |
| `reason` | text | NO | `unsub`, `hard_bounce`, `complaint`, … |
| `created_at` | timestamptz | NO | |

**Unique:** `(tenant_id, email)`

#### `sms_channel_settings`

Per-tenant SMS / DLT provider settings (one row per tenant).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO (unique) | | |
| `settings` | jsonb | NO | `{}` | `provider`, `api_key`, `sender_id`, `entity_id`, `base_url`, … |
| `status` | text | NO | `not_started` | |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

#### `regulated_channel_templates`

SMS (DLT) and WhatsApp (Meta) approval templates.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `channel` | text | NO | | `sms` \| `whatsapp` |
| `name` | text | NO | | |
| `external_id` | text | NO | `""` | DLT id or Meta template name |
| `provider_template_id` | text | YES | | Meta Graph id |
| `language` | text | NO | `en` | |
| `category` | text | NO | `""` | |
| `header` | text | NO | `""` | |
| `body` | text | NO | | |
| `footer` | text | NO | `""` | |
| `buttons` | text | NO | `""` | Newline-separated labels |
| `status` | enum | NO | `draft` | |
| `rejected_reason` | text | YES | | |
| `channel_config_id` | bigint | YES | | Internal `accounts.setup_channel_configs` — **never expose to UI** |
| `submitted_at` | timestamptz | YES | | |
| `last_status_checked_at` | timestamptz | YES | | |
| `created_by_user_id` | bigint | YES | | |
| `campaign_name` | text | NO | `""` | Context |
| `goal` | text | NO | `""` | |
| `objective` | text | NO | `""` | |
| `source_campaign_id` | bigint | YES | | Optional link |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

---

### Sending & engagement

#### `campaign_send_batches`

Queued send slices per campaign channel run.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `campaign_id` | bigint | NO | | FK → `campaigns.id` CASCADE |
| `channel` | text | NO | `email` | `email` \| `push` \| `web` \| … |
| `seq` | int | NO | | Batch sequence within channel |
| `scheduled_for` | timestamptz | NO | | Worker process time |
| `status` | text | NO | `queued` | |
| `size` | int | NO | `0` | Recipient count |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(campaign_id, channel, seq)`

#### `campaign_send_recipients`

Per-recipient send attempt and engagement counters.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `batch_id` | bigint | NO | | FK → batches CASCADE |
| `campaign_id` | bigint | NO | | Denormalized |
| `contact_id` | bigint | YES | | CDP ref |
| `email` | text | YES | | When channel = email |
| `destination` | text | YES | | Push token / web-push URL |
| `platform` | text | YES | | `ios`, `android`, `web`, … |
| `status` | text | NO | `pending` | |
| `skip_fail_reason` | text | YES | | |
| `provider_message_id` | text | YES | | ESP message id |
| `attempt_count` | int | NO | `0` | |
| `ab_variant` | text | YES | | `a` \| `b` \| `holdout` \| `winner` |
| `opened_at` | timestamptz | YES | | First open |
| `clicked_at` | timestamptz | YES | | First click |
| `open_count` | int | NO | `0` | Includes re-opens |
| `click_count` | int | NO | `0` | Includes re-clicks |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

#### `push_endpoints`

Device tokens and web-push subscriptions keyed by contact.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `contact_id` | bigint | YES | | |
| `channel` | text | NO | | `push` \| `web` |
| `platform` | text | YES | | |
| `endpoint` | text | NO | | Token or subscription URL |
| `auth_keys` | jsonb | YES | | Web push auth |
| `label` | text | YES | | |
| `active` | boolean | NO | `true` | |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(tenant_id, channel, endpoint)`

#### `website_contacts`

Visitor-site people (page views + web-push opt-in). **Not** CDP audience contacts until explicitly promoted.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `visitor_id` | text | NO | | |
| `contact_id` | bigint | YES | | Null until promoted to CDP |
| `email` | text | YES | | |
| `phone` | text | YES | | |
| `first_name` | text | YES | | |
| `last_name` | text | YES | | |
| `origin` | text | NO | `""` | |
| `path` | text | YES | | |
| `user_agent` | text | YES | | |
| `subscribed` | boolean | NO | `false` | |
| `endpoint` | text | YES | | |
| `auth_keys` | jsonb | YES | | |
| `platform` | text | YES | | |
| `visit_count` | int | NO | `1` | |
| `first_seen_at` | timestamptz | NO | `now()` | |
| `last_seen_at` | timestamptz | NO | `now()` | |
| `subscribed_at` | timestamptz | YES | | |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(tenant_id, visitor_id)`

#### `campaign_contact_engagement`

Campaign-scoped email engagement for a shared CDP contact (unsub, opens, clicks).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `contact_id` | bigint | NO | | CDP ref |
| `email_unsubscribed` | boolean | NO | `false` | |
| `email_unsubscribed_at` | timestamptz | YES | | |
| `email_unsubscribe_reason` | text | YES | | |
| `last_email_opened_at` | timestamptz | YES | | |
| `last_email_clicked_at` | timestamptz | YES | | |
| `email_open_count` | int | NO | `0` | |
| `email_click_count` | int | NO | `0` | |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(tenant_id, contact_id)`

---

### Recommendations, industry packs, notifications

#### `tenant_industry_packs`

Per-tenant industry pack (seeded from org `industry_type`; grows over time).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO (unique) | | |
| `pack_id` | text | NO | `generic-b2b` | `generic-b2b` \| `generic-b2c` |
| `seed_industry_type` | text | NO | `""` | From `accounts.organizations.industry_type` |
| `payload` | jsonb | NO | `{}` | `{ version, mode, fields[], rules[] }` |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

#### `campaign_recommendations`

Tenant-shared recommendation board (Campaign SPA + CRM embed).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | bigint | NO | autoincrement | |
| `tenant_id` | bigint | NO | | |
| `branch_id` | bigint | NO | | |
| `created_by_user_id` | bigint | NO | | |
| `public_id` | text | NO | | Frontend id e.g. `rec-…` |
| `status` | text | NO | | |
| `title` | text | NO | `""` | |
| `payload` | jsonb | NO | `{}` | Full card JSON |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | auto | |

**Unique:** `(tenant_id, public_id)`

#### `app_notifications`

In-app bell notifications.

| Column | Type | Null | Notes |
|--------|------|------|-------|
| `id` | bigint | NO | PK |
| `tenant_id` | bigint | NO | |
| `user_id` | bigint | YES | Null = all users in tenant |
| `kind` | text | NO | |
| `title` | text | NO | |
| `body` | text | NO | |
| `href` | text | YES | Deep link |
| `source_key` | text | NO | Dedup key |
| `created_at` | timestamptz | NO | |
| `read_at` | timestamptz | YES | |

**Unique:** `(tenant_id, source_key)`

---

## `accounts` schema — tables used by Campaign (read-mostly)

Campaign **does not** own these tables. Access is via `accountQuery()` in `backend/src/dao/`.

### `accounts.setup_users`

Login identity. **Read only** from Campaign.

| Column | Type | Campaign usage |
|--------|------|----------------|
| `id` | bigint | Session user id |
| `work_email` | text | Login email |
| `password_hash` | text | Password verify |
| `first_name` | text | Display name |
| `last_name` | text | Display name |
| `status` | text | Must be `active` |
| `organization_id` | bigint | → `tenant_id` |

### `accounts.organizations`

Tenant org profile.

| Column | Type | Campaign usage |
|--------|------|----------------|
| `id` | bigint | `tenant_id` |
| `company_name` | text | Org display name |
| `business_type` | text | B2B/B2C mode (`B2C` → b2c pack) |
| `industry_type` | text | Seeds `tenant_industry_packs` |

### `accounts.setup_user_product_access`

User role per org (join to `setup_roles`).

| Column | Type | Campaign usage |
|--------|------|----------------|
| `user_id` | bigint | |
| `organization_id` | bigint | |
| `role_id` | bigint | → `setup_roles.name` |

### `accounts.setup_roles`

Role names (`admin`, etc.).

### `accounts.setup_channel_configs`

Cross-product channel configs (WhatsApp Meta id, email channel rows). **Read only** in Campaign Configuration UI.

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint | Referenced by `regulated_channel_templates.channel_config_id` |
| `organization_id` | bigint | Tenant |
| `channel_type` | text | Mapped to UI channel ids |
| `name` | text | |
| `status` | text | `active`, `pending`, … |
| `product_ids` | json/jsonb | |

### `accounts.setup_email_configs` / `accounts.mail_oauth_connections`

Read for My Accounts mailbox test-send (`accounts-email-mailbox.ts`). OAuth tokens encrypted with `MS_TOKEN_ENCRYPTION_KEY`.

---

## `cdp` schema — contact tables

Contacts = **`cdp.customer_profile`** + **`cdp.identity_keys`**. Campaign may **SELECT / INSERT / UPDATE / DELETE on existing columns only** — no schema migrations on CDP from Campaign.

### `cdp.customer_profile`

| Column | Type | API mapping | Notes |
|--------|------|-------------|-------|
| `cdp_id` | bigint | `id` | PK; stored as `contact_id` in campaign tables |
| `organization_id` | bigint | tenant scope | Same as accounts org id |
| `first_name` | text | `first_name` | |
| `last_name` | text | `last_name` | |
| `company` | text | `company_name` | |
| `city` | text | `city` | |
| `custom_fields` | jsonb | `custom_fields` | Extra attrs; `campaign_deleted: true` = soft delete |
| `created_at` | timestamptz | `created_at` | |
| `updated_at` | timestamptz | | |
| `first_seen_at` | timestamptz | | Set on campaign create |
| `last_seen_at` | timestamptz | | |
| `acquisition_channel` | text | | Campaign sets `'campaign'` on insert |

### `cdp.identity_keys`

Email and phone identities (one profile, many keys).

| Column | Type | Notes |
|--------|------|-------|
| `identity_id` | uuid | PK (`gen_random_uuid()`) |
| `cdp_id` | bigint | FK → `customer_profile.cdp_id` |
| `organization_id` | bigint | Tenant |
| `key_type` | text | `email`, `primary_email`, `phone`, `primary_phone`, `mobile` |
| `key_value` | text | Normalized email or phone |
| `source_system` | text | Campaign uses `'campaign'` |
| `verified` | boolean | |
| `created_at` | timestamptz | |
| `custom_fields` | jsonb | |

**Campaign engagement** (opens, clicks, unsub at tenant level) stays in **`campaign_contact_engagement`**, not on CDP rows.

---

## JSON structures

### Agent session payload

Stored in `campaign_agent_sessions.payload`. Shape depends on `module`; agents runtime also keeps ephemeral in-memory fields (Redis) that merge with DB payload.

#### `create_campaign` (default)

```json
{
  "session_id": "<bigint string>",
  "user_id": "<bigint string>",
  "tenant_id": "<bigint string>",
  "branch_id": "<bigint string>",
  "module": "create_campaign",
  "stage": "intake | audience | templates | launch_plan | …",
  "campaign": { "name": "", "goal": "", "objective": "" },
  "audience": {
    "filters": {},
    "matched_count": 0,
    "sample_names": [],
    "description": "",
    "scores": null
  },
  "channels": [],
  "channel_plans": [],
  "confirmed_create_templates": false,
  "templates": [],
  "active_edit_channel": null,
  "launch_plan": null,
  "launch_confirmed": false,
  "strategy_summary": "",
  "strategy_accepted": false,
  "campaign_id": null,
  "messages": [{ "role": "user|assistant", "text": "…", "created_at": "…" }],
  "llm_memory": [],
  "hub_mode": false
}
```

Normalized relations (not duplicated in payload long-term):

- Audience contact ids → `campaign_audience_refs`
- Channel templates + edit chat → `campaign_channel_templates`, `campaign_template_messages`

#### `contacts`

```json
{
  "module": "contacts",
  "stage": "idle",
  "focus_contact_id": null,
  "draft_contact": {
    "first_name": "", "last_name": "", "email": "", "phone": "",
    "company_name": "", "city": ""
  },
  "candidates": [],
  "pending_delete_id": null,
  "messages": []
}
```

#### `monitoring`

```json
{
  "module": "monitoring",
  "stage": "idle",
  "focus_campaign_id": null,
  "focus_campaign_name": null,
  "monitor_bucket": "live",
  "last_report": null,
  "messages": []
}
```

Ephemeral agent modules (`reports`, `recommendations`, `forms`, hub `hub-*` sessions) use in-memory session store only — **not** persisted to `campaign_agent_sessions` unless explicitly saved as drafts.

### `campaigns.launch_plan` (jsonb)

Typical keys after launch planning:

| Key | Purpose |
|-----|---------|
| `schedule_mode` | `immediate`, `scheduled`, … |
| `starts_at` / `ends_at` | UTC instants |
| `timezone`, `local_date`, `local_time` | Display / scheduling |
| `ab_enabled`, `ab_split`, `ab_metric` | Email A/B test |
| `personalization` | `{ mode: "dynamic_offer", … }` |
| `channel_run` | Per-channel send order and timing |
| `metrics` | Snapshot targets |

### `campaign_channel_templates.fields`

Channel-specific structured content for frontend shells (email blocks, SMS body, push title/body, etc.) — schema varies by `channel`.

### `campaign_recommendations.payload`

Full recommendation card: title, channels, audience hints, `chatMessages`, `editLog`, etc. PII arrays (`contactIds`, `emails`, …) are stripped before persist.

---

## Data flow (high level)

```
1. Draft     campaign_agent_sessions (+ audience_refs, channel_templates, template_messages)
2. Save      campaigns + campaign_channels + campaign_audience
3. Send      campaign_send_batches → campaign_send_recipients
4. Config    email_* / push_channel_settings / sms_channel_settings / channel_sending_profiles
5. Engage    campaign_send_recipients (per-send) + campaign_contact_engagement (per-contact)
```

Visual ER diagram: [`docs/schema/campaign_er_diagram.md`](schema/campaign_er_diagram.md)

Column CSV exports (may lag Prisma on id types): [`campaign_tables.csv`](schema/campaign_tables.csv), [`campaign_columns.csv`](schema/campaign_columns.csv)

---

## Code references

| Area | Path |
|------|------|
| Prisma schema | `backend/prisma/schema.prisma` |
| Agent session CRUD | `backend/src/dao/agent-session.ts` |
| Contacts (CDP) | `backend/src/dao/contact.ts` |
| Auth / users | `backend/src/dao/auth.ts` |
| Channel config read | `backend/src/dao/configuration.ts` |
| Agent in-memory session | `agents/app/session_store.py` |
| Create-campaign tools | `agents/app/agents/create_campaign/tool_functions.py` |

---

## Migrations

Apply Prisma migrations against `DATABASE_URL`:

```bash
cd backend
npx prisma migrate deploy
```

Generate client after schema changes:

```bash
npx prisma generate
```
