# Campaign database — column descriptions

**File purpose:** Detailed explanation of **every column** in every table used by the Campaign microservice.

**Source:** [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma)  
**Database:** PostgreSQL `worktual_bigint` — schemas `campaign`, `accounts`, `cdp`  
**Related docs:** [`CAMPAIGN_DATABASE_TABLES_REFERENCE.md`](CAMPAIGN_DATABASE_TABLES_REFERENCE.md) (table overview), [`CAMPAIGN_DATABASE_SCHEMA.md`](CAMPAIGN_DATABASE_SCHEMA.md) (schema reference)

---

## How to read this document

For each table you get a one-line summary, then a column table with:

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| Column name | PostgreSQL type | Sample value | What the column means, how the app uses it, and constraints |

**Organization scoping:** Most `campaign` tables use `organization_id` (= `accounts.organizations.id`). The API exposes this as `organizationId` in JWT/session JSON.

---

# campaign schema

## `campaign.branches`

Workspace branches under an organization; campaigns and agent sessions are branch-scoped.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 1000 | Autoincrement primary key. Serialized as a string in API responses. Never reuse across orgs. |
| `organization_id` | bigint | 1000 | Foreign logical reference to accounts.organizations.id. Every query filters by this for tenant isolation. |
| `name` | text | "Default" | Human-readable branch label shown in admin UI when multiple branches exist. |
| `is_default` | boolean | true | When true, this branch is used when the API needs a default workspace for the org. Only one should be default per org. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Timestamp when the branch row was first inserted, usually on first login provisioning. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Automatically updated on any change via Prisma @updatedAt. |

## `campaign.organization_products`

Product entitlements (Campaign, CRM) per org and branch; login requires active campaign product.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 1 | Surrogate primary key for the entitlement row. |
| `organization_id` | bigint | 1000 | Organization that owns this product license. Matches accounts org id. |
| `branch_id` | bigint | 1000 | Branch the entitlement applies to. FK to campaign.branches.id with CASCADE delete. |
| `product_code` | enum (ProductCode) | "campaign" | Which Worktual product is licensed: campaign or crm. Campaign login checks for campaign + active. |
| `status` | enum (ProductStatus) | "active" | Whether the entitlement is active or inactive. Inactive blocks product access. |
| `starts_at` | timestamptz | 2026-08-25T06:00:00Z | Optional start of entitlement window. Null means no explicit start. |
| `ends_at` | timestamptz | null | Optional expiry. Null means open-ended. Compared at login to ensure still valid. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | When entitlement was first recorded. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Last modification time. |

## `campaign.campaigns`

Saved marketing campaigns after agent save/launch; holds audience snapshot and launch metrics.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 1012 | Campaign primary key. Used in URLs, monitoring, and send batch foreign keys. |
| `organization_id` | bigint | 1000 | Owning organization. All list/detail queries scope by this. |
| `branch_id` | bigint | 1000 | Workspace branch. FK to branches.id. |
| `name` | text | "Demo · Summer Sale Blast" | Display name in monitoring, dashboard, and reports. |
| `description` | text | "Live email promo…" | Optional longer description for internal context. |
| `status` | enum (CampaignStatus) | "live" | Lifecycle state: draft (editing), scheduled (future start), live (sending), completed, cancelled. Drives monitoring buckets. |
| `starts_at` | timestamptz | 2026-08-22T12:00:00Z | UTC instant when campaign becomes active. Used by schedulers and monitoring. |
| `ends_at` | timestamptz | 2026-09-05T12:00:00Z | UTC end instant. Null if open-ended. |
| `source_channel` | enum (SourceChannel) | "standalone_campaign" | Where campaign originated: standalone Campaign SPA or crm_marketing embed. |
| `created_by_user_id` | bigint | 1005 | accounts.setup_users.id of creator. Not a DB FK but logical user ref. |
| `created_at` | timestamptz | 2026-08-19T08:00:00Z | Row creation time. |
| `updated_at` | timestamptz | 2026-08-25T10:00:00Z | Last update; changes on status/metrics updates. |
| `goal` | text | "Drive seasonal revenue" | Business goal captured by create-campaign agent. |
| `objective` | text | "Increase checkout conversions" | Measurable objective paired with goal. |
| `session_id` | bigint | 9000000000000000042 | Unique link back to campaign_agent_sessions.id that produced this save. Null if created outside agent. |
| `audience_summary` | text | "Contacts in Chennai with email" | Human-readable audience description for UI. |
| `audience_filters` | jsonb | {"city":"Chennai"} | JSON snapshot of filters used to build audience at save time. Not live CDP query. |
| `audience_count` | int | 1200 | Number of contacts in audience when saved/launched. Denormalized for fast display. |
| `launch_plan` | jsonb | {"channel_run":{…}} | Schedule, channel order, A/B settings, and per-channel run metrics (sent, opens, clicks). Updated during/after send. |
| `launch_local_date` | text | "2026-06-05" | Local calendar date (YYYY-MM-DD) in campaign timezone for operator display. |
| `launch_local_time` | text | "12:00" | Local clock time (HH:mm) in campaign timezone. |
| `timezone` | text | "Asia/Kolkata" | IANA timezone for interpreting local date/time fields. Default Asia/Kolkata. |

