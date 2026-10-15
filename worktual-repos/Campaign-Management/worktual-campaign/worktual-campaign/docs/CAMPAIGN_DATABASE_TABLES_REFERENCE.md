# Campaign platform — database tables reference

**New standalone guide** (not a duplicate of `CAMPAIGN_DATABASE_SCHEMA.md` or `CAMPAIGN_DATABASE_SCHEMA_SAMPLES.md`).

**Source of truth:** [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma)  
**Database:** PostgreSQL `worktual_bigint` — schemas `campaign`, `accounts`, `cdp`  
**Last aligned:** August 2026

Each table section includes:
- **Purpose** — what the table stores and why it exists
- **Used by** — backend modules, agents, or workers that read/write it
- **Relationships** — how it links to other tables and typical lifecycle
- **Columns** — every column with type, sample value, and short description

---

## Shared example IDs

| Symbol | Example | Meaning |
|--------|---------|---------|
| `ORG_ID` | `1000` | `accounts.organizations.id` / `organization_id` in campaign schema |
| `BRANCH_ID` | `1000` | Default workspace branch |
| `USER_ID` | `1005` | `accounts.setup_users.id` |
| `CONTACT_ID` | `9000000000000000123` | `cdp.customer_profile.cdp_id` |
| `CAMPAIGN_ID` | `1012` | Saved campaign row |
| `SESSION_ID` | `9000000000000000042` | Create-campaign agent draft session |

---

## Enums (`campaign` schema)

| Enum | Example value | Used for |
|------|---------------|----------|
| `ProductCode` | `"campaign"` | Product entitlement rows |
| `ProductStatus` | `"active"` | Entitlement on/off |
| `CampaignStatus` | `"live"` | Campaign lifecycle |
| `SourceChannel` | `"standalone_campaign"` | Where campaign was created |
| `ChannelConfigStatus` | `"ready"` | Channel configuration gate |
| `RegulatedTemplateStatus` | `"approved"` | SMS/WhatsApp template approval |

---

## `campaign` schema (27 tables)

### `campaign.branches`

**Purpose:** Stores workspace branches under an organization. Campaign data is scoped to both organization and branch so multi-branch tenants can isolate campaigns.

**Used by:** Login entitlement flow (`ensureCampaignAccessForOrganization`), Prisma relations on campaigns and agent sessions, branch picker in API.

**Relationships:** Parent: `organization_id` → `accounts.organizations`. Children: `campaigns`, `campaign_agent_sessions`, `organization_products`. A default branch (`is_default=true`) is auto-created on first login.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 1000 | Primary key; autoincrement; API returns as string. |
| `organization_id` | bigint | NO | 1000 | Owning organization; matches accounts org id. |
| `name` | text | NO | "Default" | Display label shown in branch-scoped UI. |
| `is_default` | boolean | NO | true | Marks the fallback branch for the org. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Row creation time. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Last update (Prisma @updatedAt). |

---

### `campaign.organization_products`

**Purpose:** Records which Worktual products (Campaign, CRM) are entitled for each org branch. Login checks for an active Campaign row before allowing access.

**Used by:** Auth (`entitlements.ts`), login auto-provision, CRM embed entitlement checks.

**Relationships:** FK `branch_id` → `branches.id`. Unique per (`organization_id`, `branch_id`, `product_code`). Created on first login if missing.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 1 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Organization that owns the entitlement. |
| `branch_id` | bigint | NO | 1000 | Branch this entitlement applies to. |
| `product_code` | enum | NO | "campaign" | Product: campaign or crm. |
| `status` | enum | NO | "active" | active or inactive. |
| `starts_at` | timestamptz | YES | 2026-08-25T06:00:00Z | Optional entitlement start. |
| `ends_at` | timestamptz | YES | null | Optional expiry; null = no end. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created timestamp. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated timestamp. |

---

### `campaign.campaigns`

**Purpose:** Central persisted campaign record after the create-campaign agent saves or launches. Holds name, goal, audience snapshot, schedule, and per-channel run metrics in JSON.

**Used by:** Campaign API, monitoring list, launch workers (email/push/WhatsApp/SMS), dashboard metrics, CRM embed.

**Relationships:** FK `branch_id` → `branches`. Optional unique `session_id` → agent draft. Children: `campaign_channels`, `campaign_audience`, `campaign_send_batches`. Status flows draft → scheduled/live → completed/cancelled.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 1012 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Tenant isolation key. |
| `branch_id` | bigint | NO | 1000 | Workspace branch. |
| `name` | text | NO | "Demo · Summer Sale Blast" | Campaign display name. |
| `description` | text | YES | "Live email promo for summer SKUs." | Longer description. |
| `status` | enum | NO | "live" | Lifecycle: draft, scheduled, live, completed, cancelled. |
| `starts_at` | timestamptz | YES | 2026-08-22T12:00:00Z | UTC launch instant. |
| `ends_at` | timestamptz | YES | 2026-09-05T12:00:00Z | UTC end instant. |
| `source_channel` | enum | NO | "standalone_campaign" | Origin: standalone_campaign or crm_marketing. |
| `created_by_user_id` | bigint | NO | 1005 | Creator ref → setup_users.id. |
| `created_at` | timestamptz | NO | 2026-08-19T08:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T10:00:00Z | Updated at. |
| `goal` | text | YES | "Drive seasonal revenue" | Business goal from agent. |
| `objective` | text | YES | "Increase checkout conversions" | Measurable objective. |
| `session_id` | bigint | YES | 9000000000000000042 | Agent session this campaign was saved from (unique). |
| `audience_summary` | text | YES | "Contacts in Chennai with email" | Human-readable audience. |
| `audience_filters` | jsonb | YES | {"city":"Chennai","has_email":true} | Filter snapshot at save. |
| `audience_count` | int | NO | 1200 | Audience size at save/launch. |
| `launch_plan` | jsonb | YES | {"channel_run":{"email":{"sent":860}}} | Schedule, A/B, channel_run metrics. |
| `launch_local_date` | text | YES | "2026-06-05" | Local YYYY-MM-DD for launch. |
| `launch_local_time` | text | YES | "12:00" | Local HH:mm for launch. |
| `timezone` | text | YES | "Asia/Kolkata" | IANA timezone for scheduling. |

---

### `campaign.campaign_channels`

**Purpose:** One row per marketing channel attached to a saved campaign (email, SMS, WhatsApp, push, web, PPC). Stores channel-specific plan text and readiness status.

**Used by:** Campaign detail API, monitoring, launch orchestration, channel template linking.

**Relationships:** FK `campaign_id` → `campaigns.id` CASCADE. Unique (`campaign_id`, `channel`). Denormalized `organization_id` for tenant-scoped queries.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 4001 | Primary key. |
| `campaign_id` | bigint | NO | 1012 | Parent campaign. |
| `organization_id` | bigint | NO | 1000 | Denormalized org id. |
| `channel` | text | NO | "email" | Channel slug: email, sms, whatsapp, push, web, ppc. |
| `template_id` | bigint | YES | 5001 | Optional link to channel template draft. |
| `how_it_works` | text | YES | "Email drip with summer SKU highlights" | Channel plan notes. |
| `planned_launch_at` | text | YES | "2026-08-22T12:00:00Z" | Planned launch string. |
| `status` | text | NO | "ready" | Channel readiness within campaign. |
| `created_at` | timestamptz | NO | 2026-08-19T08:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T10:00:00Z | Updated at. |

---

### `campaign.campaign_audience`

**Purpose:** Frozen set of CDP contact references included in a saved campaign at launch time. Stores only `contact_id` refs — not full contact rows.

**Used by:** Launch workers when building send recipient lists, campaign detail audience panel, reporting.

**Relationships:** Composite PK (`campaign_id`, `contact_id`). FK `campaign_id` → `campaigns` CASCADE. `contact_id` → `cdp.customer_profile.cdp_id` (logical ref).

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `campaign_id` | bigint | NO | 1012 | Campaign this contact belongs to. |
| `contact_id` | bigint | NO | 9000000000000000123 | CDP profile id at save time. |
| `created_at` | timestamptz | NO | 2026-08-22T11:55:00Z | When contact was added to audience. |

---

### `campaign.campaign_agent_sessions`

**Purpose:** Persistent draft workspace for AI agent modules (create-campaign, contacts, monitoring). Large JSON `payload` holds chat, wizard stage, and in-progress campaign state.

**Used by:** Create-campaign agent, contacts agent, session API (`agent-session.ts`), frontend draft URLs `/campaigns/create/{id}`.

**Relationships:** FK `branch_id` → `branches`. Children: `campaign_audience_refs`, `campaign_channel_templates`. Saved campaigns link back via `campaigns.session_id`.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9000000000000000042 | Session id (often agent-supplied bigint). |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `branch_id` | bigint | NO | 1000 | Branch scope. |
| `created_by_user_id` | bigint | NO | 1005 | User who opened the draft. |
| `module` | text | NO | "create_campaign" | Agent module key. |
| `stage` | text | NO | "audience" | Wizard stage: intake, audience, templates, launch_plan. |
| `payload` | jsonb | NO | {"module":"create_campaign","stage":"audience"} | Full agent state JSON. |
| `created_at` | timestamptz | NO | 2026-08-25T09:00:00Z | Session opened. |
| `updated_at` | timestamptz | NO | 2026-08-25T10:30:00Z | Last agent turn. |

---

### `campaign.campaign_audience_refs`

**Purpose:** Draft audience contact list while a campaign is still in agent session — before the campaign row is persisted. Mirrors `campaign_audience` but keyed by session.

**Used by:** Create-campaign agent FILTER_CONTACTS tool, audience panel in draft workspace, save/launch when copying refs to `campaign_audience`.

**Relationships:** Composite PK (`session_id`, `contact_id`). FK `session_id` → `campaign_agent_sessions` CASCADE. Contact ids are CDP `cdp_id` values only.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `session_id` | bigint | NO | 9000000000000000042 | Draft session id. |
| `contact_id` | bigint | NO | 9000000000000000123 | CDP contact ref in draft audience. |

---

### `campaign.campaign_channel_templates`

**Purpose:** Per-channel message template drafts within an agent session. `fields` JSON holds structured content (email blocks, push title/body, etc.) for the frontend editor.