## `campaign.campaign_channels`

One row per channel enabled on a saved campaign.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 4001 | Primary key for the channel row. |
| `campaign_id` | bigint | 1012 | Parent campaign. FK with ON DELETE CASCADE. |
| `organization_id` | bigint | 1000 | Denormalized org id for tenant-scoped indexes without joining campaigns. |
| `channel` | text | "email" | Channel slug: email, sms, whatsapp, push, web, ppc, etc. Unique per campaign. |
| `template_id` | bigint | 5001 | Optional reference to campaign_channel_templates.id used for this channel. |
| `how_it_works` | text | "Email drip with…" | Free-text plan explaining channel behavior in overview UI. |
| `planned_launch_at` | text | "2026-08-22T12:00:00Z" | Planned launch as string (may be ISO or local display string from agent). |
| `status` | text | "ready" | Channel readiness within campaign context (e.g. ready, paused). |
| `created_at` | timestamptz | 2026-08-19T08:00:00Z | Created timestamp. |
| `updated_at` | timestamptz | 2026-08-25T10:00:00Z | Updated timestamp. |

## `campaign.campaign_audience`

Frozen CDP contact refs attached to a saved campaign at launch.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `campaign_id` | bigint | 1012 | Part of composite PK. FK to campaigns.id CASCADE. |
| `contact_id` | bigint | 9000000000000000123 | Part of composite PK. Logical ref to cdp.customer_profile.cdp_id — not a Prisma FK. |
| `created_at` | timestamptz | 2026-08-22T11:55:00Z | When this contact was snapshotted into campaign audience. |

## `campaign.campaign_agent_sessions`

Persistent AI agent draft sessions (create-campaign, contacts, monitoring).

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9000000000000000042 | Session primary key; often appears in URL /campaigns/create/{id}. May be client-supplied bigint. |
| `organization_id` | bigint | 1000 | Org scope for session isolation. |
| `branch_id` | bigint | 1000 | Branch scope. FK to branches.id. |
| `created_by_user_id` | bigint | 1005 | User who opened the session. |
| `module` | text | "create_campaign" | Agent module: create_campaign, contacts, monitoring, etc. |
| `stage` | text | "audience" | Wizard stage within module: intake, audience, templates, launch_plan, … |
| `payload` | jsonb | {…} | Full agent state: chat messages, campaign draft, audience filters, launch plan, flags. Large JSON document. |
| `created_at` | timestamptz | 2026-08-25T09:00:00Z | Session opened. |
| `updated_at` | timestamptz | 2026-08-25T10:30:00Z | Last agent turn or autosave. |

## `campaign.campaign_audience_refs`