**Used by:** Template editor UI, create-campaign agent CREATE_TEMPLATE tools, save-to-campaign flow.

**Relationships:** FK `session_id` → `campaign_agent_sessions` CASCADE. Children: `campaign_template_messages`. Referenced by `campaign_channels.template_id` after save.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 5001 | Template id (= template_id in API). |
| `session_id` | bigint | NO | 9000000000000000042 | Owning agent session. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `branch_id` | bigint | NO | 1000 | Branch scope. |
| `channel` | text | NO | "email" | Channel this template is for. |
| `logo` | text | YES | "https://cdn.example.com/logo.png" | Optional brand logo URL. |
| `launch_at` | text | YES | "2026-08-26T10:00:00+05:30" | Planned channel launch string. |
| `how_it_works` | text | YES | "Promo email with hero and CTA" | Channel explanation. |
| `fields` | jsonb | NO | {"subject":"Summer Sale — 30% off"} | Structured template content. |
| `generation_batch_id` | bigint | YES | 6001 | Groups AI generation batches. |
| `created_at` | timestamptz | NO | 2026-08-25T09:30:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T10:15:00Z | Updated at. |

---

### `campaign.campaign_template_messages`

**Purpose:** Ordered chat history inside a channel template edit space. Each row is one user or assistant turn when refining template copy via the co-pilot.

**Used by:** Template edit chat UI, agent template refinement tools, audit of AI edits.

**Relationships:** FK `template_id` → `campaign_channel_templates` CASCADE. Unique (`template_id`, `seq`) defines message order.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 7001 | Primary key. |
| `template_id` | bigint | NO | 5001 | Parent channel template. |
| `role` | text | NO | "user" | Message author: user, assistant, or system. |
| `seq` | int | NO | 0 | Zero-based order within template. |
| `kind` | text | NO | "text" | Content type: text or template. |
| `payload` | jsonb | NO | {"text":"Make headline more urgent"} | Message body JSON. |
| `created_at` | timestamptz | NO | 2026-08-25T10:00:00Z | Message timestamp. |

---

### `campaign.channel_sending_profiles`

**Purpose:** Per-organization channel readiness checklist (especially email). Gates whether a channel can send — Configuration UI marks items complete until status is ready.

**Used by:** Configuration page, pre-launch validation, email readiness seed script.

**Relationships:** Unique (`organization_id`, `channel`). No FK to campaigns; applies tenant-wide. `checklist` JSON tracks postal, sender, domain, etc.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8001 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `channel` | text | NO | "email" | Channel being configured. |
| `status` | enum | NO | "ready" | Readiness: not_started, in_progress, ready, blocked. |
| `checklist` | jsonb | YES | {"sender_verified":true,"domain_authenticated":true} | Completion flags. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.push_channel_settings`

**Purpose:** Stores web-push (VAPID) and app-push (FCM/APNs) provider credentials collected in Configuration. Secrets live in `settings` JSON server-side.

**Used by:** Push configuration UI, push send worker, web-push subscription registration.

**Relationships:** Unique (`organization_id`, `channel`) where channel is web_push or app_push. Complements `push_endpoints` which stores per-device subscriptions.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8101 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `channel` | text | NO | "web_push" | Push config type: web_push or app_push. |
| `settings` | jsonb | NO | {"vapid_public_key":"BEl…"} | Provider keys and config. |
| `status` | text | NO | "ready" | Configuration readiness. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.email_org_profiles`

**Purpose:** CAN-SPAM / compliance postal address for email sending — one row per organization. Required before email channel can reach ready status.

**Used by:** Email configuration wizard, footer compliance in templates, ESP send payload.

**Relationships:** Unique `organization_id`. Part of email checklist with senders, domains, return paths, and caps.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8201 | Primary key. |
| `organization_id` | bigint | NO | 1000 | One profile per org. |
| `legal_name` | text | NO | "Worktual" | Legal entity name in footer. |
| `street` | text | NO | "Campaign HQ" | Street address. |
| `city` | text | NO | "London" | City. |
| `country` | text | NO | "UK" | Country. |
| `phone` | text | YES | null | Optional support phone. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.email_senders`

**Purpose:** Verified From addresses for campaign email. Exactly one sender per org should have `is_active=true` — that address is used by the email send worker.

**Used by:** Email configuration, verification flow. Campaign launch From is the org My Accounts mailbox, not these rows.

**Relationships:** Unique (`organization_id`, `from_email`). Works with `email_domains` for authentication. Status moves pending_verification → verified.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8301 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `display_name` | text | NO | "Worktual Team" | From display name. |
| From | text | NO | company mailbox | From email address. Must match authenticated domain rules. |
| `reply_to` | text | YES | null | Optional Reply-To. |
| `status` | text | NO | "verified" | Sender status: pending_verification or verified. |
| `verify_token` | text | YES | null | Email verification token when pending. |
| `verify_expires_at` | timestamptz | YES | null | Token expiry. |
| `verified_at` | timestamptz | YES | 2026-08-25T06:00:00Z | When verified. |
| `is_active` | boolean | NO | true | Active From for worker. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.email_domains`

**Purpose:** Sending domain authentication records (SPF, DKIM, DMARC) and ESP sync state for the customer domain.

**Used by:** Email domain setup UI, ESP domain API, OpenDKIM handoff, send-time From guard.

**Relationships:** Unique (`organization_id`, `domain`). Pairs with `email_senders` and `email_return_paths`. Private DKIM key never exposed to frontend.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8401 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `domain` | text | NO | customer domain | Domain being authenticated. |
| `spf_ok` | boolean | NO | true | SPF check passed. |
| `dkim_ok` | boolean | NO | true | DKIM check passed. |
| `dmarc_ok` | boolean | NO | true | DMARC check passed. |
| `status` | text | NO | "authenticated" | Setup status string. |
| `provider_domain_id` | text | YES | Postfix id | ESP domain id. |
| `dns_records` | jsonb | YES | [] | DNS records for operator paste. |
| `dkim_selector` | text | YES | "campaign" | DKIM selector name. |
| `dkim_public_key` | text | YES | "MIIBIjAN…" | Public key for DNS. |
| `dkim_private_key_encrypted` | text | YES | "aes-gcm:…" | Encrypted PEM — server only. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.email_return_paths`

**Purpose:** Bounce / return-path domain configuration for email deliverability. One row per organization defines where bounces are routed.

**Used by:** Email configuration checklist, ESP return-path verification.

**Relationships:** Unique `organization_id`. Typically same domain family as `email_domains`. Required for email channel ready status.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8501 | Primary key. |
| `organization_id` | bigint | NO | 1000 | One return path per org. |
| `domain` | text | NO | customer domain | Return-path domain. |
| `status` | text | NO | "verified" | Return-path status: not_started or verified. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.email_sending_caps`

**Purpose:** Rate limits, batch sizes, warmup stage, and send health for email. Workers consult caps before enqueueing batches; unhealthy stats can block sending.

**Used by:** Email send worker, configuration UI, auto-pause on bounces/complaints.

**Relationships:** Unique `organization_id`. `health_stats` JSON rolls counters for the current window. Independent of individual campaigns.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8601 | Primary key. |
| `organization_id` | bigint | NO | 1000 | One caps row per org. |
| `batch_size` | int | NO | 20 | Recipients per worker batch. |
| `hourly_cap` | int | NO | 200 | Max sends per hour. |
| `daily_cap` | int | NO | 1000 | Max sends per day. |
| `warmup_stage` | int | NO | 0 | Warmup progression stage. |
| `health_status` | text | NO | "healthy" | Send health: healthy or blocked_sending. |
| `health_stats` | jsonb | YES | {"sent":42,"hardBounce":0} | Rolling health counters. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.email_suppressions`

**Purpose:** Durable suppression list for email addresses that must never receive campaign mail (unsubscribe, hard bounce, spam complaint). Checked before each send.

**Used by:** Email launch, send worker skip logic, unsubscribe link handler.

**Relationships:** Unique (`organization_id`, `email`). Complements per-contact `campaign_contact_engagement.email_unsubscribed`.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8701 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `email` | text | NO | "unsubscribed@example.com" | Suppressed address (lowercase). |
| `reason` | text | NO | "unsub" | Suppression reason: unsub, hard_bounce, complaint. |
| `created_at` | timestamptz | NO | 2026-08-20T14:22:00Z | When suppressed. |

---

### `campaign.sms_channel_settings`

**Purpose:** Per-organization SMS provider configuration including DLT entity id, sender id, and API credentials. One JSON settings bag per org.

**Used by:** SMS configuration UI, SMS send worker (when enabled), regulated template submission.

**Relationships:** Unique `organization_id`. Works with `regulated_channel_templates` where channel=sms for DLT-approved message bodies.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8801 | Primary key. |
| `organization_id` | bigint | NO | 1000 | One SMS config per org. |
| `settings` | jsonb | NO | {"provider":"msg91","sender_id":"WTUAL"} | Provider credentials and ids. |
| `status` | text | NO | "ready" | Configuration readiness. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.regulated_channel_templates`

**Purpose:** SMS (DLT) and WhatsApp (Meta) templates that require external approval before sending. Tracks submission status, provider ids, and rejection reasons.

**Used by:** WhatsApp/SMS configuration UI, Meta sync worker, create-campaign regulated channel flows.