Draft audience contact list while campaign is still in agent session.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `session_id` | bigint | 9000000000000000042 | Composite PK; FK to campaign_agent_sessions.id CASCADE. |
| `contact_id` | bigint | 9000000000000000123 | Composite PK; CDP cdp_id ref only — no embedded contact data. |

## `campaign.campaign_channel_templates`

Per-channel message templates in an agent session before campaign save.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 5001 | Template id (template_id in API). Autoincrement. |
| `session_id` | bigint | 9000000000000000042 | Owning agent session. FK CASCADE. |
| `organization_id` | bigint | 1000 | Org scope. |
| `branch_id` | bigint | 1000 | Branch scope. |
| `channel` | text | "email" | Which channel this template belongs to. |
| `logo` | text | "https://cdn…/logo.png" | Optional brand logo URL for template header. |
| `launch_at` | text | "2026-08-26T10:00:00+05:30" | Planned send time string for this channel template. |
| `how_it_works` | text | "Promo email with hero" | Short explanation of template intent. |
| `fields` | jsonb | {"subject":"…"} | Structured template body: email blocks, push title/body, SMS text, etc. Schema varies by channel. |
| `generation_batch_id` | bigint | 6001 | Optional batch id grouping AI-generated template variants. |
| `created_at` | timestamptz | 2026-08-25T09:30:00Z | Template created. |
| `updated_at` | timestamptz | 2026-08-25T10:15:00Z | Template last edited. |

## `campaign.campaign_template_messages`

Ordered co-pilot chat messages inside a channel template editor.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 7001 | Message row primary key. |
| `template_id` | bigint | 5001 | Parent template. FK CASCADE. |
| `role` | text | "user" | Who sent the message: user, assistant, or system. |
| `seq` | int | 0 | Zero-based sequence within template; unique with template_id. |
| `kind` | text | "text" | Payload type: text (chat) or template (structured content update). |
| `payload` | jsonb | {"text":"…"} | Message content JSON; shape depends on kind. |
| `created_at` | timestamptz | 2026-08-25T10:00:00Z | When message was recorded. |

## `campaign.channel_sending_profiles`

Per-org channel readiness checklist (email gate and future channels).

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8001 | Primary key. |
| `organization_id` | bigint | 1000 | One profile row per org per channel (unique pair). |
| `channel` | text | "email" | Channel being configured. |
| `status` | enum (ChannelConfigStatus) | "ready" | Overall readiness: not_started, in_progress, ready, blocked. Blocks launch when not ready. |
| `checklist` | jsonb | {"sender_verified":true} | Boolean flags for setup steps: postal, sender, domain, return path, compliance, etc. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated when checklist changes. |

## `campaign.push_channel_settings`

Web-push and app-push provider credentials per organization.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8101 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope; unique with channel. |
| `channel` | text | "web_push" | Config channel id: web_push or app_push. |
| `settings` | jsonb | {"vapid_public_key":"…"} | Provider config bag. VAPID keys for web; FCM/APNs for app. Secrets stored server-side only. |
| `status` | text | "ready" | Setup completion status string. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated. |

## `campaign.email_org_profiles`

CAN-SPAM postal identity — one compliance profile per org.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8201 | Primary key. |
| `organization_id` | bigint | 1000 | Unique — one org profile row per tenant. |
| `legal_name` | text | "Worktual" | Legal entity name printed in email footers. |
| `street` | text | "Campaign HQ" | Street address line for compliance block. |
| `city` | text | "London" | City in compliance block. |
| `country` | text | "UK" | Country in compliance block. |
| `phone` | text | null | Optional support phone in footer. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated. |

## `campaign.email_senders`

Verified From addresses; one active sender drives bulk email worker.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8301 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. Unique with from_email. |
| `display_name` | text | "Worktual Team" | Friendly From name recipients see. |
| `from_email` | text | company mailbox | SMTP/mailbox From address. Must match authenticated domain rules. |
| `reply_to` | text | null | Optional Reply-To header. |
| `status` | text | "verified" | Verification state: pending_verification until link clicked, then verified. |
| `verify_token` | text | null | One-time token emailed for verification; cleared after verify. |
| `verify_expires_at` | timestamptz | null | Token expiry for pending senders. |
| `verified_at` | timestamptz | 2026-08-25T06:00:00Z | When verification completed. |
| `is_active` | boolean | true | Exactly one true per org selects the From address used by email-send-worker. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated. |

## `campaign.email_domains`

Sending domain authentication (SPF/DKIM/DMARC) and ESP sync.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8401 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. Unique with domain name. |
| `domain` | text | customer domain | Domain being authenticated for sending. |
| `spf_ok` | boolean | true | Operator/ESP confirmed SPF record valid. |
| `dkim_ok` | boolean | true | DKIM DNS record valid. |
| `dmarc_ok` | boolean | true | DMARC policy check passed. |
| `status` | text | "authenticated" | Overall domain setup status for UI. |
| `provider_domain_id` | text | Postfix numeric id | ESP-side domain identifier. |
| `dns_records` | jsonb | [] | DNS records to paste at registrar; returned from ESP onboarding. |
| `dkim_selector` | text | "campaign" | DKIM DNS selector subdomain (campaign._domainkey). |
| `dkim_public_key` | text | "MIIBIj…" | Base64 public key for DNS p= record. |
| `dkim_private_key_encrypted` | text | "aes-gcm:…" | Encrypted PEM private key for signing; never sent to frontend. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated. |

## `campaign.email_return_paths`

Bounce/return-path domain — one row per org.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8501 | Primary key. |
| `organization_id` | bigint | 1000 | Unique per org. |
| `domain` | text | customer domain | Return-path/bounce domain configured at ESP. |
| `status` | text | "verified" | Setup status: not_started until verified. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated. |

## `campaign.email_sending_caps`

Rate limits, batch size, warmup, and send health counters.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8601 | Primary key. |
| `organization_id` | bigint | 1000 | Unique — one caps row per org. |
| `batch_size` | int | 20 | Max recipients processed per worker tick. |
| `hourly_cap` | int | 200 | Hard stop on sends per rolling hour. |
| `daily_cap` | int | 1000 | Hard stop on sends per rolling day. |
| `warmup_stage` | int | 0 | Warmup progression index; may increase allowed volume over time. |
| `health_status` | text | "healthy" | healthy allows sending; blocked_sending pauses all campaign email. |
| `health_stats` | jsonb | {"sent":42,"hardBounce":0} | Rolling window counters: sent, hardBounce, complaint, windowStart. Used for auto-pause. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated. |

## `campaign.email_suppressions`

Global do-not-send list for email addresses at org level.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8701 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. Unique with email address. |
| `email` | text | "unsub@example.com" | Normalized email that must never receive campaign mail. |
| `reason` | text | "unsub" | Why suppressed: unsub (user link), hard_bounce, complaint (spam report). |
| `created_at` | timestamptz | 2026-08-20T14:22:00Z | When address was added to suppression list. |

## `campaign.sms_channel_settings`

SMS/DLT provider configuration — one JSON settings row per org.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8801 | Primary key. |
| `organization_id` | bigint | 1000 | Unique per org. |
| `settings` | jsonb | {"provider":"msg91"} | Provider API URL, sender id, entity id, api_key, etc. Secrets server-side. |
| `status` | text | "ready" | Configuration readiness. |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated. |

## `campaign.regulated_channel_templates`