**Relationships:** Scoped by `organization_id`. Optional `channel_config_id` → accounts.setup_channel_configs (internal). Status: draft → pending → approved/rejected.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 8901 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `channel` | text | NO | "whatsapp" | Regulated channel: sms or whatsapp. |
| `name` | text | NO | "order_update_v1" | Template name / external key. |
| `external_id` | text | NO | "order_update_v1" | DLT id or Meta template name. |
| `provider_template_id` | text | YES | "1234567890123456" | Meta Graph template id. |
| `language` | text | NO | "en" | Template language code. |
| `category` | text | NO | "UTILITY" | WhatsApp category. |
| `header` | text | NO | "Order update" | Template header text. |
| `body` | text | NO | "Hi {{1}}, order {{2}} shipped." | Message body with placeholders. |
| `footer` | text | NO | "Reply STOP to opt out" | Footer line. |
| `buttons` | text | NO | "Track order" | Newline-separated button labels. |
| `status` | enum | NO | "approved" | Approval flow: draft, pending, approved, rejected, etc. |
| `rejected_reason` | text | YES | null | Provider rejection reason. |
| `channel_config_id` | bigint | YES | 454094b7 | Internal accounts channel config ref. |
| `submitted_at` | timestamptz | YES | 2026-08-18T09:00:00Z | When submitted to provider. |
| `last_status_checked_at` | timestamptz | YES | 2026-08-25T08:00:00Z | Last Meta/DLT poll. |
| `created_by_user_id` | bigint | YES | 1005 | Submitter user ref. |
| `campaign_name` | text | NO | "Summer Sale" | Campaign context when created. |
| `goal` | text | NO | "Drive revenue" | Goal context. |
| `objective` | text | NO | "Increase conversions" | Objective context. |
| `source_campaign_id` | bigint | YES | 1012 | Optional link to saved campaign. |
| `created_at` | timestamptz | NO | 2026-08-18T08:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T08:00:00Z | Updated at. |

---

### `campaign.campaign_send_batches`

**Purpose:** Queued send slices for a campaign channel run. Workers pick batches where `scheduled_for` <= now and status=queued, then process recipients in `size` chunks.

**Used by:** Email/push/web send workers, launch DAO, monitoring send progress.

**Relationships:** FK `campaign_id` → `campaigns` CASCADE. Unique (`campaign_id`, `channel`, `seq`). Parent of `campaign_send_recipients`.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9101 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `campaign_id` | bigint | NO | 1012 | Campaign being sent. |
| `channel` | text | NO | "email" | Send channel: email, push, web, sms, whatsapp. |
| `seq` | int | NO | 0 | Batch sequence within channel. |
| `scheduled_for` | timestamptz | NO | 2026-08-22T12:00:00Z | When worker may process batch. |
| `status` | text | NO | "done" | Batch status: queued, processing, done, failed. |
| `size` | int | NO | 860 | Number of recipients in batch. |
| `created_at` | timestamptz | NO | 2026-08-22T11:58:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-22T12:45:00Z | Updated at. |

---

### `campaign.campaign_send_recipients`

**Purpose:** One row per recipient per send attempt. Tracks delivery status, ESP message id, A/B variant, and open/click engagement counters for reporting.

**Used by:** Send workers, open/click tracking pixels, monitoring metrics, A/B test evaluation.

**Relationships:** FK `batch_id` → `campaign_send_batches` CASCADE. `contact_id` → CDP (optional). `email` or `destination` holds delivery target depending on channel.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9201 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `batch_id` | bigint | NO | 9101 | Parent send batch. |
| `campaign_id` | bigint | NO | 1012 | Denormalized campaign id. |
| `contact_id` | bigint | YES | 9000000000000000123 | CDP contact ref. |
| `email` | text | YES | "alice@example.com" | Email address when channel=email. |
| `destination` | text | YES | null | Push token or web-push URL. |
| `platform` | text | YES | "web" | Device platform: ios, android, web. |
| `status` | text | NO | "sent" | Delivery status: pending, sent, failed, skipped. |
| `skip_fail_reason` | text | YES | null | Why skipped/failed e.g. suppressed. |
| `provider_message_id` | text | YES | "esp-msg-7f3a9c2b" | ESP tracking id. |
| `attempt_count` | int | NO | 1 | Send retry count. |
| `ab_variant` | text | YES | "a" | A/B bucket: a, b, holdout, winner. |
| `opened_at` | timestamptz | YES | 2026-08-22T12:15:00Z | First open time. |
| `clicked_at` | timestamptz | YES | 2026-08-22T12:18:00Z | First click time. |
| `open_count` | int | NO | 3 | Total open events. |
| `click_count` | int | NO | 1 | Total click events. |
| `created_at` | timestamptz | NO | 2026-08-22T12:00:01Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-22T12:18:00Z | Updated at. |

---

### `campaign.push_endpoints`

**Purpose:** Registered device tokens (app push) and browser push subscriptions (web push) linked to contacts. Launch workers send to active endpoints for audience members.

**Used by:** Web-push registration API, push send worker, audience contact detail (push tokens).

**Relationships:** Unique (`organization_id`, `channel`, `endpoint`). `contact_id` → CDP when matched. `auth_keys` holds web-push p256dh/auth.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9301 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `contact_id` | bigint | YES | 9000000000000000123 | Linked CDP contact. |
| `channel` | text | NO | "web" | Endpoint channel: push (app) or web (browser). |
| `platform` | text | YES | "chrome" | Browser or OS platform. |
| `endpoint` | text | NO | "https://fcm.googleapis.com/fcm/send/…" | Subscription URL or device token. |
| `auth_keys` | jsonb | YES | {"p256dh":"BNcRd…","auth":"tBHIt…"} | Web push encryption keys. |
| `label` | text | YES | "Marketing site" | Human label. |
| `active` | boolean | NO | true | Whether endpoint receives sends. |
| `created_at` | timestamptz | NO | 2026-08-10T08:00:00Z | Registered at. |
| `updated_at` | timestamptz | NO | 2026-08-25T09:00:00Z | Updated at. |