SMS (DLT) and WhatsApp (Meta) templates requiring external approval.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 8901 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. |
| `channel` | text | "whatsapp" | Regulated channel: sms or whatsapp. |
| `name` | text | "order_update_v1" | Internal/template name; for WhatsApp often matches Meta template name. |
| `external_id` | text | "order_update_v1" | DLT template id (SMS) or external provider key. |
| `provider_template_id` | text | "1234567890123456" | Meta Graph API template id once created. |
| `language` | text | "en" | ISO language code for template. |
| `category` | text | "UTILITY" | WhatsApp template category (MARKETING, UTILITY, …). |
| `header` | text | "Order update" | Optional template header line. |
| `body` | text | "Hi {{1}}…" | Message body with provider placeholders {{1}}, {{2}}. |
| `footer` | text | "Reply STOP…" | Optional footer line. |
| `buttons` | text | "Track order" | Newline-separated quick-reply or CTA button labels. |
| `status` | enum (RegulatedTemplateStatus) | "approved" | Approval lifecycle: draft → pending → approved/rejected/paused/disabled. |
| `rejected_reason` | text | null | Provider rejection message when status=rejected. |
| `channel_config_id` | bigint | 454094b7 | Internal ref to accounts.setup_channel_configs.id; never expose UUID to UI. |
| `submitted_at` | timestamptz | 2026-08-18T09:00:00Z | When submitted to DLT/Meta. |
| `last_status_checked_at` | timestamptz | 2026-08-25T08:00:00Z | Last polling time from status sync worker. |
| `created_by_user_id` | bigint | 1005 | User who created/submitted template. |
| `campaign_name` | text | "Summer Sale" | Campaign context copied at creation. |
| `goal` | text | "Drive revenue" | Goal context at creation. |
| `objective` | text | "Increase conversions" | Objective context at creation. |
| `source_campaign_id` | bigint | 1012 | Optional link to campaigns.id if created from a campaign. |
| `created_at` | timestamptz | 2026-08-18T08:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T08:00:00Z | Updated on status/content changes. |

## `campaign.campaign_send_batches`

Queued send slices per campaign and channel for background workers.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9101 | Batch primary key. |
| `organization_id` | bigint | 1000 | Org scope for worker index queries. |
| `campaign_id` | bigint | 1012 | Campaign being sent. FK CASCADE. |
| `channel` | text | "email" | Channel this batch belongs to: email, push, web, sms, whatsapp. |
| `seq` | int | 0 | Sequence number within campaign+channel; unique triple with campaign_id and channel. |
| `scheduled_for` | timestamptz | 2026-08-22T12:00:00Z | Worker picks batch when now >= scheduled_for and status=queued. |
| `status` | text | "done" | queued → processing → done or failed. |
| `size` | int | 860 | Number of recipient rows expected in this batch. |
| `created_at` | timestamptz | 2026-08-22T11:58:00Z | Batch created at launch. |
| `updated_at` | timestamptz | 2026-08-22T12:45:00Z | Updated when processing completes. |

## `campaign.campaign_send_recipients`

Per-recipient send outcome and engagement tracking.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9201 | Recipient row primary key. |
| `organization_id` | bigint | 1000 | Org scope. |
| `batch_id` | bigint | 9101 | Parent batch. FK CASCADE. |
| `campaign_id` | bigint | 1012 | Denormalized campaign id for reporting without joining batch. |
| `contact_id` | bigint | 9000000000000000123 | Optional CDP contact ref. |
| `email` | text | "alice@example.com" | Destination email when channel is email; null for push-only. |
| `destination` | text | null | Push device token or web-push subscription URL when not email. |
| `platform` | text | "web" | Client platform: ios, android, web, etc. |
| `status` | text | "sent" | pending (queued), sent, failed, skipped (suppressed/no endpoint). |
| `skip_fail_reason` | text | null | Machine reason when skipped/failed e.g. suppressed, invalid_email, no_endpoint. |
| `provider_message_id` | text | "esp-msg-7f3a" | ESP or FCM message id for support lookups. |
| `attempt_count` | int | 1 | Number of send attempts (retries increment this). |
| `ab_variant` | text | "a" | Email A/B bucket: a, b, holdout, or winner after test completes. |
| `opened_at` | timestamptz | 2026-08-22T12:15:00Z | First open pixel hit timestamp. |
| `clicked_at` | timestamptz | 2026-08-22T12:18:00Z | First tracked link click timestamp. |
| `open_count` | int | 3 | Total open events including repeats. |
| `click_count` | int | 1 | Total click events including repeats. |
| `created_at` | timestamptz | 2026-08-22T12:00:01Z | Row created when batch materialized. |
| `updated_at` | timestamptz | 2026-08-22T12:18:00Z | Updated on status or engagement events. |

## `campaign.push_endpoints`

Registered app-push tokens and web-push subscriptions linked to contacts.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9301 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. Unique with channel+endpoint. |
| `contact_id` | bigint | 9000000000000000123 | Optional CDP link after registration matches contact. |
| `channel` | text | "web" | push (mobile app) or web (browser subscription). |
| `platform` | text | "chrome" | OS or browser identifier. |
| `endpoint` | text | "https://fcm.googleapis.com/…" | Opaque subscription URL or device token string. |
| `auth_keys` | jsonb | {"p256dh":"…","auth":"…"} | Web Push encryption keys; required for web channel sends. |
| `label` | text | "Marketing site" | Optional human label for debugging. |
| `active` | boolean | true | Inactive endpoints are skipped at launch. |
| `created_at` | timestamptz | 2026-08-10T08:00:00Z | First registration. |
| `updated_at` | timestamptz | 2026-08-25T09:00:00Z | Last refresh of subscription. |

## `campaign.website_contacts`

Marketing-site visitors who opt in — separate from CDP until promoted.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9401 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. Unique with visitor_id. |
| `visitor_id` | text | "550e8400-…" | Stable browser visitor uuid from sample site. |
| `contact_id` | bigint | null | Set when visitor is promoted/matched to cdp.customer_profile. |
| `email` | text | "visitor@example.com" | Email entered on opt-in form. |
| `phone` | text | null | Optional phone from opt-in form. |
| `first_name` | text | "Sam" | Visitor first name if provided. |
| `last_name` | text | "Lee" | Visitor last name if provided. |
| `origin` | text | "https://shop.example.com" | Site origin where visitor was tracked. |
| `path` | text | "/summer-sale" | Last or signup page path. |
| `user_agent` | text | "Mozilla/5.0…" | Browser user agent string. |
| `subscribed` | boolean | true | True after notification permission granted and subscription stored. |
| `endpoint` | text | "https://fcm…" | Web-push subscription endpoint after Allow. |
| `auth_keys` | jsonb | {"p256dh":"…"} | Web-push keys paired with endpoint. |
| `platform` | text | "web" | Platform label, usually web. |
| `visit_count` | int | 5 | Incremented on repeat page loads. |
| `first_seen_at` | timestamptz | 2026-08-20T10:00:00Z | First site visit timestamp. |
| `last_seen_at` | timestamptz | 2026-08-25T10:00:00Z | Most recent visit. |
| `subscribed_at` | timestamptz | 2026-08-21T11:00:00Z | When push subscription was saved. |
| `created_at` | timestamptz | 2026-08-20T10:00:00Z | Row created. |
| `updated_at` | timestamptz | 2026-08-25T10:00:00Z | Row updated. |

## `campaign.campaign_contact_engagement`

Org-level email engagement and unsubscribe state per CDP contact.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9501 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. Unique with contact_id. |
| `contact_id` | bigint | 9000000000000000123 | CDP cdp_id. One engagement row per contact per org. |
| `email_unsubscribed` | boolean | false | True if contact opted out of campaign email for this org. |
| `email_unsubscribed_at` | timestamptz | null | When unsubscribe happened. |
| `email_unsubscribe_reason` | text | null | How unsub occurred: user_link, admin, import. |
| `last_email_opened_at` | timestamptz | 2026-08-22T12:15:00Z | Most recent open across all campaigns. |
| `last_email_clicked_at` | timestamptz | 2026-08-22T12:18:00Z | Most recent click across all campaigns. |
| `email_open_count` | int | 12 | Lifetime open count aggregated at contact level. |
| `email_click_count` | int | 4 | Lifetime click count aggregated at contact level. |
| `created_at` | timestamptz | 2026-08-01T00:00:00Z | First engagement record. |
| `updated_at` | timestamptz | 2026-08-22T12:18:00Z | Last engagement update. |