---

### `campaign.website_contacts`

**Purpose:** Visitor-site people who opt in on the marketing website — separate from CDP Audience until explicitly promoted. Stores visit metadata and web-push subscription.

**Used by:** Website sample page, web-push subscription API, launch matching by email/phone.

**Relationships:** Unique (`organization_id`, `visitor_id`). `contact_id` null until promoted to `cdp.customer_profile`. Matched to Audience at launch by email or phone digits.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9401 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `visitor_id` | text | NO | "550e8400-e29b-41d4-a716-446655440000" | Browser visitor uuid. |
| `contact_id` | bigint | YES | null | CDP id after promotion. |
| `email` | text | YES | "visitor@example.com" | Opt-in email. |
| `phone` | text | YES | null | Opt-in phone. |
| `first_name` | text | YES | "Sam" | Visitor first name. |
| `last_name` | text | YES | "Lee" | Visitor last name. |
| `origin` | text | NO | "https://shop.example.com" | Site origin URL. |
| `path` | text | YES | "/summer-sale" | Page path visited. |
| `user_agent` | text | YES | "Mozilla/5.0 …" | Browser user agent. |
| `subscribed` | boolean | NO | true | Notification permission granted. |
| `endpoint` | text | YES | "https://fcm.googleapis.com/fcm/send/…" | Push subscription endpoint. |
| `auth_keys` | jsonb | YES | {"p256dh":"…","auth":"…"} | Web push keys. |
| `platform` | text | YES | "web" | Platform label. |
| `visit_count` | int | NO | 5 | Number of site visits. |
| `first_seen_at` | timestamptz | NO | 2026-08-20T10:00:00Z | First visit. |
| `last_seen_at` | timestamptz | NO | 2026-08-25T10:00:00Z | Most recent visit. |
| `subscribed_at` | timestamptz | YES | 2026-08-21T11:00:00Z | When notifications allowed. |
| `created_at` | timestamptz | NO | 2026-08-20T10:00:00Z | Row created. |
| `updated_at` | timestamptz | NO | 2026-08-25T10:00:00Z | Row updated. |

---

### `campaign.campaign_contact_engagement`

**Purpose:** Campaign-scoped email engagement and unsubscribe state for a CDP contact. Aggregates opens/clicks at contact level across campaigns for consent checks.

**Used by:** Unsubscribe handler, send skip logic, contact detail engagement panel.

**Relationships:** Unique (`organization_id`, `contact_id`). `contact_id` → `cdp.customer_profile.cdp_id`. Per-send detail stays in `campaign_send_recipients`.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9501 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `contact_id` | bigint | NO | 9000000000000000123 | CDP contact ref. |
| `email_unsubscribed` | boolean | NO | false | Tenant-level email opt-out. |
| `email_unsubscribed_at` | timestamptz | YES | null | When user unsubscribed. |
| `email_unsubscribe_reason` | text | YES | null | Reason: user_link, admin, import. |
| `last_email_opened_at` | timestamptz | YES | 2026-08-22T12:15:00Z | Most recent open. |
| `last_email_clicked_at` | timestamptz | YES | 2026-08-22T12:18:00Z | Most recent click. |
| `email_open_count` | int | NO | 12 | Lifetime open count. |
| `email_click_count` | int | NO | 4 | Lifetime click count. |
| `created_at` | timestamptz | NO | 2026-08-01T00:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-22T12:18:00Z | Updated at. |

---

### `campaign.tenant_industry_packs`

**Purpose:** Per-organization industry pack defining recommended contact fields and editable company rules. Seeded from org `industry_type` on first use; grows via agent and admin edits.

**Used by:** Contacts agent field hints, industry pack configuration, B2B vs B2C mode selection.