## `campaign.tenant_industry_packs`

Industry-specific contact field hints and company rules per org.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9601 | Primary key. |
| `organization_id` | bigint | 1000 | Unique — one pack row per org. |
| `pack_id` | text | "generic-b2b" | Pack identifier: generic-b2b or generic-b2c. |
| `seed_industry_type` | text | "Software / SaaS" | Copy of accounts.organizations.industry_type at seed time. |
| `payload` | jsonb | {"fields":[],"rules":[] } | JSON document with version, mode, fields[] (ask hints), rules[] (company policies). |
| `created_at` | timestamptz | 2026-08-25T06:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T06:00:00Z | Updated when pack edited. |

## `campaign.campaign_recommendations`

AI recommendation cards on dashboard and CRM embed.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9701 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. |
| `branch_id` | bigint | 1000 | Branch scope. |
| `created_by_user_id` | bigint | 1005 | User who created the recommendation. |
| `public_id` | text | "rec-20260825-winback" | Stable frontend id (rec-…). Unique per org. |
| `status` | text | "active" | creating, active, dismissed, used, expired, deleted. |
| `title` | text | "Re-engage dormant users" | Card headline in UI. |
| `payload` | jsonb | {"channels":["email"]} | Full card JSON: audience hints, chat, edit log. PII stripped before save. |
| `created_at` | timestamptz | 2026-08-25T08:00:00Z | Created. |
| `updated_at` | timestamptz | 2026-08-25T09:30:00Z | Updated. |

## `campaign.app_notifications`

In-app notification bell entries with deduplication.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 9801 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. |
| `user_id` | bigint | 1005 | Target user; null means visible to all users in the org. |
| `kind` | text | "template_pending" | Category for styling and routing e.g. template_pending, send_failed. |
| `title` | text | "WhatsApp template pending" | Short notification title. |
| `body` | text | "order_update_v1 awaiting approval" | Notification body text. |
| `href` | text | "/configuration/whatsapp" | Optional SPA deep link when clicked. |
| `source_key` | text | "template:pending:8901" | Dedup key; unique per org prevents duplicate alerts. |
| `created_at` | timestamptz | 2026-08-25T08:00:00Z | When notification was created. |
| `read_at` | timestamptz | null | Null until user marks read or opens bell item. |

# accounts schema

Campaign reads these tables via ACCOUNT_DATABASE_URL; does not own or migrate them.

## `accounts.setup_users`

Worktual login users — Campaign reads only, never writes schema.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 1005 | Primary key and JWT sub claim. |
| `work_email` | text | "priya.sharma@company.com" | Login email; matched case-insensitively at auth. |
| `password_hash` | text | "$2b$10$…" | Bcrypt hash; plain password never stored. |
| `first_name` | text | "Priya" | Given name for session display. |
| `last_name` | text | "Sharma" | Family name for session display. |
| `status` | text | "active" | Must be active to authenticate; inactive returns 401. |
| `organization_id` | bigint | 1000 | Home org; becomes session.organizationId after login. |

## `accounts.organizations`

Tenant company profile shared across Worktual products.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 1000 | Organization primary key used as organization_id everywhere. |
| `company_name` | text | "Acme Retail Pvt Ltd" | Display name in header and session orgName. |
| `business_type` | text | "B2B" | B2B vs B2C — drives campaign mode and industry pack selection. |
| `industry_type` | text | "Software / SaaS" | Free-text industry used to seed tenant_industry_packs. |

## `accounts.setup_user_product_access`

Maps users to roles within an organization.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `user_id` | bigint | 1005 | FK logical ref to setup_users.id. |
| `organization_id` | bigint | 1000 | Org the access grant applies to. |
| `role_id` | bigint | 3001 | FK logical ref to setup_roles.id. |