**Relationships:** Unique `organization_id`. `pack_id` is generic-b2b or generic-b2c. `payload` JSON holds fields[] and rules[] — not enforced as DB constraints.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9601 | Primary key. |
| `organization_id` | bigint | NO | 1000 | One pack row per org. |
| `pack_id` | text | NO | "generic-b2b" | Pack identifier. |
| `seed_industry_type` | text | NO | "Software / SaaS" | From accounts.organizations.industry_type. |
| `payload` | jsonb | NO | {"version":1,"fields":[],"rules":[]} | Field hints and company rules. |
| `created_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T06:00:00Z | Updated at. |

---

### `campaign.campaign_recommendations`

**Purpose:** Tenant-shared AI recommendation cards shown on dashboard and CRM embed. Full card JSON in `payload`; `public_id` is the frontend id (rec-…).

**Used by:** Recommendations agent, dashboard board, CRM iframe postMessage sync.

**Relationships:** Scoped by `organization_id` and `branch_id`. Unique (`organization_id`, `public_id`). Status: creating → active → used/dismissed/expired.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9701 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `branch_id` | bigint | NO | 1000 | Branch scope. |
| `created_by_user_id` | bigint | NO | 1005 | Creator user ref. |
| `public_id` | text | NO | "rec-20260825-winback" | Frontend-visible id. |
| `status` | text | NO | "active" | Card status: creating, active, dismissed, used, expired. |
| `title` | text | NO | "Re-engage dormant trial users" | Card title. |
| `payload` | jsonb | NO | {"channels":["email"]} | Full recommendation JSON. |
| `created_at` | timestamptz | NO | 2026-08-25T08:00:00Z | Created at. |
| `updated_at` | timestamptz | NO | 2026-08-25T09:30:00Z | Updated at. |

---

### `campaign.app_notifications`

**Purpose:** In-app bell notifications for campaign events (template approvals stuck, send failures, etc.). Deduped by `source_key` so the same alert is not inserted twice.

**Used by:** Notification bell UI, proactive agent worker, WhatsApp status sync.

**Relationships:** Unique (`organization_id`, `source_key`). `user_id` null = visible to all users in org. `read_at` null = unread.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 9801 | Primary key. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `user_id` | bigint | YES | 1005 | Target user; null = tenant-wide. |
| `kind` | text | NO | "template_pending" | Notification category. |
| `title` | text | NO | "WhatsApp template pending review" | Short title. |
| `body` | text | NO | "order_update_v1 awaiting Meta approval." | Notification body. |
| `href` | text | YES | "/configuration/whatsapp" | Deep link in SPA. |
| `source_key` | text | NO | "template:pending:8901" | Dedup key. |
| `created_at` | timestamptz | NO | 2026-08-25T08:00:00Z | Created at. |
| `read_at` | timestamptz | YES | null | When user read notification. |

---

## `accounts` schema (7 tables)

Campaign **reads only** — does not migrate or own these tables.

### `accounts.setup_users`

**Purpose:** Worktual account users used for Campaign login. Campaign reads this table only — it does not create or alter account users.

**Used by:** Auth login handler, JWT session build, CRM access JWT validation, role resolution.

**Relationships:** `organization_id` → `accounts.organizations`. Roles via `setup_user_product_access`. Password verified against `password_hash`; status must be active.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 1005 | Primary key; JWT sub claim. |
| `work_email` | text | NO | "priya.sharma@company.com" | Login email (unique per org context). |
| `password_hash` | text | NO | "$2b$10$…" | Bcrypt hash; never returned to client. |
| `first_name` | text | NO | "Priya" | Given name for display. |
| `last_name` | text | NO | "Sharma" | Family name for display. |
| `status` | text | NO | "active" | Must be active to log in. |
| `organization_id` | bigint | NO | 1000 | Home organization; drives organizationId in session. |

---

### `accounts.organizations`

**Purpose:** Tenant organization profile shared across Worktual products. Campaign uses business_type for B2B/B2C mode and industry_type to seed industry packs.

**Used by:** Login session (org name, mode), industry pack seed, entitlement scoping.

**Relationships:** Parent of setup_users.organization_id and all campaign.organization_id rows. Not owned by Campaign microservice.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 1000 | Organization id (= organization_id everywhere). |
| `company_name` | text | YES | "Acme Retail Pvt Ltd" | Display name in UI. |
| `business_type` | text | YES | "B2B" | B2B or B2C — sets campaign mode. |
| `industry_type` | text | YES | "Software / SaaS" | Seeds tenant_industry_packs. |

---

### `accounts.setup_user_product_access`

**Purpose:** Maps users to roles within an organization for each product. Campaign reads this join to resolve the user role name shown in session.

**Used by:** Auth role resolution (`resolveRoleName`), admin vs marketing permission checks.

**Relationships:** Joins setup_users.user_id + organization_id to setup_roles.role_id. One user may have multiple product access rows.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `user_id` | bigint | NO | 1005 | User ref. |
| `organization_id` | bigint | NO | 1000 | Org ref. |
| `role_id` | bigint | NO | 3001 | Role ref → setup_roles. |

---

### `accounts.setup_roles`

**Purpose:** Named roles (admin, marketing, sales_manager, etc.) assigned to users via product access. Campaign uses role name in JWT and UI.

**Used by:** Auth role lookup, future RBAC gates.

**Relationships:** Referenced by setup_user_product_access.role_id. Read-only from Campaign.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 3001 | Role primary key. |
| `name` | text | NO | "admin" | Role slug shown in session.role. |

---

### `accounts.setup_channel_configs`

**Purpose:** Cross-product channel integrations (WhatsApp Meta connection, email channel rows) managed in Accounts. Campaign Configuration UI reads these for regulated sends.

**Used by:** Configuration handler, regulated_channel_templates.channel_config_id resolution, WhatsApp worker.

**Relationships:** Scoped by organization_id. Referenced internally by regulated templates — id never exposed to frontend UI.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 454094b7 | Channel config id. |
| `organization_id` | bigint | NO | 1000 | Owning org. |
| `channel_type` | text | NO | "whatsapp" | Integration type e.g. whatsapp, email. |
| `name` | text | NO | "Meta WhatsApp Business" | Display name. |
| `status` | text | NO | "active" | Config status e.g. active, pending. |
| `product_ids` | jsonb | NO | ["campaign"] | Products allowed to use config. |

---

### `accounts.setup_email_configs`

**Purpose:** My Accounts mailbox configuration for test sends from the user connected inbox. Campaign reads From address metadata — not used for bulk campaign ESP sends.

**Used by:** accounts-email-mailbox DAO for mailbox test send feature.

**Relationships:** Pairs with mail_oauth_connections for OAuth refresh tokens. Read-only from Campaign; owned by Accounts product.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 1 | Config row id. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `from_address` | text | NO | "user@company.com" | Mailbox From address. |
| `display_name` | text | YES | "Priya Sharma" | Sender display name. |
| `status` | text | NO | "active" | Mailbox connection status. |

---

### `accounts.mail_oauth_connections`

**Purpose:** Encrypted OAuth tokens for connected mailboxes (Google/Microsoft). Used for campaign and test send via the org My Accounts mailbox.

**Used by:** accounts-email-mailbox DAO. Tokens encrypted with MS_TOKEN_ENCRYPTION_KEY.

**Relationships:** Linked to setup_email_configs by organization/user. Never log or return refresh tokens to frontend.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `id` | bigint | NO | 1 | Connection id. |
| `organization_id` | bigint | NO | 1000 | Org scope. |
| `provider` | text | NO | "google" | OAuth provider: google or microsoft. |
| `email` | text | NO | "user@company.com" | Connected mailbox. |
| `refresh_token_encrypted` | text | NO | "aes-gcm:…" | Encrypted token — server only. |
| `status` | text | NO | "active" | Connection status. |

---

## `cdp` schema (2 tables)

Campaign may CRUD **existing columns only** — no ALTER on CDP from Campaign.

### `cdp.customer_profile`

**Purpose:** Canonical contact profile in the CDP. Campaign Audience lists, creates, updates, and soft-deletes contacts here — storing only cdp_id refs in campaign tables.

**Used by:** contact.ts DAO, Audience UI, create-campaign FILTER_CONTACTS, send recipient resolution.

**Relationships:** Primary key cdp_id referenced as contact_id in campaign tables. Identities in identity_keys. Soft delete via custom_fields.campaign_deleted=true.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `cdp_id` | bigint | NO | 9000000000000000123 | Primary key; stored as contact_id in campaign. |
| `organization_id` | bigint | NO | 1000 | Org scope — must match session org. |
| `first_name` | text | YES | "Alice" | Contact first name. |
| `last_name` | text | YES | "Nguyen" | Contact last name. |
| `company` | text | YES | "Northwind Labs" | Company name (API: company_name). |
| `city` | text | YES | "Chennai" | City. |
| `custom_fields` | jsonb | YES | {"job_title":"Head of Growth","score":82} | Extra attributes JSON. |
| `created_at` | timestamptz | NO | 2026-07-01T08:00:00Z | Profile created. |
| `updated_at` | timestamptz | NO | 2026-08-25T09:00:00Z | Profile updated. |
| `first_seen_at` | timestamptz | YES | 2026-07-01T08:00:00Z | First seen timestamp. |
| `last_seen_at` | timestamptz | YES | 2026-08-25T09:00:00Z | Last activity timestamp. |
| `acquisition_channel` | text | YES | "campaign" | Set to campaign on insert from Campaign UI. |

---

### `cdp.identity_keys`

**Purpose:** Email and phone identity rows pointing to a customer_profile. Enables lookup by email/phone and enforces uniqueness per org.

**Used by:** contact.ts upsert/findIdentityOwner, audience import, web-push matching by email.

**Relationships:** FK cdp_id → customer_profile.cdp_id. Multiple keys per profile (email + phone). Campaign sets source_system=campaign on keys it creates.

| Column | Type | Nullable | Example | Description |
|--------|------|----------|---------|-------------|
| `identity_id` | uuid | NO | "a1b2c3d4-e5f6-7890-abcd-ef1234567890" | Primary key uuid. |
| `cdp_id` | bigint | NO | 9000000000000000123 | Profile this key belongs to. |
| `organization_id` | bigint | NO | 1000 | Org scope for uniqueness. |
| `key_type` | text | NO | "email" | Identity type: email, primary_email, phone, mobile. |
| `key_value` | text | NO | "alice@example.com" | Normalized email or phone digits. |
| `source_system` | text | NO | "campaign" | Originating system. |
| `verified` | boolean | NO | true | Whether identity is verified. |
| `created_at` | timestamptz | NO | 2026-07-01T08:00:00Z | Key created. |
| `custom_fields` | jsonb | YES | {} | Optional metadata. |

---

## Data flow summary

```text
Login     → accounts.setup_users + organizations → session.organizationId
Draft     → campaign_agent_sessions (+ audience_refs, channel_templates)
Save      → campaigns + campaign_channels + campaign_audience
Configure → email_* / push_channel_settings / channel_sending_profiles
Launch    → campaign_send_batches → campaign_send_recipients
Contacts  → cdp.customer_profile + cdp.identity_keys (refs in campaign tables)
```

## Related documentation

| Document | Purpose |
|----------|---------|
| [`CAMPAIGN_DATABASE_SCHEMA.md`](CAMPAIGN_DATABASE_SCHEMA.md) | Column reference without extended descriptions |
| [`CAMPAIGN_DATABASE_SCHEMA_SAMPLES.md`](CAMPAIGN_DATABASE_SCHEMA_SAMPLES.md) | Sample values and JSON payload examples |
| [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma) | Prisma source of truth |