## `accounts.setup_roles`

Named roles assigned via product access.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 3001 | Role primary key. |
| `name` | text | "admin" | Role slug returned in session.role (admin, marketing, …). |

## `accounts.setup_channel_configs`

Cross-product channel integrations (WhatsApp, email) — read in Configuration.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 454094b7 | Channel config primary key; referenced internally by regulated templates. |
| `organization_id` | bigint | 1000 | Owning org. |
| `channel_type` | text | "whatsapp" | Integration type slug. |
| `name` | text | "Meta WhatsApp Business" | Display name in admin UI. |
| `status` | text | "active" | Whether integration is usable. |
| `product_ids` | jsonb | ["campaign"] | JSON array of product codes allowed to use this config. |

## `accounts.setup_email_configs`

My Accounts mailbox From settings for test-send feature.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 1 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. |
| `from_address` | text | "user@company.com" | Connected mailbox address for test sends. |
| `display_name` | text | "Priya Sharma" | From display name for test mail. |
| `status` | text | "active" | Mailbox connection status. |

## `accounts.mail_oauth_connections`

Encrypted OAuth tokens for user mailbox test sends.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `id` | bigint | 1 | Primary key. |
| `organization_id` | bigint | 1000 | Org scope. |
| `provider` | text | "google" | OAuth provider: google or microsoft. |
| `email` | text | "user@company.com" | Connected mailbox email. |
| `refresh_token_encrypted` | text | "aes-gcm:…" | Encrypted refresh token; decrypted only server-side for SMTP test. |
| `status` | text | "active" | Connection status. |

# cdp schema

Campaign may read/write existing columns only; no ALTER from Campaign.

## `cdp.customer_profile`

Canonical contact record — Campaign Audience CRUD target.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `cdp_id` | bigint | 9000000000000000123 | Primary key; stored as contact_id in all campaign tables. |
| `organization_id` | bigint | 1000 | Org scope; must match logged-in organizationId for access. |
| `first_name` | text | "Alice" | Contact given name. |
| `last_name` | text | "Nguyen" | Contact family name. |
| `company` | text | "Northwind Labs" | Company name; API field company_name. |
| `city` | text | "Chennai" | City used in audience filters. |
| `custom_fields` | jsonb | {"job_title":"Head of Growth"} | Flexible JSON for segment, score, product_interest, campaign_deleted flag, etc. |
| `created_at` | timestamptz | 2026-07-01T08:00:00Z | Profile created. |
| `updated_at` | timestamptz | 2026-08-25T09:00:00Z | Profile last modified. |
| `first_seen_at` | timestamptz | 2026-07-01T08:00:00Z | First seen timestamp; set on campaign-created contacts. |
| `last_seen_at` | timestamptz | 2026-08-25T09:00:00Z | Last activity timestamp. |
| `acquisition_channel` | text | "campaign" | Source system label; Campaign sets campaign on insert. |

## `cdp.identity_keys`

Email and phone identities linked to customer_profile.

| Column | Type | Example | Description |
|--------|------|---------|-------------|
| `identity_id` | uuid | "a1b2c3d4-…" | Primary key uuid generated at insert. |
| `cdp_id` | bigint | 9000000000000000123 | Profile this identity belongs to. |
| `organization_id` | bigint | 1000 | Org scope for uniqueness of key_value per type. |
| `key_type` | text | "email" | Identity kind: email, primary_email, phone, primary_phone, mobile. |
| `key_value` | text | "alice@example.com" | Normalized lookup value; phones stored as digits. |
| `source_system` | text | "campaign" | System that created the key; Campaign uses campaign. |
| `verified` | boolean | true | Whether identity is considered verified. |
| `created_at` | timestamptz | 2026-07-01T08:00:00Z | Key created. |
| `custom_fields` | jsonb | {} | Optional metadata JSON on the identity row. |

