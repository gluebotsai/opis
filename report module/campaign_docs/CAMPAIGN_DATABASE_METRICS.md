# Campaign database and metrics

**Audience:** operators, analysts, and engineers who need the Postgres catalog the **Campaign management product** actually uses, plus how Dashboard and deeper KPIs are calculated.

**Scope (this file only):** schemas and tables the Campaign app reads or writes.

| Included | Not included |
|----------|----------------|
| `campaign` product tables | `campaign_marts`, `campaign_staging`, `metricflow_time_spine` |
| `accounts` tables Campaign login, RBAC, mailbox, A2A, and auth actually touch | Remaining Accounts tables (billing, CCaaS, partners, …) |
| `cdp.customer_profile` and `cdp.identity_keys` | Other CDP gold/bronze tables and `cdp.campaigns` / `cdp.campaign_deliveries` (CDP-owned; Campaign KPIs use `campaign.campaign_send_recipients`) |
| — | `inventory` (Campaign does not query this schema) |

**How Campaign connects (two URLs, one Postgres `worktual_bigint`):**

| Env var | Postgres objects |
|---------|------------------|
| `DATABASE_URL` / `CAMPAIGN_DATABASE_URL` (`?schema=campaign`) | Campaign application tables and ENUMs |
| `ACCOUNT_DATABASE_URL` | `accounts` and `cdp` (Campaign does not migrate these) |

IDs in `campaign.*` are **bigint** (APIs return strings). CDP person identity is **text** `cdp_id`. Campaign stores a **derived bigint** `contact_id` on its own tables. Full CDP strings for opaque ids also live on `campaigns.launch_plan.audience_cdp_ids`.

`organization_id` on Campaign rows is a **logical** tenant id (`accounts.organizations.id`) with **no** cross-schema FK. Always filter it.

**Sources:** live Postgres column lists (October 2026) aligned with `backend/prisma/schema.prisma` for `campaign`, plus raw SQL DAOs for Accounts/CDP. Encrypted `*_enc` bytea columns exist in live DB even when Prisma does not map them.

---

## Postgres ENUM types (`campaign`)

| Type | Values | Used on |
|------|--------|---------|
| `"ProductCode"` | `campaign`, `crm` | `organization_products.product_code` |
| `"ProductStatus"` | `active`, `inactive` | `organization_products.status` |
| `"CampaignStatus"` | `draft`, `scheduled`, `live`, `completed`, `cancelled` | `campaigns.status` |
| `"SourceChannel"` | `standalone_campaign`, `crm_marketing` | `campaigns.source_channel` |
| `"ChannelConfigStatus"` | `not_started`, `in_progress`, `ready`, `blocked` | `channel_sending_profiles.status` |
| `"RegulatedTemplateStatus"` | `draft`, `pending`, `approved`, `rejected`, `paused`, `disabled` | `regulated_channel_templates.status` |

Text columns that behave as categories are listed per table in **Categorical values**. Recipient delivery mapping used by KPIs is in the metrics section.

---

## Shared delivery outcome (all messaging KPIs)

Join `campaign.campaign_send_recipients` r to `campaign.campaign_send_batches` b on `r.batch_id = b.id`. Filter `r.organization_id` and campaign launch window from `campaign.campaigns`.

| Recipient `status` (lowercase) | Outcome |
|--------------------------------|---------|
| `failed`, `cancelled` | failed |
| `skipped` | skipped (not failed volume) |
| `stub`, `stub_sent` | stub (not delivered) |
| `pending`, `queued`, `queued_accounts`, `sending`, empty | pending |
| `sent`, `delivered` | **sent** if `provider_message_id` is not stub; else stub |
| `bounced`, `hard_bounce`, `soft_bounce` | bounce (also if `skip_fail_reason` looks like bounce) |

**Stub:** `provider_message_id` starts with `stub-` or `stub://`.

**Delivered (rate denominator):** outcome = sent, not bounce, not stub.

**Unique open:** `opened_at IS NOT NULL` (email only for open rate).

**Unique click:** `clicked_at IS NOT NULL` on email, app push (`push`), web push (`web`).

**PPC-only campaigns** are excluded from Dashboard messaging headlines.

---

# Schema `campaign`

Campaign-owned application data. Skip `_prisma_migrations` (Prisma bookkeeping).


## `campaign.branches`

Workspace under a tenant. Saved campaigns and create-campaign chat drafts are always scoped to both organization and branch.

Login picks the default branch when the operator has not chosen another workspace. Campaign does not use accounts.branches for this product surface.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a Campaign workspace under a tenant. Saved campaigns and agent sessions store this value as branch_id; it is not accounts.branches.id. |
| `organization_id` | `bigint` | yes | — | Tenant that owns this Campaign workspace. Must match accounts.organizations.id. First login creates a Default branch for this tenant. |
| `name` | `text` | yes | — | Label shown in the UI for this workspace (commonly Default). Operators distinguish workspaces by this name; entitlement and campaign rows key off id, not name. |
| `is_default` | `boolean` | yes | `true`, `false` | Whether login should pick this branch when the operator has no other workspace selected. Only one default should be true per organization in practice; false branches are extra workspaces. |
| `created_at` | `timestamp without time zone` | yes | — | When this Campaign workspace row was inserted. Not a campaign launch date and not used in Dashboard period filters. |
| `updated_at` | `timestamp without time zone` | yes | — | When the workspace name or default flag last changed. Audit only; campaign performance does not roll up on this timestamp. |

## `campaign.organization_products`

Records which Worktual products this branch may use. Campaign login requires an active row with product_code=campaign.

CRM entitlement can sit on the same table so embed and Campaign SPA share one gate, but inactive campaign rows block the app.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of one product entitlement row for a branch. Login looks up by organization, branch, and product_code rather than by this id in the UI. |
| `organization_id` | `bigint` | yes | — | Tenant this entitlement belongs to. Must match the branch’s organization. Inactive campaign rows here block Campaign login for that tenant/branch. |
| `branch_id` | `bigint` | yes | — | Which Campaign workspace is entitled. Postgres FK to branches, ON DELETE CASCADE. Removing a branch drops its product rows. CRM and Campaign entitlements can both hang off the same branch. |
| `product_code` | `ProductCode` | yes | `campaign`, `crm` (Postgres enum ProductCode) | Which Worktual product this row grants: Campaign app or CRM. Campaign access requires product_code=campaign. crm is recorded for embed/shared entitlement, not for send KPIs. |
| `status` | `ProductStatus` | yes | `active`, `inactive` (Postgres enum ProductStatus) | Whether this product is currently allowed on the branch. Only active campaign rows pass ensureCampaignAccess. inactive turns the product off without deleting history. |
| `starts_at` | `timestamp without time zone` | no | — | Optional instant when this entitlement begins. Null means already in force. Not a campaign launch timestamp. |
| `ends_at` | `timestamp without time zone` | no | — | Optional expiry of this entitlement. Null means no scheduled end. After expiry the product should be treated as inactive. |
| `created_at` | `timestamp without time zone` | yes | — | When this entitlement row was created. Ops audit; not used in Dashboard campaign counts. |
| `updated_at` | `timestamp without time zone` | yes | — | When status or dates on this entitlement last changed. Shows when access was flipped; unrelated to send volume. |

## `campaign.campaigns`

The saved marketing program the rest of the product hangs off: name, lifecycle, audience snapshot, launch clock, and launch_plan JSON.

Dashboard period filters use launch_local_date in timezone. Send KPIs join from this id to batches and recipients; they do not use this row’s status alone as delivered volume.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of the saved campaign. Batches, channels, and audience hang off this id. APIs return it as a string. Monitor and Dashboard always combine it with organization_id. |
| `organization_id` | `bigint` | yes | — | Tenant that owns this saved campaign. Mandatory filter on every campaign KPI. Logical ref to accounts.organizations.id. |
| `branch_id` | `bigint` | yes | — | Workspace this campaign belongs to. FK to campaign.branches. Lists are branch-scoped; admin still cannot cross organization_id. |
| `name` | `text` | yes | — | Display name on Dashboard, monitor, and daily report emails. Not used in rate math. Identity is id even if names collide. |
| `description` | `text` | no | — | Optional longer description stored on the campaign. Shown to operators and agents; never a KPI numerator or denominator. |
| `status` | `CampaignStatus` | yes | `draft`, `scheduled`, `live`, `completed`, `cancelled` (Postgres enum CampaignStatus) | Lifecycle: draft, scheduled, live, completed, cancelled. Dashboard campaigns-ran counts live+completed+cancelled only. draft/scheduled are excluded. |
| `starts_at` | `timestamp without time zone` | no | — | Optional UTC window start on the row. Dashboard period uses launch_local_date in timezone, not this column. |
| `ends_at` | `timestamp without time zone` | no | — | Optional UTC window end on the row. Does not close batches by itself. completed is the lifecycle flag. |
| `source_channel` | `SourceChannel` | yes | `standalone_campaign`, `crm_marketing` (Postgres enum SourceChannel) | Whether the campaign was created in Campaign SPA or CRM marketing embed. Provenance filter only; open/click rates ignore this. |
| `created_by_user_id` | `bigint` | yes | — | Marketer who saved the campaign (accounts.setup_users.id). Non-admin reports keep only this user’s campaigns. Admin sees the branch/org set. |
| `created_at` | `timestamp without time zone` | yes | — | When the campaign row was inserted. Do not use as Dashboard period. Launch clock is launch_local_date plus timezone. |
| `updated_at` | `timestamp without time zone` | yes | — | Last change to any column on this campaign row. Ops freshness, not sent volume. |
| `goal` | `text` | no | — | Marketing goal captured in create-campaign. Agents and ontology read it. Dashboard does not group by goal. |
| `objective` | `text` | no | — | Finer objective than goal for the same campaign. Operator context only; not a rate denominator. |
| `session_id` | `bigint` | no | — | Draft chat this campaign was saved from. Unique when set. Null when the campaign was created outside that session. Used to reopen chat, not for KPIs. |
| `audience_summary` | `text` | no | — | Human summary of who was selected at freeze. Display only. Counts come from audience_count or campaign_audience. |
| `audience_filters` | `jsonb` | no | — | JSON snapshot of filters used when the audience was frozen. Explains the list later. Send does not re-run these filters on CDP. |
| `audience_count` | `integer` | yes | — | Frozen people count. Dashboard preview Audience/Targeted uses this. This is Selected, not Delivered. Should match campaign_audience after freeze. |
| `launch_plan` | `jsonb` | no | — | JSON: schedule, channels, email A/B, audience_cdp_ids, optional channel_run (PPC/demo fallback). Live messaging KPIs prefer send_recipients. Opaque CDP ids required here when bigint alone cannot look up the person. |
| `launch_local_date` | `text` | no | — | Launch calendar date in campaigns.timezone (YYYY-MM-DD). Dashboard Today / 7 days / custom range filter this date. |
| `launch_local_time` | `text` | no | — | Launch clock in the campaign timezone (HH:mm). UI scheduling. Workers send from batch scheduled_for in UTC. |
| `timezone` | `text` | no | IANA tz; product default `Asia/Kolkata` | IANA timezone for launch calendar math. Default Asia/Kolkata. Portfolio KPIs interpret launch_local_date in this zone. |

## `campaign.campaign_channels`

One row per channel on a saved campaign (email, WhatsApp, SMS, app push, web push, web, PPC).

This is the planned channel list, not the send fact table. template_id points at a session creative without a Postgres FK.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of one planned channel on a saved campaign. Not a send id. Delivery facts use batch and recipient ids. |
| `campaign_id` | `bigint` | yes | — | Parent saved campaign. FK CASCADE from campaigns. Unique with channel so a campaign cannot list email twice. |
| `organization_id` | `bigint` | yes | — | Tenant copied onto the channel row for cheap listing. Keep aligned with the parent campaign’s organization_id. |
| `channel` | `text` | yes | `email`, `whatsapp`, `sms`, `push` (app), `web` (web push), `ppc`, plus other agent ids | Agent-canonical channel this row represents (email, whatsapp, sms, push, web, ppc, …). Dashboard channel cards group sends via batches, but this list tells which channels were planned. |
| `template_id` | `bigint` | no | — | Session creative used for this channel. Logical ref to campaign_channel_templates.id; no Postgres FK. Null if copy was not bound. Deleting a template does not cascade-delete this row. |
| `how_it_works` | `text` | no | — | Operator note describing how this channel run is supposed to work. Documentation on the campaign, not a metric. |
| `planned_launch_at` | `text` | no | — | Planned launch string stored for this channel (not necessarily timestamptz). Display/plan. Actual send time is campaign_send_batches.scheduled_for. |
| `status` | `text` | yes | Default `ready`. Also used as channel-run state (`paused`, etc.) as text | Channel-run readiness or pause state as text (default ready). Paused here is product state. Failed volume still comes from recipients. |
| `created_at` | `timestamp without time zone` | yes | — | When this channel was attached to the campaign. Not launch time. |
| `updated_at` | `timestamp without time zone` | yes | — | When template, plan, or status on this channel row last changed. Audit only. |

## `campaign.campaign_audience`

Frozen CDP people at save/launch. Campaign stores only the bigint contact_id, never the person’s name or email here.

Audience size for Selected KPIs should count these rows (or campaigns.audience_count). Sends still come from campaign_send_recipients.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `campaign_id` | `bigint` | yes | — | Saved campaign this frozen person belongs to. Part of composite PK; FK CASCADE. Selected KPIs count rows per this id. |
| `contact_id` | `bigint` | yes | — | Campaign bigint for the frozen person (from CDP cdp_id). No email/name here. Join CDP using the mapping documented in the identity handoff. |
| `created_at` | `timestamp without time zone` | yes | — | When this person was frozen onto the campaign. Not opened_at. Freeze time is not Dashboard period. |

## `campaign.campaign_agent_sessions`

Create-campaign (and other SPA module) chat draft. payload holds messages, working audience, and in-progress templates.

People in a draft are id refs in campaign_audience_refs or sheet rows in campaign_session_temp_contacts, not full CDP copies.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a chat draft (session_id in URLs). campaigns.session_id points here after save. Not a campaign performance id. |
| `organization_id` | `bigint` | yes | — | Tenant that owns this draft. Session APIs reject cross-tenant session ids. |
| `branch_id` | `bigint` | yes | — | Workspace of the draft. FK to branches. Create-campaign chat is branch-scoped like saved campaigns. |
| `created_by_user_id` | `bigint` | yes | — | Operator who owns this draft. Draft lists for non-admins stay on this user. |
| `module` | `text` | yes | `create_campaign`, `contacts`, `monitoring` (and other SPA module ids stored as text) | Which SPA surface this session belongs to (create_campaign, contacts, monitoring, …). Same table stores multiple products of chat; payload shape depends on this. |
| `stage` | `text` | yes | `intake`, `drafting`, `idle`, and other funnel strings | Coarse funnel stage (intake, drafting, idle, …). UI progress only. Not a campaign.status and not a KPI. |
| `payload` | `jsonb` | yes | — | JSON: messages, working campaign name, audience.contact_ids_cdp, in-progress templates. Source of truth while drafting. After save, campaigns + templates + audience tables persist the freeze. |
| `created_at` | `timestamp without time zone` | yes | — | When the draft session started. Not launch_local_date. |
| `updated_at` | `timestamp without time zone` | yes | — | Last chat or payload write on this draft. Used to sort recent drafts. |

## `campaign.campaign_audience_refs`

Contact ids attached to a draft session before the campaign is saved.

When the operator freezes and saves, these ids (plus promoted temp rows) become campaign_audience on the campaign row.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `session_id` | `bigint` | yes | — | Draft that this person is attached to. Part of composite PK; FK CASCADE from sessions. Disappears if the session is deleted. Becomes campaign_audience at save. |
| `contact_id` | `bigint` | yes | — | Campaign bigint of a CDP person selected in this draft. Sheet uploads are not stored here; those are campaign_session_temp_contacts. |

## `campaign.campaign_session_temp_contacts`

People uploaded only for this chat session from a sheet. They are not CRM until promote-at-freeze writes CDP.

Email and phone here are working copy for that session. Do not treat this table as the Audience or send list after launch.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of one uploaded sheet row for a session. Not a CDP id. Promote-at-freeze creates a real profile and then a bigint contact_id. |
| `session_id` | `bigint` | yes | — | Draft this upload belongs to. FK CASCADE. Clearing the session removes the working sheet people. |
| `organization_id` | `bigint` | yes | — | Tenant of the upload (denormalized from the session). Stops accidental mixing of sheet rows across orgs. |
| `first_name` | `text` | yes | — | Given name from the sheet column for this session-only person. Copied into CDP at promote. Empty string if the sheet had no name. |
| `last_name` | `text` | yes | — | Family name from the sheet for this session-only person. Same promote path as first_name. Not used in send KPIs until they become recipients. |
| `email` | `text` | yes | — | Email from the sheet used to create an identity_keys row at promote. Until promote this is not CDP and not email_suppressions matching on a profile. |
| `phone` | `text` | yes | — | Phone from the sheet for WhatsApp/SMS identity at promote. Normalized later in CDP identity_keys, not here. |
| `company_name` | `text` | yes | — | Company column from the sheet, mapped to customer_profile.company on promote. Working copy only in this table. |
| `city` | `text` | yes | — | City column from the sheet, mapped to customer_profile.city on promote. Not website_contacts.city (that table has no city); this is sheet CRM-shaped data. |
| `raw` | `jsonb` | yes | — | Original extra sheet columns as JSON. Preserves fields the typed columns do not cover. May land in CDP custom_fields on promote. |
| `created_at` | `timestamp without time zone` | yes | — | When this sheet row was ingested into the session. Not a send time. |

## `campaign.campaign_channel_templates`

Structured channel creative for a session (subject, HTML, buttons, and other FE shell fields in JSON).

Saved campaigns may point campaign_channels.template_id at this id. Gallery and library reuse similar field shapes.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Template id used in the UI and stored on campaign_channels.template_id. This is creative identity, not a send recipient id. |
| `session_id` | `bigint` | yes | — | Draft that owns this creative. FK CASCADE from sessions. Deleting the draft deletes templates and their edit-space messages. |
| `organization_id` | `bigint` | yes | — | Tenant copied onto the template for listing. Must match the session org. |
| `branch_id` | `bigint` | yes | — | Workspace copied onto the template (no FK in Prisma to branches). Keeps gallery/session queries branch-scoped. |
| `channel` | `text` | yes | Same agent-canonical set as campaign_channels.channel | Which channel this creative is for (email HTML vs WhatsApp body, etc.). Must align with campaign_channels.channel when bound. |
| `logo` | `text` | no | — | Logo URL shown in the email/web shell for this template. Creative asset pointer, not Image Gallery media_id. |
| `launch_at` | `text` | no | — | Suggested launch string stored on the template while drafting. Not batch.scheduled_for. |
| `how_it_works` | `text` | no | — | Explanation shown to the operator for this creative. Copy only. |
| `fields` | `jsonb` | yes | — | Structured shell fields (subject, html, buttons, hero, …) consumed by the frontend. This JSON is the sendable content after compile. Library templates reuse a similar shape. |
| `generation_batch_id` | `bigint` | no | — | Which generate-batch produced this template, when AI-created. Null for hand-edited rows. Ops correlation, not a KPI. |
| `created_at` | `timestamp without time zone` | yes | — | When this creative row was inserted. Sorts templates in the session. |
| `updated_at` | `timestamp without time zone` | yes | — | Last edit in template chat or field write. Shows freshness of the copy. |

## `campaign.campaign_template_messages`

Ordered turns in the template edit-space chat for one creative.

seq is the order of the conversation. kind distinguishes plain operator chat from a template payload update.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of one edit-space chat turn. Not a campaign chat session id; parent is template_id. |
| `template_id` | `bigint` | yes | — | Which creative this turn belongs to. FK CASCADE from channel_templates. Unique with seq for ordering. |
| `role` | `text` | yes | `user`, `assistant`, `system` | Who spoke: user, assistant, or system. Renders the edit-space transcript. Not campaign_send_recipients status. |
| `seq` | `integer` | yes | — | Order of the turn within the template (starts at 1). Must stay unique per template. Replay uses this, not created_at. |
| `kind` | `text` | yes | `text`, `template` | text for ordinary chat vs template for a payload that updates fields. kind=template carries structured updates; kind=text is operator instruction. |
| `payload` | `jsonb` | yes | — | Message body JSON (text or template fragment). Not launch_plan. Only the edit-space conversation. |
| `created_at` | `timestamp without time zone` | yes | — | When this turn was appended. Display order still uses seq. |

## `campaign.channel_sending_profiles`

Per-org, per-channel readiness checklist used as a send gate in Configuration.

Email is the filled path today. Other channels keep a reserved row so the UI can show not_started / blocked.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of per-org channel readiness. UI loads by organization_id + channel, not this id. |
| `organization_id` | `bigint` | yes | — | Tenant whose send checklist this is. One row per channel. Unique (organization_id, channel). |
| `channel` | `text` | yes | `email`, `sms`, `whatsapp`, `push`, `web`, … | Which send path this checklist covers (email is filled; others reserved). Not the same as push_channel_settings.channel (that uses web_push/app_push). |
| `status` | `ChannelConfigStatus` | yes | `not_started`, `in_progress`, `ready`, `blocked` (ChannelConfigStatus) | Gate: not_started, in_progress, ready, blocked (ChannelConfigStatus). blocked/not ready should stop professional send. This is ops, not Dashboard Failed. |
| `checklist` | `jsonb` | no | — | JSON of operator checklist items (e.g. SPF/DKIM ticks for email). Explains status. Domain truth also lives on email_domains flags. |
| `created_at` | `timestamp without time zone` | yes | — | When this channel profile was first created for the tenant. Not a send timestamp. |
| `updated_at` | `timestamp without time zone` | yes | — | When checklist or status last changed. Shows last configuration activity. |

## `campaign.organization_api_keys`

Hashed integration keys so devices can register for app push without a user JWT.

The raw secret is never stored. last_used_at is operational, not a marketing KPI.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of an integration key row. The public handle is key_prefix; the secret is only stored hashed. |
| `organization_id` | `bigint` | yes | — | Tenant this key authenticates devices for. Unique with purpose so there is one app_push key per org. |
| `purpose` | `text` | yes | Default `app_push` | Which integration the key is for. Default app_push. Register APIs look up by purpose, not by campaign id. |
| `key_hash` | `text` | yes | — | Hash of the secret. Unique globally. Never store or return the raw key after creation. |
| `key_prefix` | `text` | yes | — | Visible prefix so operators recognize the key in the UI. Not sufficient to authenticate; hash comparison is required. |
| `active` | `boolean` | yes | `true`, `false` | Whether register calls may use this key. false disables devices without deleting the row. |
| `created_at` | `timestamp without time zone` | yes | — | When the key was issued. Rotation ops, not a marketing KPI. |
| `last_used_at` | `timestamp without time zone` | no | — | Last successful authenticated use. Null if never used. Health of the integration, not open rate. |

## `campaign.push_channel_settings`

VAPID / FCM / APNs credentials collected in Campaign Configuration for web_push and app_push.

This is setup state, not delivery. Live tokens live on push_endpoints; send outcomes live on campaign_send_recipients.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of VAPID/FCM/APNs settings for one push product. Credentials, not device tokens (those are push_endpoints). |
| `organization_id` | `bigint` | yes | — | Tenant whose push provider secrets these are. Unique with channel (web_push vs app_push). |
| `channel` | `text` | yes | Config UI ids: `web_push`, `app_push` | Config UI id: web_push or app_push (not agent push/web). Map to agent channels push/web at send time. |
| `settings` | `jsonb` | yes | — | JSON bag of provider fields. Secrets stay server-side. Never send this JSON to the frontend in full. |
| `status` | `text` | yes | Default `not_started`; also `in_progress`, `ready`, `blocked` | Configuration progress (default not_started). ready means credentials exist; delivered volume still comes from recipients. |
| `created_at` | `timestamp without time zone` | yes | — | When push config was first saved for this channel. Not subscribed_at on website_contacts. |
| `updated_at` | `timestamp without time zone` | yes | — | Last credential or status change. Ops audit. |

## `campaign.email_org_profiles`

Legal sender identity (physical address) used in email footers for CAN-SPAM style compliance.

One profile per organization. Missing address blocks professional send even if DNS is ready.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of the org legal-address profile. One profile per organization_id. |
| `organization_id` | `bigint` | yes | — | Tenant whose CAN-SPAM style footer identity this is. Unique. Missing profile blocks a complete professional From even if DNS is ready. |
| `legal_name` | `text` | yes | — | Legal sender name printed in email footers. Not email_senders.display_name (that is the From header name). |
| `street` | `text` | yes | — | Street line of the physical address required in the footer. Compliance copy, not a recipient address. |
| `city` | `text` | yes | — | City of the legal address on this org profile. Not cdp.customer_profile.city and not temp-contact city. |
| `country` | `text` | yes | — | Country of the legal address (often ISO-like text). Footer identity for the sending company, not the contact’s country. |
| `phone` | `text` | no | — | Optional contact phone printed with the legal address. Not a WhatsApp send destination. |
| `created_at` | `timestamp without time zone` | yes | — | When the legal profile was created. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | When address fields last changed. Operators should refresh footers after this changes. |

## `campaign.email_senders`

From addresses the tenant may use. The bulk send worker uses the single is_active=true row.

status tracks mailbox verification. This is not the Accounts OAuth mailbox used for inbox test-send.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a From-address row. The worker selects the is_active row, not an arbitrary id from the UI at send time. |
| `organization_id` | `bigint` | yes | — | Tenant that owns this From address. Unique with from_email. |
| `display_name` | `text` | yes | — | From display name on bulk Campaign email. Different from Accounts mailbox sender_name on setup_email_configs. |
| `from_email` | `text` | yes | — | From address used by the Campaign email worker when this row is active. Must be verified. Not the connected-inbox test-send address unless they coincide. |
| `reply_to` | `text` | no | — | Optional Reply-To header for bulk mail. Null means replies go to from_email. |
| `status` | `text` | yes | Default `pending_verification`; also `verified` | Verification of this From (pending_verification vs verified). Unverified senders should not go live. This is not recipient delivery status. |
| `verify_token` | `text` | no | — | Secret token for the mailbox verification link. Server only; never show in the SPA. |
| `verify_expires_at` | `timestamp without time zone` | no | — | When the current verify_token expires. Expired tokens require a new verification email. |
| `verified_at` | `timestamp without time zone` | no | — | When this From last completed verification. Null until verified. Ops, not open rate. |
| `created_at` | `timestamp without time zone` | yes | — | When this From was added. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | When verification or is_active last changed. Shows which From the worker should be using after flips. |
| `is_active` | `boolean` | yes | `true`, `false` — worker uses the true row | Whether the bulk send worker must use this From (one true per tenant in practice). false keeps the address on file without sending from it. |

## `campaign.email_domains`

Sending domain plus SPF / DKIM / DMARC health and DNS records the operator pastes at their registrar.

The encrypted DKIM private key must never go to the frontend. Domain auth is a Tier 3 ops metric, not a Dashboard KPI.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a sending domain row. Operators manage DNS against domain, not this id. |
| `organization_id` | `bigint` | yes | — | Tenant that owns this sending domain. Unique with domain. |
| `domain` | `text` | yes | — | Sending domain to authenticate (e.g. mail.acme.example). SPF/DKIM/DMARC flags apply to this name. Different from email_return_paths.domain. |
| `spf_ok` | `boolean` | yes | `true`, `false` | Whether SPF lookup currently passes for this domain. Tier 3 auth metric. False should keep channel_sending_profiles from ready. |
| `dkim_ok` | `boolean` | yes | `true`, `false` | Whether DKIM is published and considered passing. Requires selector + public key in DNS. Private key stays encrypted on this row. |
| `dmarc_ok` | `boolean` | yes | `true`, `false` | Whether DMARC policy is present and acceptable. Together with spf_ok/dkim_ok this is domain authentication health. |
| `status` | `text` | yes | Default `not_started`; setup progress including `ready` | Setup progress for this domain (default not_started, ready when usable). Not recipient status and not campaigns.status. |
| `created_at` | `timestamp without time zone` | yes | — | When this domain was added for the tenant. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last DNS check or key rotation write. Ops freshness of auth flags. |
| `provider_domain_id` | `text` | no | — | Optional legacy ESP domain id. Unused for send. Keep for ops compatibility; mailbox From is Accounts. |
| `dns_records` | `jsonb` | no | — | JSON of records the operator pastes at the registrar. Instruction payload, not a live DNS probe result by itself. |
| `dkim_selector` | `text` | no | — | DKIM selector (e.g. campaign) used in DNS. Must match the published TXT name. |
| `dkim_public_key` | `text` | no | — | Public p= material for the DNS TXT (not PEM). Safe to show to operators for paste; not a secret. |
| `dkim_private_key_encrypted` | `text` | no | — | AES-GCM encrypted PEM private key for signing. Server only. Never return to the frontend. |

## `campaign.email_return_paths`

Bounce / Return-Path domain for the organization.

Separate from the marketing From domain. status is configuration progress, not bounce volume.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of the bounce domain row. One per organization. |
| `organization_id` | `bigint` | yes | — | Tenant whose Return-Path domain this is. Unique. Separate from email_domains.domain (marketing From domain). |
| `domain` | `text` | yes | — | Bounce / Return-Path hostname (e.g. bounces.acme.example). Used by the ESP for bounce processing, not as the visible From. |
| `status` | `text` | yes | Default `not_started`; `ready` when bounce domain is usable | Whether this bounce domain setup is usable. not_started vs ready. Bounce volume is still on recipients, not here. |
| `created_at` | `timestamp without time zone` | yes | — | When the return-path row was created. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last change to domain or status. Ops. |

## `campaign.email_sending_caps`

Warm-up ladder and batch / hourly / daily caps, plus rolling health_stats used to auto-pause risky sending.

Cap utilization and health_status are ops metrics. They are not Dashboard open/click rates.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of the tenant’s warm-up and rate-limit row. One per organization. |
| `organization_id` | `bigint` | yes | — | Tenant these caps apply to. Unique. All email batches for the org should respect these integers. |
| `batch_size` | `integer` | yes | — | Max recipients planned per email send slice (default 200). campaign_send_batches.size should not exceed this for email. |
| `hourly_cap` | `integer` | yes | — | Max email recipients per hour (default 500). Workers stagger scheduled_for to stay under this. Tier 3 utilization metric. |
| `daily_cap` | `integer` | yes | — | Max email recipients per day (default 1000). Warm-up and health use this ceiling. |
| `warmup_stage` | `integer` | yes | — | Integer ladder step for domain warm-up (default 0). Higher stages allow more volume. Ops, not a Dashboard KPI. |
| `health_status` | `text` | yes | Default `healthy`; also paused / degraded strings used by auto-pause | Rolling sending health (default healthy). Auto-pause reads this with health_stats. Not campaigns.status. |
| `created_at` | `timestamp without time zone` | yes | — | When caps were first inserted for the tenant. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last cap or health change. Shows when auto-pause last wrote. |
| `health_stats` | `jsonb` | no | — | JSON rolling counters: sent, hardBounce, complaint, windowStart. Feeds auto-pause. Complaint/bounce here are org windows, not per-campaign Dashboard Failed. |

## `campaign.email_suppressions`

Durable do-not-email list keyed by address (unsubscribe, hard bounce, complaint).

Send planning skips matching addresses. Counts by reason are Tier 3 compliance metrics, not Dashboard Failed.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of one suppressed address. Lookups use organization_id + email. |
| `organization_id` | `bigint` | yes | — | Tenant for which this address must not be mailed. Unique with email. Other tenants may still mail the same address. |
| `email` | `text` | yes | — | Address on the do-not-email list. Send planning skips matches. This is not campaign_send_recipients.email of a successful send. |
| `reason` | `text` | yes | `unsubscribe`, `hard_bounce`, `complaint` (typical) | Why blocked: typically unsubscribe, hard_bounce, or complaint. Tier 3 counts group this. Dashboard Failed does not use this table. |
| `created_at` | `timestamp without time zone` | yes | — | When the address was added to the list. Unsub timing for ops; contact-level unsub time may also live on campaign_contact_engagement. |
| `email_enc` | `bytea` | no | — | Encrypted companion of email on this suppression row. Do not expose to UI. Matching still uses plaintext email when present. |

## `campaign.campaign_send_batches`

One timed slice of a channel send. Workers pick queued batches when scheduled_for is due.

Join recipients through batch_id. channel on the batch is the agent-canonical channel used in all KPI group-bys.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of one timed send slice. Recipients FK here CASCADE. Workers lock queued ids. KPI joins recipients.batch_id to this id. |
| `organization_id` | `bigint` | yes | — | Tenant copied onto the batch for worker indexes. Must match the campaign org. Index (organization_id, status, scheduled_for) drives pickup. |
| `campaign_id` | `bigint` | yes | — | Campaign this slice belongs to. FK CASCADE from campaigns. Unique with channel and seq. Monitor filters campaigns via this. |
| `seq` | `integer` | yes | — | Slice number within that campaign+channel (1, 2, …). Caps split a large audience across seq values and scheduled_for times. |
| `scheduled_for` | `timestamp without time zone` | yes | — | UTC time when the worker may send this slice. Not Dashboard period (that is launch_local_date). Used for cap staggering. |
| `status` | `text` | yes | `queued`, `sending`, `sent`, `failed`, `cancelled` | queued, sending, sent, failed, or cancelled for the slice. Batch failed is ops. Message Failed KPIs still count recipient outcomes. |
| `size` | `integer` | yes | — | Planned recipient count for the slice. Compare to actual recipient rows for underfill. Default 0 until filled. |
| `created_at` | `timestamp without time zone` | yes | — | When the slice was inserted. Usually before scheduled_for. |
| `updated_at` | `timestamp without time zone` | yes | — | Last worker status change on the slice. Sending vs sent transition lives here. |
| `channel` | `text` | yes | Default `email`; also `push`, `web`, `whatsapp`, `sms`, … | Agent-canonical channel for every recipient in this slice. Dashboard delivered-by-channel and rates GROUP BY this column. |

## `campaign.campaign_send_recipients`

One intended delivery. This is the fact table for sent, failed, unique open, unique click, A/B, and bounce KPIs.

Always filter organization_id. Stub provider ids and bounce statuses are not delivered. opened_at / clicked_at are first unique events.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of one intended delivery. Tracking pixels resolve here. Volume KPIs are counts of this id with outcome filters. |
| `organization_id` | `bigint` | yes | — | Tenant on the delivery row for report filters without joining campaigns. Always predicate this. Logical org id. |
| `batch_id` | `bigint` | yes | — | Parent slice. FK CASCADE to campaign_send_batches. Channel comes from the batch. Deleting a batch deletes these rows. |
| `campaign_id` | `bigint` | yes | — | Denormalized campaign id (no Postgres FK). One-campaign monitor filters this. Period still needs campaigns.launch_local_date. |
| `contact_id` | `bigint` | no | — | Campaign bigint person, or null for some temp/web device sends. Join engagement and audience on this bigint, not CDP text. |
| `email` | `text` | no | — | Address when the batch is email. Suppression matching uses this. Unique opens still key the row, not the address. |
| `status` | `text` | yes | `pending`, `queued`, `queued_accounts`, `sending`, `sent`, `delivered`, `failed`, `cancelled`, `skipped`, `stub`, `stub_sent`, `bounced`, `hard_bounce`, `soft_bounce` | Delivery lifecycle; maps to sent/failed/skipped/stub/pending/bounce. Dashboard Failed campaigns need ≥1 failed outcome. Delivered needs sent/delivered, not stub, not bounce. |
| `skip_fail_reason` | `text` | no | — | Why skipped, failed, or bounced. Bounce detection also reads this text for mailbox errors. |
| `provider_message_id` | `text` | no | — | Provider id. stub- / stub:// means demo, not inbox. Stub ids force stub outcome even when status is sent. Exclude from delivered. |
| `created_at` | `timestamp without time zone` | yes | — | When this person was queued on the slice. Not Dashboard period. |
| `updated_at` | `timestamp without time zone` | yes | — | Last status or open/click write on this delivery. Contact history sorts on this for “last received”. |
| `attempt_count` | `integer` | yes | — | How many send attempts the worker made. Retry ops. Not a Dashboard card. |
| `destination` | `text` | no | — | Push token or web-push URL (or stub:// in demo). Email uses email instead. Identifies the device for push/web. |
| `platform` | `text` | no | `ios`, `android`, `web`, browser names, or null | ios, android, web, or browser label for push/web. Optional breakdown. Dashboard Overview does not group by this. |
| `ab_variant` | `text` | no | `a`, `b`, `holdout`, `winner` | Email A/B assignment: a, b, holdout, winner. Monitor A/B charts group this. Null when A/B is off. |
| `opened_at` | `timestamp without time zone` | no | — | First unique open time (email). Dashboard open rate numerator = this IS NOT NULL on delivered email. Not open_count. |
| `clicked_at` | `timestamp without time zone` | no | — | First unique tracked click time. Dashboard click rate numerator on email/push/web delivered rows. |
| `open_count` | `integer` | yes | — | Total open hits including repeats. Tier 2 total opens = SUM. Unique rate ignores this. |
| `click_count` | `integer` | yes | — | Total tracked clicks including repeats. Tier 2 total clicks = SUM. Unique rate uses clicked_at. |
| `email_enc` | `bytea` | no | — | Encrypted email blob on the recipient row. KPIs use plaintext email. Never return this to the browser. |

## `campaign.push_endpoints`

App device tokens and browser web-push subscriptions for a tenant, optionally linked to a contact.

active=false endpoints are not eligible. Delivery still lands on campaign_send_recipients, not this table.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a device token or browser subscription. Send still creates recipient rows; this is inventory. |
| `organization_id` | `bigint` | yes | — | Tenant that owns the endpoint. Unique with channel+endpoint. Tokens are not globally unique across orgs. |
| `contact_id` | `bigint` | no | — | Optional Campaign bigint of the person this device belongs to. Null for anonymous web push until matched. Audience send planning joins on this. |
| `channel` | `text` | yes | `push` (app), `web` (web push) | Agent-canonical: push for app, web for web push. Not web_push/app_push (those are settings table ids). |
| `platform` | `text` | no | — | Device OS or browser for this subscription. Helps choose FCM vs APNs vs web payload shape. |
| `endpoint` | `text` | yes | — | Token string or web-push subscription URL. Unique per org+channel. destination on recipients copies this at send. |
| `auth_keys` | `jsonb` | no | — | Web-push encryption keys JSON (p256dh/auth). Required for web; app tokens usually leave this null. |
| `label` | `text` | no | — | Optional operator label for the device. Display only. |
| `active` | `boolean` | yes | `true`, `false` | Whether this endpoint is eligible to send. false after unsubscribe or errors. Count active for Tier 3 inventory. |
| `created_at` | `timestamp without time zone` | yes | — | When the token/subscription was registered. Not first_seen_at on website_contacts (visitor table). |
| `updated_at` | `timestamp without time zone` | yes | — | Last refresh of token, keys, or active flag. Ops. |

## `campaign.website_contacts`

Site visitors from page open and optional web-push opt-in. They are not Audience until promoted into CDP.

visit_count and subscribed feed visitor/subscriber ops metrics. contact_id stays null until an explicit promote.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a site visitor row. Not CDP cdp_id. Promote sets contact_id when linked. |
| `organization_id` | `bigint` | yes | — | Tenant whose site this visitor is on. Unique with visitor_id. Snippet must send this org’s identity. |
| `visitor_id` | `text` | yes | — | Browser visitor id from the tracking snippet. Stable per browser until cleared. Not a campaign bigint. |
| `contact_id` | `bigint` | no | — | Set after promote/match into CDP as Campaign bigint. Null means anonymous visitor. Audience freeze does not include these until promoted. |
| `email` | `text` | no | — | Email if the visitor identified (form or known). May later match identity_keys. Separate from session temp-contact email. |
| `phone` | `text` | no | — | Phone if the visitor identified. Optional. Encrypted companion is phone_enc. |
| `first_name` | `text` | no | — | Given name if captured on site. Visitor profile, not campaign_audience. |
| `last_name` | `text` | no | — | Family name if captured on site. Same as first_name: site identity, not frozen audience. |
| `origin` | `text` | yes | — | Site origin (scheme+host) of the visit. Required. Distinguishes which property the snippet ran on. |
| `path` | `text` | no | — | Last path seen on that origin. Helps ops debug; not a campaign open pixel. |
| `user_agent` | `text` | no | — | Browser user-agent of the last visit. Platform hints; not push_endpoints.platform unless copied at subscribe. |
| `subscribed` | `boolean` | yes | `true`, `false` | Whether this visitor opted into web push. Tier 3 subscriber count = true. Independent of CDP. |
| `endpoint` | `text` | no | — | Web-push endpoint captured at opt-in. Often mirrored to push_endpoints.endpoint for sending. |
| `auth_keys` | `jsonb` | no | — | Web-push keys at opt-in. Same role as push_endpoints.auth_keys for this visitor. |
| `platform` | `text` | no | — | Browser/platform label at subscribe. Visitor table copy; send uses push_endpoints when registered. |
| `visit_count` | `integer` | yes | — | How many visits have been counted for this visitor. Tier 3 engagement of anonymous traffic. Default 1. |
| `first_seen_at` | `timestamp without time zone` | yes | — | First snippet hit for this visitor_id. Not campaigns.created_at. |
| `last_seen_at` | `timestamp without time zone` | yes | — | Most recent snippet hit. Recency of site activity. |
| `subscribed_at` | `timestamp without time zone` | no | — | When subscribed flipped to true. Null if never opted in. |
| `created_at` | `timestamp without time zone` | yes | — | Row insert time (usually first seen). Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last visit or subscribe update. Audit. |
| `email_enc` | `bytea` | no | — | Encrypted visitor email. Do not send to UI. |
| `phone_enc` | `bytea` | no | — | Encrypted visitor phone. Do not send to UI. |

## `campaign.campaign_contact_engagement`

Org-wide email engagement and unsubscribe for one contact, not per campaign.

Contact detail can fall back to email_open_count / email_click_count when per-send rows are thin. Unsub is global for Campaign email.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of org+contact email engagement. Unique (organization_id, contact_id). |
| `organization_id` | `bigint` | yes | — | Tenant for this contact’s Campaign email engagement. Unsub is global for Campaign email in this org, not one campaign. |
| `contact_id` | `bigint` | yes | — | Campaign bigint of the person. Same mapping as send_recipients.contact_id. |
| `email_unsubscribed` | `boolean` | yes | `true`, `false` | Whether future Campaign email should be suppressed for this person. Contact UI warning. Send should skip. Not Dashboard Failed. |
| `email_unsubscribed_at` | `timestamp without time zone` | no | — | When they unsubscribed. Null if still subscribed. Ops timeline. |
| `email_unsubscribe_reason` | `text` | no | — | Optional reason captured at unsub. Free text; suppressions.reason is the address-level coded reason. |
| `last_email_opened_at` | `timestamp without time zone` | no | — | Most recent email open across campaigns for this contact. Contact recency. Dashboard unique opens still use send_recipients.opened_at per send. |
| `last_email_clicked_at` | `timestamp without time zone` | no | — | Most recent email click across campaigns for this contact. Contact recency, not campaign click rate. |
| `email_open_count` | `integer` | yes | — | Lifetime open total stored on the contact. Fallback for contact KPI when recipient rows are thin. Not Dashboard open rate. |
| `email_click_count` | `integer` | yes | — | Lifetime click total stored on the contact. Same fallback role as email_open_count. |
| `created_at` | `timestamp without time zone` | yes | — | When this engagement row was created. Usually first Campaign email event. |
| `updated_at` | `timestamp without time zone` | yes | — | Last unsub or count update. Audit. |

## `campaign.regulated_channel_templates`

SMS DLT and WhatsApp Meta templates that need external approval before send.

Approval status is an ops / compliance metric. It is not a substitute for WhatsApp or SMS sent volume on recipients.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of an SMS DLT or WhatsApp Meta template. Approval list keys this. channel_config_id must not go to the UI. |
| `organization_id` | `bigint` | yes | — | Tenant that owns this regulated template. Status sync is per org+channel. |
| `channel` | `text` | yes | `sms`, `whatsapp` | sms or whatsapp — which regulator applies. Not email. Email creatives are campaign_channel_templates. |
| `name` | `text` | yes | — | Internal name for the template. WhatsApp Meta name often also lives in external_id. |
| `external_id` | `text` | yes | — | DLT id (SMS) or Meta template name (WhatsApp). Required for provider send. Empty string until submitted. |
| `provider_template_id` | `text` | no | — | Meta Graph template id when WhatsApp. Null for SMS or before Graph create. |
| `language` | `text` | yes | Default `en` | Template language (default en). Meta requires language+name uniqueness. |
| `category` | `text` | yes | — | Provider category (marketing, utility, …). Affects approval. Not campaigns.goal. |
| `header` | `text` | yes | — | Optional header text/media component. Empty string if unused. |
| `body` | `text` | yes | — | Required body with provider placeholders ({{1}}, …). This is what Meta/DLT approve. Send uses this after approved. |
| `footer` | `text` | yes | — | Optional footer component. Empty if unused. |
| `buttons` | `text` | yes | — | Newline-separated WhatsApp button labels. Empty for SMS. Not JSON buttons in email fields. |
| `status` | `RegulatedTemplateStatus` | yes | `draft`, `pending`, `approved`, `rejected`, `paused`, `disabled` (RegulatedTemplateStatus) | RegulatedTemplateStatus: draft through approved/rejected/paused/disabled. Tier 3 approval metric. WhatsApp sent volume still comes from recipients after launch. |
| `rejected_reason` | `text` | no | — | Provider rejection text. Null unless rejected. Shown to operators to fix copy. |
| `channel_config_id` | `bigint` | no | — | Internal accounts.setup_channel_configs.id. Never expose to UI. WhatsApp Graph calls need this. Logical FK only. |
| `submitted_at` | `timestamp without time zone` | no | — | When the template was submitted to DLT/Meta. Null while draft. |
| `last_status_checked_at` | `timestamp without time zone` | no | — | Last poll of provider status. Ops freshness of pending rows. |
| `created_by_user_id` | `bigint` | no | — | Operator who created the template, if known. Null for system-created rows. |
| `created_at` | `timestamp without time zone` | yes | — | Row insert time. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last status or copy change. Audit. |
| `campaign_name` | `text` | yes | — | Campaign name copied when created from a campaign (default empty). Context only; not campaigns.name live join. |
| `goal` | `text` | yes | — | Goal copied from the source campaign context (default empty). Not a KPI group-by. |
| `objective` | `text` | yes | — | Objective copied from the source campaign context (default empty). Same context role as goal on this table. |
| `source_campaign_id` | `bigint` | no | — | Logical campaigns.id this template was created from. No Postgres FK. Null if created from library/config. |

## `campaign.campaign_library_templates`

Template Library catalog: system seeds plus operator uploads, scoped per organization.

used_count is library reuse, not send volume. Structured fields match session template shells for gallery previews.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a library catalog row. used_count increments on use; not send volume. |
| `organization_id` | `bigint` | yes | — | Tenant library this row belongs to. System seeds are copied per org. Unique with seed_slug. |
| `source` | `text` | yes | `system`, `user` | system seed vs user upload. Reseed jobs update system rows; user rows stay operator-owned. |
| `seed_slug` | `text` | no | — | Stable id for system rows (null for uploads). Lets catalogs upsert without duplicating seeds. |
| `seed_catalog` | `text` | yes | — | Catalog version string (e.g. b2b-v11). Empty for some user uploads. Used to reseed. |
| `name` | `text` | yes | — | Card title in Template Library. Not regulated_channel_templates.name. |
| `description` | `text` | yes | — | Catalog description shown on the card. Marketing copy, not campaign.description of a live send. |
| `style_notes` | `text` | yes | — | Tone/layout guidance for generation. Prompting aid, not a KPI. |
| `goal` | `text` | yes | — | Intended marketing goal for this seed. Suggests create-campaign goal; not campaigns.goal of a launched row. |
| `primary_channel` | `text` | yes | `email` and other agent-canonical channels | Main channel this library item is for. Filters the library. channels JSON may list extras. |
| `channels` | `jsonb` | yes | — | JSON array of channel labels for the card UI. Default []. Display, not campaign_channels rows. |
| `audience` | `text` | yes | — | Suggested audience text for the card. Not a frozen contact list. |
| `flow_steps` | `jsonb` | yes | — | JSON suggested flow for the campaign. Default []. Planning copy. |
| `starter_message` | `text` | yes | — | Chat starter when the operator uses this template. Seeds create-campaign, not a send body by itself. |
| `approval_status` | `text` | yes | Default `approved` | Library gate (default approved). Hides unapproved uploads. Not Meta/DLT status. |
| `body_preview` | `text` | yes | — | Short preview string for the card. content_body holds the full copy. |
| `content_body` | `text` | yes | — | Full message/HTML/copy body stored in the library. May be copied into session template fields on use. |
| `preview_image` | `text` | no | — | Card image URL. Optional. Distinct from campaign_image_gallery_assets. |
| `preview` | `jsonb` | no | — | JSON card layout meta (headline, CTA, subject). Null allowed. FE card chrome. |
| `metadata` | `jsonb` | yes | — | Free-form tags/brand/language JSON (default {}). Search/filter extras. |
| `used_count` | `integer` | yes | — | How often this library item was used. Tier 3 creative ops. Not delivered messages. |
| `external_template_id` | `text` | yes | — | External id if the library item maps to a provider template. Default empty. Different from regulated external_id unless copied. |
| `created_by_user_id` | `bigint` | no | — | Uploader for user-source rows. Null for system seeds. |
| `created_at` | `timestamp without time zone` | yes | — | When the library row was inserted. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last catalog edit or used_count bump. Audit. |
| `fields` | `jsonb` | no | — | Structured channel fields matching session templates for gallery/previews. Null if the seed is copy-only. Same idea as campaign_channel_templates.fields. |

## `campaign.campaign_gallery_ideas`

AI Template Gallery idea cards generated for the tenant.

status=active cards show in the gallery. This table is creative inventory, not campaign performance.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of an AI gallery idea card. UI keys cards by idea_key per org. |
| `organization_id` | `bigint` | yes | — | Tenant whose gallery this idea belongs to. Unique with idea_key. |
| `idea_key` | `text` | yes | — | Stable idea id so regeneration upserts the same card. Not a campaign id. |
| `title` | `text` | yes | — | Gallery card title. Creative inventory, not campaigns.name. |
| `summary` | `text` | yes | — | Short card summary (default empty). Display. |
| `industry` | `text` | yes | — | Industry personalization string on the card. Comes from org context; not a KPI dimension on sends. |
| `industry_type` | `text` | yes | — | Finer industry type on the card. Mirrors accounts.organizations.industry_type at generation. |
| `pack_id` | `text` | yes | `generic-b2b`, `generic-b2c`, and other pack ids | Industry pack used to generate the idea (default generic-b2b). Aligns with tenant_industry_packs.pack_id. |
| `image_url` | `text` | no | — | Hero image for the card. Optional. |
| `image_meta` | `jsonb` | yes | — | JSON metadata about the hero image (default {}). Generator bookkeeping. |
| `generation_version` | `text` | yes | — | Generator version (default gallery-v1). Lets ops know which prompt pack produced the card. |
| `status` | `text` | yes | Default `active`; hide when not active | active to show; other values hide. Not send status. |
| `sort_order` | `integer` | yes | — | Card order in the gallery. Lower first. Default 0. |
| `created_at` | `timestamp without time zone` | yes | — | When the idea was generated. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last regeneration or status change. Audit. |

## `campaign.campaign_gallery_jobs`

Background job that bootstraps Template Gallery generation for an organization.

Job status and error_message are ops. They do not affect Dashboard sent or open rates.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a gallery bootstrap job. Ops inspect status here. |
| `organization_id` | `bigint` | yes | — | Tenant the job is generating ideas for. Index with status for workers. |
| `job_type` | `text` | yes | — | Kind of gallery job (e.g. bootstrap_gallery). Distinguishes reruns vs first bootstrap. |
| `status` | `text` | yes | `queued`, `running`, `done`, `failed` | queued, running, done, failed. Tier 3 job health. Failed jobs do not change send KPIs. |
| `channels_snapshot` | `jsonb` | yes | — | JSON of channels at job start (default []). Ideas generated for those channels. |
| `progress` | `jsonb` | yes | — | JSON progress payload (default {}). UI spinner details. |
| `error_message` | `text` | no | — | Failure text when status=failed. Null on success. |
| `started_at` | `timestamp without time zone` | no | — | When the worker started. Null while queued. |
| `finished_at` | `timestamp without time zone` | no | — | When the job finished or failed. Null while running. |
| `created_at` | `timestamp without time zone` | yes | — | When the job was enqueued. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last progress write. Audit. |

## `campaign.campaign_image_gallery_assets`

Reusable marketing images in Image Gallery (AI, upload, or import).

status hides archived assets. media_id is the stable handle used in templates; this is not a send fact.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a reusable marketing image. Templates reference media_id more than this id. |
| `organization_id` | `bigint` | yes | — | Tenant gallery this image belongs to. Unique with media_id. |
| `media_id` | `text` | yes | — | Stable media handle used in templates and URLs. Forward-only catalog key. |
| `image_url` | `text` | yes | — | HTTPS URL of the image. What email/web shells render. |
| `short_description` | `text` | yes | — | Alt/summary for the asset (default empty). Accessibility and search. |
| `generation_prompt` | `text` | yes | — | Prompt if AI-generated (default empty). Empty for uploads. Provenance, not a KPI. |
| `source` | `text` | yes | `ai_generated`, `uploaded`, `imported` | ai_generated, uploaded, or imported. How the bytes arrived. |
| `channel` | `text` | yes | — | Intended channel for reuse (default empty). Hint for gallery filters, not a send batch channel unless copied. |
| `context` | `jsonb` | yes | — | JSON extra context (default {}). Generator/upload metadata. |
| `reuse_tags` | `jsonb` | yes | — | JSON tags for reuse (default {}). Search. |
| `status` | `text` | yes | `active`, `archived` | active vs archived visibility. Archived stays in DB (forward-only) but hidden. |
| `created_by_user_id` | `bigint` | no | — | Who added the asset, if known. Null for some imports. |
| `created_at` | `timestamp without time zone` | yes | — | When the asset entered the gallery. Sort recent uploads. |
| `updated_at` | `timestamp without time zone` | yes | — | Last archive or metadata change. Audit. |

## `campaign.sms_channel_settings`

Per-tenant SMS / DLT provider settings collected in Campaign Configuration.

Secrets stay in settings JSON. Readiness is ops; SMS KPIs still come from send batches when they exist.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of tenant SMS/DLT settings. One row per organization. |
| `organization_id` | `bigint` | yes | — | Tenant these DLT/provider settings belong to. Unique. Secrets live in settings JSON. |
| `settings` | `jsonb` | yes | — | JSON: provider, api_key, sender_id, entity_id, base_url, … Server-side. SMS send still records recipients when batches exist. |
| `status` | `text` | yes | Default `not_started`; `ready` when DLT settings are usable | Setup progress (default not_started). ready means config present. Approval of copy is regulated_channel_templates. |
| `created_at` | `timestamp without time zone` | yes | — | When SMS config was created. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last settings/status change. Audit. |

## `campaign.tenant_industry_packs`

Per-tenant industry pack: soft contact field hints and editable company rules seeded from organizations.industry_type.

pack_id chooses B2B vs B2C field language. Not a performance metric source.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of the tenant industry pack row. One per organization. |
| `organization_id` | `bigint` | yes | — | Tenant whose field hints and rules these are. Unique. Seeded from organizations.industry_type. |
| `pack_id` | `text` | yes | `generic-b2b`, `generic-b2c` | generic-b2b or generic-b2c family. Drives contact field language in Campaign. Not a send channel. |
| `seed_industry_type` | `text` | yes | — | Snapshot of accounts.organizations.industry_type at seed time. Pack can drift from live org industry_type if Accounts later changes. |
| `payload` | `jsonb` | yes | — | JSON { version, mode, fields[], rules[] } for hints and company rules. Soft hints, not a forced ask queue. Not KPI JSON. |
| `created_at` | `timestamp without time zone` | yes | — | When the pack was seeded. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last rules/fields edit. Audit. |

## `campaign.campaign_recommendations`

Shared recommendation board cards for Campaign SPA and CRM embed. Full card JSON lives in payload.

public_id is the frontend rec-… id. Board status is product state, not a send KPI.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a recommendation board card. Frontend uses public_id (rec-…). |
| `organization_id` | `bigint` | yes | — | Tenant board this card sits on. Unique with public_id. |
| `branch_id` | `bigint` | yes | — | Workspace of the card (no Postgres FK). CRM embed and SPA share this board per org/branch. |
| `created_by_user_id` | `bigint` | yes | — | Who created the card. Required. Not the campaign created_by unless they later launch. |
| `public_id` | `text` | yes | — | Frontend rec-… id. Stable across the JSON payload. |
| `status` | `text` | yes | Board strings such as `open`, `used`, `dismissed` | Board state as text (open / used / dismissed, etc.). Not campaigns.status. Used cards may still exist. |
| `title` | `text` | yes | — | Card title (default empty). List display. |
| `payload` | `jsonb` | yes | — | Full recommendation JSON for the card. Default {}. Agents persist structured suggestion here. |
| `created_at` | `timestamp without time zone` | yes | — | When the card was created. Board sort with updated_at. |
| `updated_at` | `timestamp without time zone` | yes | — | Last status or payload change. Index for recent cards. |

## `campaign.app_notifications`

In-app bell items (approvals, activity). user_id null means visible to the whole tenant.

source_key dedupes. Unread count is product UX, not Dashboard campaign performance.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a bell item. Dedup uses source_key per org, not this id in writers. |
| `organization_id` | `bigint` | yes | — | Tenant that can see this notification. Unique with source_key. |
| `user_id` | `bigint` | no | — | Target user; null means whole tenant. Logical accounts.setup_users.id. Unread queries include nulls for org-wide items. |
| `kind` | `text` | yes | — | Notification type (e.g. template_pending). Renders icon/copy. Not a send KPI. |
| `title` | `text` | yes | — | Bell title. Short copy. |
| `body` | `text` | yes | — | Bell body. Detail copy. |
| `href` | `text` | no | — | Optional deep link in the SPA. Null if not clickable. |
| `source_key` | `text` | yes | — | Dedup key so the same event is not inserted twice. e.g. template:pending:301. |
| `created_at` | `timestamp without time zone` | yes | — | When the bell item was inserted. Sort newest first. |
| `read_at` | `timestamp without time zone` | no | — | When it was read; null = unread. Tier 3 unread count uses IS NULL. |

## `campaign.campaign_opportunity_events`

Forms and similar events the operator launches. payload holds schema and theme for the public form.

open_count and submission_count are event-tracking metrics (Tier 2 on Events, not Dashboard Overview headlines).

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a form/event. Public APIs use public_id and public_slug. |
| `organization_id` | `bigint` | yes | — | Tenant that owns the event. Unique with public_id. |
| `branch_id` | `bigint` | yes | — | Workspace of the event (no Postgres FK). Same scoping idea as campaigns.branch_id. |
| `created_by_user_id` | `bigint` | yes | — | Owner of the event. Required. |
| `public_id` | `text` | yes | — | Frontend event id (e.g. evt_form_1). Form submissions store this as event_public_id. |
| `kind` | `text` | yes | Default `form` | Event type (default form). Reserved for webinars etc. Payload shape depends on kind. |
| `status` | `text` | yes | Default `draft`; launched / live strings when published | Lifecycle (default draft; launched when public). Not campaigns.status. Only launched events should take public traffic. |
| `title` | `text` | yes | — | Event name shown in Events tracking. Default empty until set. |
| `public_slug` | `text` | no | — | Globally unique public /f/:slug when set. Null while unpublished. Unique constraint when present. |
| `launched_at` | `timestamp without time zone` | no | — | When the form went public. Null in draft. Not a campaign launch_local_date. |
| `submission_count` | `integer` | yes | — | Cached reply count for the event. Tier 2 events metric. Should match campaign_form_submissions count. |
| `open_count` | `integer` | yes | — | Cached public open/view count for the form. Denominator for form conversion with submission_count. |
| `payload` | `jsonb` | yes | — | JSON form schema, theme, fields — SPA OpportunityEvent shape. Default {}. Submissions copy field defs into their own fields column. |
| `created_at` | `timestamp without time zone` | yes | — | When the event was created. Audit. |
| `updated_at` | `timestamp without time zone` | yes | — | Last title/schema/status change. Events list sort. |

## `campaign.campaign_form_submissions`

One public form reply. Joined to the event by event_public_id, not a Postgres FK.

Count these rows for submission volume. answers is the respondent payload; fields is the schema snapshot at submit time.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a public reply. External id is public_reply_id. |
| `organization_id` | `bigint` | yes | — | Tenant that received the reply. Must match the event’s org. |
| `event_public_id` | `text` | yes | — | Logical join to campaign_opportunity_events.public_id (no FK). All replies for an event share this. |
| `form_slug` | `text` | yes | — | Public slug at submit time. May remain even if the event slug later changes. |
| `public_reply_id` | `text` | yes | — | Public id of this reply. Unique. Shown to respondents if needed. |
| `answers` | `jsonb` | yes | — | Submitted values JSON. The actual reply. Default {}. |
| `fields` | `jsonb` | yes | — | Field definitions snapshot at submit time. Keeps historical replies renderable if the live schema changes. |
| `created_at` | `timestamp without time zone` | yes | — | When the reply was received. Time series for submissions. Not campaign launch date. |

## `campaign.daily_report_email_deliveries`

Log so each user gets at most one daily KPI email per calendar date in their timezone.

This is report-delivery ops, not the KPI catalog itself. Unique (organization_id, user_id, report_date).

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of a daily KPI email log row. Unique (organization_id, user_id, report_date) prevents duplicates. |
| `organization_id` | `bigint` | yes | — | Tenant the report is about. Same org as the campaigns in the email. |
| `user_id` | `bigint` | yes | — | Marketer who should receive the email (setup_users.id). One row per user per report_date. |
| `report_date` | `text` | yes | — | Calendar date in the recipient timezone (YYYY-MM-DD). The KPIs inside the email use this day, not this row’s sent_at date if they differ. |
| `timezone` | `text` | yes | — | IANA zone used to interpret report_date (default Asia/Kolkata). May differ from a campaign’s timezone. |
| `recipient_email` | `text` | yes | — | To address of the daily report. Copied from the user. Encrypted companion is recipient_email_enc. |
| `status` | `text` | yes | Default `sent`; also failure strings | Whether this attempt sent (default sent) or failed. Log of the report pipeline, not campaign send_recipients.status. |
| `provider_id` | `text` | no | — | ESP id for this report email, if any. Null on some failures. |
| `error_message` | `text` | no | — | Failure text when the report email did not send. Null on success. |
| `sent_at` | `timestamp without time zone` | yes | — | When the send was attempted. Default now(). Dedup still keys report_date, not sent_at. |
| `recipient_email_enc` | `bytea` | no | — | Encrypted To address. Do not expose to UI. |

# Schema `accounts` (Campaign uses these tables)


Campaign does not own this schema. Below is **every live column** on the tables Campaign actually queries or writes. Other Accounts tables are out of scope.

## `accounts.organizations`

The tenant company in Accounts. Campaign copies id onto every campaign row as organization_id.

Campaign login reads company_name, business_type (B2B/B2C product mode), and industry_type (industry pack seed). Other columns belong to Accounts but sit on this same tenant row.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `tenant_id` | `character varying(16)` | yes | — | Accounts short tenant code (varchar), separate from numeric id. Campaign filters use id/organization_id, not this code, unless a specific Accounts screen shows it. |
| `company_name` | `character varying(255)` | no | — | Company display name Campaign login puts on the session as orgName. Shown in the SPA chrome. Not email_org_profiles.legal_name unless they happen to match. |
| `industry_type` | `character varying(128)` | no | — | Vertical string Campaign seeds into tenant_industry_packs.seed_industry_type. Gallery ideas also personalize from this. Free text from Accounts onboarding. |
| `contact_name` | `character varying(255)` | no | — | Accounts primary contact person for the company. Campaign login does not currently SELECT this; it still sits on the tenant row we join. |
| `designation` | `character varying(128)` | no | — | Job title of the Accounts primary contact. Accounts CRM field on the org, not a campaign operator role. |
| `work_email` | `character varying(255)` | no | — | Company work email on the org profile. Not setup_users.work_email (that is the login user). Encrypted companion is work_email_enc. |
| `admin_email` | `character varying(255)` | no | — | Admin contact email for the tenant in Accounts. Not Campaign daily_report recipient_email. Encrypted companion is admin_email_enc. |
| `tax_number` | `character varying(64)` | no | — | Tax/GST identifier on the Accounts org. Billing/Accounts. Campaign send does not read this. Encrypted as tax_number_enc. |
| `billing_address` | `text` | no | — | Billing address text in Accounts. Different from campaign.email_org_profiles street/city used in email footers. Encrypted as billing_address_enc. |
| `website_url` | `character varying(512)` | no | — | Company website in Accounts. May inform industry packs or gallery; not website_contacts.origin of visitors. |
| `country` | `character varying(128)` | no | — | Company country in Accounts. Not email_org_profiles.country (footer) and not customer_profile.country (person). |
| `company_size` | `character varying(64)` | no | — | Headcount band in Accounts. Onboarding metadata. Campaign KPIs do not group by this. |
| `mobile_country_code` | `character varying(8)` | no | — | Dialing code for the org mobile on Accounts. Encrypted companion exists. Not a WhatsApp send From. |
| `mobile_number` | `character varying(32)` | no | — | Org mobile number in Accounts. Not setup_users.mobile_number of a marketer. |
| `lifecycle_status` | `character varying(32)` | yes | Accounts lifecycle strings on the tenant | Accounts tenant lifecycle (lead vs live customer, etc.). Campaign still keys access off organization_products, not this column. |
| `converted_at` | `timestamp with time zone` | yes | — | When Accounts marked this org converted. Accounts funnel. Not campaign launch time. |
| `created_at` | `timestamp with time zone` | yes | — | When the tenant was created in Accounts. Not campaign.branches.created_at (workspace created later on first Campaign login). |
| `updated_at` | `timestamp with time zone` | yes | — | Last Accounts org profile change. If industry_type changes, Campaign packs may be stale until reseeded. |
| `business_type` | `character varying(64)` | no | `B2B`, `B2C` (Campaign product mode) | B2B vs B2C. Campaign login maps this to product mode and pack family. Missing/other values are treated as B2B in Campaign session building. |
| `support_portal_slug` | `character varying(63)` | no | — | Accounts support portal slug. Ticketing/Accounts feature. Campaign SPA does not route on this. |
| `support_portal_enabled` | `boolean` | yes | — | Whether the Accounts support portal is on. Boolean for another product. Not Campaign events public_slug. |
| `support_portal_welcome` | `text` | no | — | Welcome copy for the support portal. Accounts content. Not campaign template bodies. |
| `id` | `bigint` | yes | — | Tenant primary key. Campaign copies this onto every campaign.* row as organization_id. JWT/session organizationId is this bigint (API may stringify it). There is no FK from campaign into this table. |
| `reseller_id` | `bigint` | no | — | Accounts reseller this tenant belongs to, if any. Partner model. Campaign KPIs stay on organization_id. |
| `source_lead_id` | `bigint` | no | — | Lead that converted into this org, if any. Accounts attribution. Not campaign_recommendations. |
| `sip_domain_name` | `character varying(255)` | yes | — | SIP domain for CCaaS voice on this org. Voice product. Campaign users also have sip_* on setup_users; this is the org domain. |
| `admin_email_enc` | `bytea` | no | — | Encrypted admin_email. Do not return to Campaign UI. |
| `work_email_enc` | `bytea` | no | — | Encrypted work_email. Do not return to Campaign UI. |
| `mobile_country_code_enc` | `bytea` | no | — | Encrypted mobile country code. Do not return to Campaign UI. |
| `mobile_number_enc` | `bytea` | no | — | Encrypted org mobile. Do not return to Campaign UI. |
| `tax_number_enc` | `bytea` | no | — | Encrypted tax number. Do not return to Campaign UI. |
| `billing_address_enc` | `bytea` | no | — | Encrypted billing address. Do not return to Campaign UI. |

## `accounts.setup_users`

People who can log into Campaign. JWT subject is id. Password hash is never returned to the client.

Only status=active users authenticate. organization_id is their home tenant; Campaign does not store a parallel user table.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `employee_id` | `character varying(64)` | no | — | HR/employee code in Accounts. Not used as Campaign session id. |
| `first_name` | `character varying(128)` | yes | — | Given name Campaign concatenates into session.name. Display in Campaign chrome. Distinct from CDP first_name of contacts. |
| `last_name` | `character varying(128)` | yes | — | Family name used in session.name and initials. Same display role as first_name for the logged-in marketer. |
| `work_email` | `character varying(255)` | yes | — | Login email. Campaign authenticates with lower(work_email). Daily report To may copy this. Distinct from email_senders.from_email. |
| `mobile_number` | `character varying(32)` | no | — | Marketer’s mobile in Accounts. Not the contact phone on identity_keys. |
| `primary_language` | `character varying(64)` | no | — | Preferred UI language in Accounts. Campaign may still default copy generation from org industry pack, not this. |
| `secondary_language` | `character varying(64)` | no | — | Secondary language on the user. Accounts workforce field. |
| `location_id` | `character varying(128)` | no | — | Accounts location reference for the user. Not campaign.branches.id. |
| `status` | `character varying(32)` | yes | Must be `active` to log into Campaign | Account state. Campaign requires active to authenticate. Inactive users cannot obtain a Campaign session even if entitlements exist. |
| `created_at` | `timestamp with time zone` | yes | — | When the user was created in Accounts. Not campaign created_at. |
| `updated_at` | `timestamp with time zone` | yes | — | Last profile or status change on the user. Password changes also bump this. |
| `shift_types` | `jsonb` | no | — | JSON shift types for CCaaS workforce. Not Campaign send windows (those may live in CDP preferences_json). |
| `password_hash` | `text` | no | — | Password verifier. Never returned to the Campaign client. Campaign compares bcrypt (or legacy plaintext only if stored that way). |
| `invite_status` | `character varying(32)` | no | Accounts invite workflow strings | Accounts invite workflow for this user. Separate from status=active which is the login gate. |
| `password_set_at` | `timestamp with time zone` | no | — | When the user set a password. Null if never. Invite completion signal. |
| `invited_at` | `timestamp with time zone` | no | — | When the invite was sent. Accounts onboarding. |
| `skills` | `jsonb` | yes | — | JSON skills for routing in CCaaS. Default {}. Not campaign operator permissions (those are roles). |
| `city` | `character varying(128)` | no | — | User city in Accounts. Not cdp.customer_profile.city of a recipient. |
| `state` | `character varying(128)` | no | — | User state/region in Accounts. Workforce profile. |
| `country` | `character varying(128)` | no | — | User country in Accounts. Not organizations.country of the company. |
| `business_hours_id` | `bigint` | no | — | FK-like id to Accounts business hours. Voice/workforce. Campaign launch timezone is campaigns.timezone. |
| `id` | `bigint` | yes | — | User primary key. Campaign JWT subject and created_by_user_id values. Must be active to log in. Campaign has no parallel users table. |
| `organization_id` | `bigint` | yes | — | Home tenant of this user. Campaign session.organizationId. Users without this cannot use Campaign. Must match campaign row organization_id. |
| `team_id` | `bigint` | no | — | Accounts team the user belongs to. Not campaign.branches. Campaign RBAC uses setup_roles via product access. |
| `whatsapp_number` | `character varying(32)` | no | — | User’s WhatsApp number in Accounts (agent identity). Not the WABA display number on setup_social_configs. |
| `handling_regions` | `jsonb` | yes | — | JSON regions the user handles. CCaaS routing. Campaign audience filters do not use this. |
| `ext` | `integer` | yes | — | SIP extension integer. Voice. Campaign ignores this for email/WhatsApp send. |
| `sip_login_id` | `character varying(32)` | yes | — | SIP login id for the user. CCaaS. Not A2A client_id. |
| `sip_password` | `character varying(32)` | yes | — | SIP password for the user. Sensitive Accounts field. Campaign must not log or return it. |
| `sip_domain_name` | `character varying(128)` | yes | — | SIP domain on the user. Often matches organizations.sip_domain_name. |

## `accounts.setup_roles`

Named roles. Campaign treats name=admin as branch-wide reports; any other name as my campaigns only.

accessible_products and module flags are Accounts RBAC. Campaign session.role comes from the join through setup_user_product_access.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `name` | `character varying(255)` | yes | `admin` (branch-wide reports) vs other names (my campaigns) | Role slug. Campaign treats admin as branch-wide reports; any other name as my campaigns. This is the RBAC split for Dashboard and monitor lists. |
| `description` | `text` | no | — | Human description of the role in Accounts. Not shown as a Campaign KPI. |
| `accessible_products` | `jsonb` | yes | — | JSON which products this role may enter. Campaign still also checks organization_products for the campaign product. |
| `module_permission` | `character varying(128)` | no | — | Legacy single module permission string. Newer grants use module_permissions JSON. |
| `can_view` | `boolean` | yes | `true`, `false` | Accounts flag: view permission on the assigned module set. Campaign reporting uses name=admin vs not, more than these booleans. |
| `can_create` | `boolean` | yes | `true`, `false` | Accounts flag: create permission. Does not replace Campaign tool-level checks in agents. |
| `can_edit` | `boolean` | yes | `true`, `false` | Accounts flag: edit permission. Accounts RBAC. |
| `can_delete` | `boolean` | yes | `true`, `false` | Accounts flag: delete permission. Accounts RBAC. |
| `can_export` | `boolean` | yes | `true`, `false` | Accounts flag: export permission. Recipient CSV export in Campaign should still honor Campaign session + org. |
| `can_approve` | `boolean` | yes | `true`, `false` | Accounts flag: approve permission. Not Meta/DLT template approval (that is regulated_channel_templates.status). |
| `created_at` | `timestamp with time zone` | yes | — | When the role was created. Audit. |
| `updated_at` | `timestamp with time zone` | yes | — | Last permission change on the role. Audit. |
| `product_id` | `character varying(128)` | no | — | Which product this role is defined for (e.g. campaign). Join with setup_user_product_access.product_id when resolving Campaign role. |
| `module_permissions` | `jsonb` | no | — | JSON module ACL for this role. Accounts fine-grained modules. Campaign SPA modules are separate config. |
| `id` | `bigint` | yes | — | Role primary key. setup_user_product_access.role_id points here. Campaign resolves session.role from the joined name. |
| `organization_id` | `bigint` | yes | — | Tenant this role belongs to. Roles are not global across orgs. |

## `accounts.setup_user_product_access`

Join of user + organization + role (and product_id). Campaign uses this to resolve session.role.

Filter product_id for campaign when granting access. This is not campaign row-level ACL beyond creator vs admin reporting.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `product_id` | `character varying(128)` | yes | — | Product this grant is for (Campaign uses campaign). Without a campaign grant the user should not get a Campaign session. |
| `created_at` | `timestamp with time zone` | yes | — | When the grant was created. Audit. |
| `id` | `bigint` | yes | — | Primary key of a user-product-role grant. Campaign queries by user_id + organization_id (+ product). |
| `organization_id` | `bigint` | yes | — | Tenant of the grant. Must match setup_users.organization_id for normal Campaign login. |
| `role_id` | `bigint` | yes | — | Accounts role for this grant. Joined to setup_roles.name to set session.role (admin vs my-campaigns). |
| `user_id` | `bigint` | yes | — | User receiving the grant (setup_users.id). A user may have multiple product rows; Campaign picks campaign and prefers admin. |

## `accounts.setup_channel_configs`

Cross-product channel integrations (WhatsApp, email, and others) owned by Accounts.

Campaign lists status in Configuration, resolves WhatsApp channel_config_id internally, and requires product_ids to include campaign for mailbox send.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `channel_type` | `character varying(32)` | yes | `email`, `whatsapp`, `meta_whatsapp`, `social`, … | email, whatsapp, meta_whatsapp, social, … WhatsApp resolver also matches social names containing whatsapp. |
| `name` | `character varying(255)` | yes | — | Display name of the connection (e.g. a WABA label). Helps operators recognize which WhatsApp line is connected. |
| `status` | `character varying(32)` | yes | `active`, `pending`, and other connection states | Connection state (active, pending, …). Campaign prefers active rows. This is not campaign_send_recipients.status. |
| `product_ids` | `jsonb` | yes | — | JSONB which products may use this config. Mailbox SQL requires campaign. Configs without campaign are ignored for Campaign send-ready. |
| `created_at` | `timestamp with time zone` | yes | — | When the integration was created in Accounts. Audit. |
| `updated_at` | `timestamp with time zone` | yes | — | Last connection update. Campaign orders WhatsApp picks by this. Fresher active rows win. |
| `id` | `bigint` | yes | — | Accounts channel config id. Campaign stores it on regulated_channel_templates.channel_config_id internally. Never show this id in Campaign UI. WhatsApp Graph uses it. |
| `organization_id` | `bigint` | yes | — | Tenant that owns the integration. Campaign Configuration lists rows for this org. |
| `settings` | `jsonb` | yes | — | JSON provider settings on the channel config. Email details usually live on setup_email_configs; WhatsApp details on social configs. Do not leak secrets to FE. |

## `accounts.setup_email_configs`

Mailbox From / SMTP / hosted-domain settings hanging off a channel config. Used for connected-inbox test send, not the bulk ESP From in campaign.email_senders.

OAuth tokens live on mail_oauth_connections via oauth_connection_id. provisioning_status and domain_verification_status are mailbox ops.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `provider_type` | `character varying(32)` | yes | Mailbox provider strings | Mailbox provider class. Drives OAuth vs SMTP vs hosted domain logic in Campaign mailbox DAO. |
| `third_party_mode` | `character varying(32)` | no | — | How third-party mail is connected, if any. Null for some hosted modes. |
| `sender_email` | `character varying(255)` | no | — | From address for connected-inbox / test send from Accounts. Not campaign.email_senders.from_email (bulk ESP). Campaign mailbox UI shows this. |
| `sender_name` | `character varying(255)` | no | — | From display name for that mailbox. Not email_org_profiles.legal_name. |
| `reply_to` | `character varying(255)` | no | — | Reply-To for the connected mailbox. Optional. |
| `domain` | `character varying(255)` | no | — | Mailbox sending domain in Accounts. domain_verification_status applies here. Distinct from campaign.email_domains.domain though they may match. |
| `domain_verification_status` | `character varying(32)` | no | — | Whether Accounts considers this mailbox domain verified. Blocks send_ready when not verified. |
| `domain_verification_token` | `character varying(128)` | no | — | Token for domain verification. Server only. |
| `smtp_host` | `character varying(255)` | no | — | SMTP host for custom SMTP mode. Null when using OAuth-only. |
| `smtp_port` | `integer` | no | — | SMTP port. Null if unused. |
| `smtp_secure` | `boolean` | no | `true`, `false` | Whether SMTP uses TLS/SSL. Null if unused. |
| `imap_host` | `character varying(255)` | no | — | IMAP host if the mailbox also receives. Campaign test-send cares about SMTP/OAuth more than IMAP. |
| `imap_port` | `integer` | no | — | IMAP port. Null if unused. |
| `imap_secure` | `boolean` | no | `true`, `false` | Whether IMAP is secure. Null if unused. |
| `smtp_user_encrypted` | `text` | no | — | Encrypted SMTP username. Never log or return. |
| `smtp_pass_encrypted` | `text` | no | — | Encrypted SMTP password. Never log or return. |
| `imap_user_encrypted` | `text` | no | — | Encrypted IMAP username. Never log or return. |
| `imap_pass_encrypted` | `text` | no | — | Encrypted IMAP password. Never log or return. |
| `requested_local_part` | `character varying(128)` | no | — | Requested local-part when provisioning a hosted mailbox. Shown in Campaign mailbox status. |
| `hosted_domain` | `character varying(255)` | yes | — | Hosted domain for provisioned mailboxes. Required on the table; used with provisioning_status. |
| `provisioning_status` | `character varying(32)` | no | — | Hosted mailbox provisioning state. Pending provision blocks send_ready. |
| `created_at` | `timestamp with time zone` | yes | — | When this mailbox config was created. Audit. |
| `updated_at` | `timestamp with time zone` | yes | — | Last mailbox setting change. Campaign orders mailboxes by parent channel updated_at primarily. |
| `oauth_provider` | `character varying(32)` | no | `google`, `microsoft`, or null | google, microsoft, or null. Selects which mail_oauth_connections row shape to expect. |
| `ccaas_handler` | `character varying(32)` | no | — | How CCaaS handles this mailbox (bot vs agent). Campaign is_bot is the boolean cousin on this row. |
| `is_bot` | `boolean` | yes | `true`, `false` | Whether this mailbox is a bot handler. Campaign send-ready evaluation still requires tokens/verification. |
| `channel_config_id` | `bigint` | yes | — | Parent setup_channel_configs.id. Join key for Campaign mailbox SQL. |
| `id` | `bigint` | yes | — | Primary key of an email mailbox config. Joined from setup_channel_configs via channel_config_id. |
| `oauth_connection_id` | `bigint` | no | — | FK-like id to mail_oauth_connections. Null for SMTP-only. Campaign LEFT JOINs this for needs_reauth. |

## `accounts.mail_oauth_connections`

Encrypted Google / Microsoft tokens for a connected mailbox. Never log refresh tokens.

Campaign joins this for send_ready evaluation of Accounts email. needs_reauth blocks inbox test send until the operator reconnects.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `account_type` | `character varying(16)` | yes | OAuth account class | OAuth account class (personal vs work, etc.). Accounts field. Campaign mainly needs tokens and needs_reauth. |
| `mailbox_profile` | `character varying(64)` | yes | — | Profile label for the connected mailbox. Display/ops. |
| `account_email` | `character varying(255)` | yes | — | Connected mailbox address Campaign maps as oauth_account_email. Must match the mailbox being used for test send. |
| `account_name` | `character varying(255)` | no | — | Display name from the OAuth provider. Optional. |
| `ms_tenant_id` | `character varying(64)` | no | — | Microsoft tenant id when provider is Microsoft. Null for Google. |
| `access_token_encrypted` | `text` | yes | — | Encrypted access token. Never log. Campaign decrypts server-side to send. |
| `refresh_token_encrypted` | `text` | yes | — | Encrypted refresh token. Never log. Reauth required if missing/invalid. |
| `expires_at` | `timestamp with time zone` | yes | — | When the access token expires. Campaign treats near-expiry as oauth_needs_reauth together with needs_reauth. |
| `scope` | `text` | no | — | Granted OAuth scopes. Must include send scope for test send. |
| `needs_reauth` | `boolean` | yes | `true`, `false` | Operator must reconnect this mailbox. True blocks Campaign send_ready for inbox send. |
| `created_at` | `timestamp with time zone` | yes | — | When OAuth was connected. Audit. |
| `updated_at` | `timestamp with time zone` | yes | — | Last token refresh or reauth flag change. Audit. |
| `account_id` | `bigint` | yes | — | Accounts user/account this OAuth belongs to. Not setup_users.id necessarily the same as Campaign session user if shared. |
| `id` | `bigint` | yes | — | Primary key of an OAuth mailbox connection. setup_email_configs.oauth_connection_id points here. |

## `accounts.a2a_spoke_clients`

Agent-to-agent client credentials between Hub and Campaign (client_id, secrets, access/refresh tokens).

Seeded and updated by Campaign A2A code. This is integration ops, not a marketing KPI table.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `id` | `bigint` | yes | — | Primary key of an A2A client credential row. Hub and Campaign look up by a2a_server_name / client_id. |
| `a2a_server_name` | `character varying(64)` | yes | — | Spoke name (e.g. worktual-campaign). Selects which secret Hub uses to call Campaign A2A. |
| `client_id` | `character varying(128)` | yes | — | OAuth-style client id for the spoke. Public identifier of the A2A client. |
| `client_secret` | `text` | no | — | Client secret. Treat as confidential. Never log. Used to mint tokens. |
| `access_token` | `text` | no | — | Current access token for Hub↔Campaign A2A. Sensitive. Expiry in access_expires_at. |
| `access_expires_at` | `timestamp with time zone` | no | — | When the access token expires. Clients refresh after this. |
| `refresh_token` | `text` | no | — | Refresh token for A2A. Sensitive. Never log. |
| `refresh_expires_at` | `timestamp with time zone` | no | — | When the refresh token expires. After this, re-seed credentials. |
| `skill_version` | `character varying(64)` | no | — | Optional skill catalog version the client registered. Helps Hub know Campaign capabilities. |
| `created_at` | `timestamp with time zone` | yes | — | When the A2A row was inserted. Audit. |
| `updated_at` | `timestamp with time zone` | yes | — | Last token rotation. Ops freshness of Hub integration. |
| `organization_id` | `bigint` | no | — | Optional tenant scope for the A2A client. Null for some global Hub clients. Campaign on-demand still runs in a user org. |

## `accounts.auth_sessions`

Live login session rows. Campaign writes product_id=campaign to enforce one active Campaign session per email when the table exists.

Token columns are short; JWTs may be stored hashed. This is auth ops, not campaign performance.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `token` | `character varying(128)` | yes | — | Session token stored for Campaign login (hashed if the JWT is longer than 128 chars). Campaign writes product_id=campaign. Used to block a second live Campaign session. |
| `email` | `character varying(255)` | yes | — | Login email this session belongs to. Lookups are case-insensitive. Encrypted companion is email_enc. |
| `role` | `character varying(32)` | yes | — | Role snapshot stored on the session row. Campaign also re-resolves role from setup_user_product_access at login. |
| `display_name` | `character varying(255)` | no | — | Display name cached on the session. Optional. Session.name in Campaign usually comes from setup_users. |
| `expires_at` | `timestamp with time zone` | yes | — | When this auth session expires. Campaign treats rows with expires_at > now() as live. |
| `user_id` | `bigint` | no | — | setup_users.id for this session, if the column exists. Campaign insert includes this when present in the live schema. |
| `presence_initialized_at` | `timestamp with time zone` | no | — | When presence was initialized for this session. CCaaS-oriented. Campaign may ignore. |
| `product_id` | `character varying(128)` | no | Campaign writes `campaign` | Which product owns this session. Campaign writes campaign. Other products’ sessions do not block Campaign login. |
| `email_enc` | `bytea` | no | — | Encrypted session email. Do not return to UI. |

# Schema `cdp` (Campaign uses these tables)


Campaign may only use existing columns. Soft-delete is `custom_fields.campaign_deleted`. Campaign does not use `cdp.campaigns` or `cdp.campaign_deliveries` for product KPIs.

## `cdp.customer_profile`

Canonical person in CDP. Audience APIs expose the full text cdp_id (CDP-…). Campaign Postgres stores a derived bigint contact_id.

Campaign may SELECT/INSERT/UPDATE/DELETE existing columns only. Soft-delete in Campaign UI sets custom_fields.campaign_deleted=true. preferences_json holds channel 0|1 flags.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `cdp_id` | `text` | yes | — | Canonical person id as text (CDP-{source}-org{org}-{external_id}). APIs and launch_plan.audience_cdp_ids use this. Campaign tables store a derived bigint contact_id instead. |
| `first_name` | `character varying(128)` | no | — | Given name of the person in CDP. Campaign contact list SELECT this. Sheet promote writes here from temp first_name. |
| `last_name` | `character varying(128)` | no | — | Family name of the person in CDP. Same list/display role as first_name for Audience. |
| `gender` | `character varying(32)` | no | — | Optional gender on the CDP profile. Campaign UI does not require it. May appear in custom filters via SQL agent if selected. |
| `date_of_birth` | `date` | no | — | Optional date of birth. CDP demographic. Campaign send does not use this as a KPI. |
| `company` | `character varying(255)` | no | — | Company name. Campaign APIs expose this as company_name. B2B audience filters. Distinct from accounts.organizations.company_name (the tenant). |
| `city` | `character varying(128)` | no | — | Person city in CDP. Audience filters. Distinct from email_org_profiles.city (sender legal city). |
| `region` | `character varying(128)` | no | — | Region/state of the person. CDP geo. Campaign lists currently project city more than region. |
| `country` | `character varying(128)` | no | — | Person country in CDP. Not the tenant country on organizations. |
| `language` | `character varying(64)` | no | — | Preferred language of the person. May inform template language; regulated templates have their own language column. |
| `timezone` | `character varying(64)` | no | — | Person timezone in CDP. Not campaigns.timezone (launch calendar) and not daily_report timezone. |
| `acquisition_channel` | `character varying(128)` | no | Campaign inserts `campaign` for people created in this product | How the person entered CDP. Campaign inserts campaign for people created here. Filter origin of contacts. Not campaigns.source_channel (that is CRM vs SPA). |
| `acquisition_date` | `date` | no | — | Date they were acquired. CDP funnel. Distinct from first_seen_at which is activity. |
| `first_referrer` | `text` | no | — | First referrer URL/source if known. Web/CDP attribution. Not website_contacts.origin (Campaign visitor table). |
| `first_seen_at` | `timestamp with time zone` | no | — | First observed activity on the profile. CDP activity. website_contacts has its own first_seen_at for anonymous visitors. |
| `last_seen_at` | `timestamp with time zone` | no | — | Last observed activity on the profile. Recency in Audience. Not last_email_opened_at on campaign_contact_engagement. |
| `created_at` | `timestamp with time zone` | yes | — | When the CDP profile row was created. Contact list default sort uses this with name. |
| `updated_at` | `timestamp with time zone` | yes | — | Last profile field change in CDP. Campaign preference writes bump this. |
| `organization_id` | `bigint` | yes | — | Tenant that owns the profile. Campaign contact SQL always filters this. Must match the Campaign session org. bigint like Campaign organization_id. |
| `custom_fields` | `jsonb` | yes | — | JSONB extras (job_title, score, segment). Campaign soft-delete sets campaign_deleted=true here. Audience SQL agent filters keys. Not preferences_json (channel flags). |
| `tenant_id` | `text` | yes | — | CDP text tenant key on the profile (required in live DB). Campaign queries use organization_id::text. Keep tenant_id consistent when inserting. |
| `preferences_json` | `jsonb` | yes | — | Channel 0\|1 flags (email, whatsapp, push, web, sms) plus optional send windows. Campaign contacts UI updates this column only for preferences. Not open/click facts. |
| `consent_json` | `jsonb` | yes | — | Consent flags JSON in CDP. Campaign should not mail against revoked consent when present. Distinct from email_unsubscribed in Campaign engagement. |
| `traits_json` | `jsonb` | yes | — | CDP computed/trait JSON. Read-only for Campaign in practice. Not custom_fields operator extras. |
| `contact_type` | `character varying(200)` | no | — | CDP classification of the person (lead, customer, …). Optional audience filter. Not campaigns.status. |
| `primary_product` | `text` | no | — | Primary product associated with the person in CDP. CDP attribute. Not organization_products.product_code. |
| `industry` | `text` | no | — | Person/account industry on the profile. May overlay custom_fields. Distinct from organizations.industry_type of the tenant. |
| `blocked` | `boolean` | yes | `true`, `false` | CDP hard block of the person. If true, Campaign should not treat them as sendable even if not campaign_deleted. |

## `cdp.identity_keys`

Email and phone rows for a profile. Uniqueness and send-address lookup live here, not on the profile name fields.

Campaign matches key_type email/primary_email and phone/primary_phone/mobile. source_system=campaign on rows Campaign inserted.

| Column | Type | Required | Categorical values | Purpose |
|--------|------|----------|--------------------|---------|
| `identity_id` | `text` | yes | — | Primary key of one email/phone identity (text/uuid in live DB). A person has many keys. Lookups are by key_type+key_value+org. |
| `cdp_id` | `text` | yes | — | Parent profile’s full CDP text id. Must match customer_profile.cdp_id. Campaign joins ::text for mixed types. |
| `key_type` | `character varying(64)` | yes | `email`, `primary_email`, `phone`, `primary_phone`, `mobile` | email, primary_email, phone, primary_phone, or mobile. Campaign list picks latest verified email group and phone group via DISTINCT ON. |
| `key_value` | `character varying(255)` | yes | — | Normalized email or phone used to send and to dedupe. Suppression list is campaign.email_suppressions.email; match against this for people. |
| `source_system` | `character varying(255)` | no | — | Which system wrote the key. Campaign writes campaign on insert. Helps avoid treating CCaaS keys as Campaign-only. |
| `confidence_score` | `numeric` | no | — | How confident CDP is that this key belongs to the profile. Optional. Campaign prefers verified over this for listing. |
| `verified` | `boolean` | yes | `true`, `false` | Whether this email/phone is verified. List queries ORDER BY verified DESC then created_at. |
| `created_at` | `timestamp with time zone` | yes | — | When this identity row was added. Breaks ties after verified. |
| `organization_id` | `bigint` | yes | — | Tenant uniqueness for the key. Must match the profile org. Duplicate emails are prevented per org, not globally. |
| `custom_fields` | `jsonb` | yes | — | JSONB extras on the identity row. Not customer_profile.custom_fields. Rarely used by Campaign UI. |


---

# Three-tier metrics

Standard method unless a metric says otherwise:

- Tenant: `campaigns.organization_id = :org` (and the same on fact tables).
- Time (Dashboard and portfolio): campaign **`launch_local_date`** in **`campaigns.timezone`** (default Asia/Kolkata), not `created_at`.
- Ran campaigns: `campaigns.status IN ('live','completed','cancelled')`.
- Messaging headlines exclude PPC-only campaigns.
- Rates are unique events over **delivered**, capped at 100%. UI shows one decimal percent.

Code sources: `backend/src/dao/campaign-metrics.ts`, `backend/src/dao/portfolio-metrics.ts`, Dashboard (`DashboardOverviewPanel`, `dashboard-metrics.ts`).

---

## Tier 1 — Dashboard metrics

These are the Overview cards, delivered-by-channel strip, and delivery trend. They are the first numbers operators see.

### T1.1 Campaigns ran

**Definition:** How many campaigns actually ran in the Dashboard period (not drafts sitting in chat, not still scheduled).

**Calculation:** Count distinct `campaign.campaigns.id` where `status IN ('live','completed','cancelled')` and `launch_local_date` is in the selected period (interpreted in `timezone`). Exclude PPC-only. Hint on the card also splits live vs completed counts from the same set (`status='live'` / `status='completed'`).

**Tables / columns:** `campaign.campaigns.status`, `campaign.campaigns.launch_local_date`, `campaign.campaigns.timezone`, `campaign.campaigns.organization_id`, plus channel list from `campaign.campaign_channels.channel` or `launch_plan` to drop PPC-only.

### T1.2 Sent (Dashboard headline)

**Definition:** Count of **campaigns** (not messages) that had at least one **delivered** message in the period. The card hint shows message volume separately.

**Calculation:** From the ran set in T1.1, count campaigns where delivered volume ≥ 1. Delivered volume = count of `campaign_send_recipients` with delivery outcome sent (see shared rules), joined to batches and campaigns. If a campaign has no live recipient rows, fall back to `launch_plan.channel_run` delivered when the product does today.

**Tables / columns:** `campaign.campaigns.id`; `campaign.campaign_send_recipients.status`, `provider_message_id`, `skip_fail_reason`; `campaign.campaign_send_batches.campaign_id`, `channel`. Headline number = distinct campaigns, not `COUNT(recipients)`.

### T1.3 Failed (Dashboard headline)

**Definition:** Count of **campaigns** that had at least one send **failure** (recipient outcome failed).

**Calculation:** Ran campaigns where at least one recipient has status `failed` or `cancelled` (failed outcome). Hint shows message failure volume: count of those recipient rows.

**Tables / columns:** `campaign.campaign_send_recipients.status`, `campaign_id`; parent `campaign.campaigns` for period and ran filter. Skipped and bounce are not this headline (bounce is Tier 2/3).

### T1.4 Open rate

**Definition:** Unique email opens ÷ email delivered, as a percent.

**Calculation:** Numerator = count of email recipients with `opened_at IS NOT NULL` among delivered email rows. Denominator = delivered recipients on batches where `channel = 'email'`. Null if denominator is 0. Cap at 100%. Dashboard hint: `{opens} unique email of {delivered} delivered`.

**Tables / columns:** `campaign.campaign_send_batches.channel`; `campaign.campaign_send_recipients.opened_at`, `status`, `provider_message_id`, `skip_fail_reason`. Do **not** use `open_count` or `campaign_contact_engagement.email_open_count` for this card.

### T1.5 Click rate

**Definition:** Unique clicks ÷ delivered on click-tracked channels (email, app push, web push).

**Calculation:** Numerator = recipients with `clicked_at IS NOT NULL` on batches `channel IN ('email','push','web')` that are delivered. Denominator = delivered on those same channels. Null if denominator is 0.

**Tables / columns:** `campaign.campaign_send_batches.channel`; `campaign.campaign_send_recipients.clicked_at`, delivery columns as T1.4. Do not mix WhatsApp/SMS into this rate (they are not click-tracked in product).

### T1.6 Delivered by channel (cards)

**Definition:** Per channel that had volume: how many ran campaigns used it, how many messages delivered, unique opens when the channel tracks opens, plus stub count if any.

**Calculation:** Group delivered recipient counts by `campaign_send_batches.channel`. `campaigns` on the card = distinct ran `campaign_id` in that group. Opens = unique `opened_at` only when channel is email.

**Tables / columns:** `campaign.campaign_send_batches.channel`; `campaign.campaign_send_recipients` delivery and `opened_at`; `campaign.campaigns` for ran/period.

### T1.7 Delivery trend (chart)

**Definition:** Daily series in the period: messages delivered (all messaging channels), unique email opens, unique email clicks.

**Calculation:** Bucket by launch calendar day (same timezone rules as T1.1) or by the Dashboard activity series helper that aligns days in range. Each day: count delivered recipients; count email unique opens; count email unique clicks.

**Tables / columns:** same fact columns as T1.4–T1.6; time from `campaigns.launch_local_date` / `timezone`.

### T1.8 Dashboard campaign monitoring preview (max 5)

**Definition:** Per listed campaign: Targeted, Delivered, Opened, Clicked, Audience.

**Calculation:** Targeted and Audience = `campaigns.audience_count` (frozen size). Delivered / Opened / Clicked = same unique/delivered rules as T1.4–T1.6 restricted to that `campaign_id`. Scheduled tab omits these performance cells.

**Tables / columns:** `campaign.campaigns.audience_count`, `name`, `status`; recipient/batch facts as above.

---

## Tier 2 — Other important product metrics (not Dashboard Overview)

Campaign monitor, contact performance, events tracking, and A/B — the numbers used to run a single campaign or a person, but not the five Overview cards.

### T2.1 Selected (per campaign / channel)

**Definition:** How many people were planned for this campaign (or this channel).

**Calculation:** Prefer `campaigns.audience_count`, or `COUNT(*)` from `campaign.campaign_audience` for that `campaign_id`. Channel selected may use pending/queued recipient rows or launch_plan channel audience when the UI splits by channel.

**Tables / columns:** `campaign.campaigns.audience_count`; `campaign.campaign_audience.campaign_id`, `contact_id`; optionally `campaign_send_recipients` still pending.

### T2.2 Sent volume (messages)

**Definition:** Count of delivered messages (accepted real sends), not campaign count.

**Calculation:** Count recipient rows with outcome sent (shared rules). Per channel: filter `campaign_send_batches.channel`.

**Tables / columns:** `campaign.campaign_send_recipients.status`, `provider_message_id`; `campaign.campaign_send_batches.channel`, `campaign_id`.

### T2.3 Failed volume

**Definition:** Count of recipient rows with failed outcome.

**Calculation:** `status IN ('failed','cancelled')`. Per campaign and per channel.

**Tables / columns:** `campaign.campaign_send_recipients.status`, `campaign_id`; batch `channel`.

### T2.4 Bounced

**Definition:** Email (or other) deliveries the provider rejected as bounce.

**Calculation:** `status IN ('bounced','hard_bounce','soft_bounce')` OR `skip_fail_reason` matches bounce language. Shown on campaign monitor detail, not Dashboard Failed.

**Tables / columns:** `campaign.campaign_send_recipients.status`, `skip_fail_reason`.

### T2.5 Delivered volume

**Definition:** Sent minus bounces minus stubs. Denominator for rates.

**Calculation:** Outcome sent and not bounce. Same for one campaign or one channel.

**Tables / columns:** same as T2.2 plus bounce columns in T2.4.

### T2.6 Unique opens / unique clicks (one campaign)

**Definition:** Distinct recipients who opened or clicked on that campaign.

**Calculation:** Count rows with `opened_at` / `clicked_at` not null among delivered, with channel rules (opens: email; clicks: email/push/web).

**Tables / columns:** `campaign.campaign_send_recipients.opened_at`, `clicked_at`; `campaign.campaign_send_batches.channel`.

### T2.7 Total opens / total clicks

**Definition:** Repeat engagement (every pixel / every tracked click).

**Calculation:** `SUM(open_count)`, `SUM(click_count)` on the same recipient set.

**Tables / columns:** `campaign.campaign_send_recipients.open_count`, `click_count`.

### T2.8 CTOR (click-to-open)

**Definition:** Unique clicks ÷ unique opens on email. Null if opens = 0.

**Calculation:** T2.6 clicks / T2.6 opens for email. Cap at 100%.

**Tables / columns:** `opened_at`, `clicked_at` on email recipients.

### T2.9 Email A/B variant performance

**Definition:** Open rate and click rate for variants a, b, holdout, winner.

**Calculation:** Same unique/delivered formulas filtered by `ab_variant`. Split percents come from `launch_plan` A/B config.

**Tables / columns:** `campaign.campaign_send_recipients.ab_variant`, `opened_at`, `clicked_at`, delivery columns; `campaign.campaigns.launch_plan`.

### T2.10 Audience missed

**Definition:** People in the frozen audience who did not get a successful send (failed + skipped + not_sent + pending, depending on UI).

**Calculation:** Audience contact_ids minus recipients with outcome sent. UI may also add stub into a separate stub bucket.

**Tables / columns:** `campaign.campaign_audience.contact_id`; `campaign.campaign_send_recipients.contact_id`, `status`, `provider_message_id`.

### T2.11 Contact — delivered / open rate / click rate

**Definition:** For one person, how often they were successfully sent, and their open/click rates.

**Calculation:** Prefer email channel stats for that `contact_id`; else roll up all channels. Rates = unique opens or clicks ÷ delivered for that contact. Fall back to `campaign_contact_engagement.email_open_count` / `email_click_count` when recipient stats are thin. Show unsub warning if `email_unsubscribed` is true.

**Tables / columns:** `campaign.campaign_send_recipients.contact_id`, delivery and engagement columns; `campaign.campaign_contact_engagement.email_unsubscribed`, `email_open_count`, `email_click_count`; campaign name from `campaign.campaigns.name`.

### T2.12 Contact — campaigns received

**Definition:** History list of campaigns this person was sent on, with channel chips and last outcome.

**Calculation:** Distinct `campaign_id` from recipients for that contact_id; last `updated_at` or sent time; channels from batches; outcome from latest recipient status.

**Tables / columns:** `campaign.campaign_send_recipients`; `campaign.campaign_send_batches.channel`; `campaign.campaigns.name`.

### T2.13 Events — form opens and submissions

**Definition:** How many times a public form was opened vs how many replies.

**Calculation:** `campaign_opportunity_events.open_count` and `submission_count`, or `COUNT(*)` from `campaign_form_submissions` per `event_public_id`. Conversion ≈ submissions / opens when opens > 0.

**Tables / columns:** `campaign.campaign_opportunity_events.open_count`, `submission_count`, `public_id`, `status`; `campaign.campaign_form_submissions.event_public_id`, `created_at`.

### T2.14 PPC / ads (when present)

**Definition:** Impressions, clicks, CTR, spend, CPC, conversions, CPA from ads — not recipient rows.

**Calculation:** Read `campaigns.launch_plan.channel_run` (and related JSON) for PPC channel. CTR = clicks/impressions; CPC = spend/clicks; CPA = spend/conversions when denominators exist.

**Tables / columns:** `campaign.campaigns.launch_plan` (JSON). There is no live ads fact table in Campaign Postgres today.

---

## Tier 3 — Ops and least-important metrics

Configuration health, compliance, stubs, jobs, and other diagnostics. Useful for running the pipe, not for the Dashboard story.

### T3.1 Stub sends

**Definition:** Demo / local deliveries that must not count as inbox success.

**Calculation:** Count recipients with stub outcome (`status` stub/stub_sent or stub `provider_message_id`).

**Tables / columns:** `campaign.campaign_send_recipients.status`, `provider_message_id`.

### T3.2 Bounce rate

**Definition:** How much attempted email is bouncing.

**Calculation:** bounces / (delivered + bounces) or bounces / attempted, documented as bounces ÷ (sent volume + bounces) on email channel. Do not put this on Dashboard Overview.

**Tables / columns:** `campaign.campaign_send_recipients.status`, `skip_fail_reason`; `campaign.campaign_send_batches.channel = 'email'`.

### T3.3 Suppressions and unsubscribes

**Definition:** Addresses that must not be mailed, and org-level email opt-outs.

**Calculation:** Count `email_suppressions` by `reason` (`unsubscribe`, `hard_bounce`, `complaint`). Count `campaign_contact_engagement` where `email_unsubscribed = true`. Skipped recipients with unsub reason = suppression hits at send time.

**Tables / columns:** `campaign.email_suppressions.email`, `reason`, `created_at`; `campaign.campaign_contact_engagement.email_unsubscribed`, `email_unsubscribed_at`, `email_unsubscribe_reason`; recipient `skip_fail_reason`.

### T3.4 Email sending caps and health

**Definition:** Whether the tenant is within hourly/daily caps and whether auto-pause considers the domain healthy.

**Calculation:** Compare recent batch `size` sums to `email_sending_caps.hourly_cap` / `daily_cap`. Read `health_status` and `health_stats` JSON (`sent`, `hardBounce`, `complaint`, `windowStart`). `warmup_stage` is the ladder step.

**Tables / columns:** `campaign.email_sending_caps.batch_size`, `hourly_cap`, `daily_cap`, `warmup_stage`, `health_status`, `health_stats`; `campaign.campaign_send_batches.scheduled_for`, `size`, `status`.

### T3.5 Domain authentication

**Definition:** SPF / DKIM / DMARC ready for the sending domain.

**Calculation:** Flags `spf_ok`, `dkim_ok`, `dmarc_ok` and `email_domains.status`. Return-path `email_return_paths.status`. Sender `email_senders.status` / `is_active`.

**Tables / columns:** `campaign.email_domains`; `campaign.email_return_paths`; `campaign.email_senders`.

### T3.6 Channel configuration readiness

**Definition:** Can this org send on a channel yet.

**Calculation:** `channel_sending_profiles.status` (ChannelConfigStatus). Push: `push_channel_settings.status`. SMS: `sms_channel_settings.status`. Accounts: `setup_channel_configs.status` where `product_ids` includes campaign.

**Tables / columns:** `campaign.channel_sending_profiles`; `campaign.push_channel_settings`; `campaign.sms_channel_settings`; `accounts.setup_channel_configs.status`, `channel_type`, `product_ids`.

### T3.7 Mailbox send-ready (Accounts)

**Definition:** Connected inbox usable for test send (OAuth/SMTP), not bulk ESP.

**Calculation:** Join `setup_channel_configs` + `setup_email_configs` + `mail_oauth_connections`. Block if `needs_reauth` or missing tokens / verification.

**Tables / columns:** `accounts.setup_email_configs.*`; `accounts.mail_oauth_connections.needs_reauth`, `expires_at`; `accounts.setup_channel_configs.product_ids`.

### T3.8 Regulated template approval

**Definition:** SMS DLT / WhatsApp Meta templates waiting or rejected.

**Calculation:** Count `regulated_channel_templates` by `status` and `channel`. Rejection copy in `rejected_reason`.

**Tables / columns:** `campaign.regulated_channel_templates.status`, `channel`, `rejected_reason`, `submitted_at`.

### T3.9 Website visitors and web-push subscribers

**Definition:** Anonymous site people and who opted into web push.

**Calculation:** Count `website_contacts` for the org; `subscribed = true`; `SUM(visit_count)`; optionally unmatched (`contact_id IS NULL`).

**Tables / columns:** `campaign.website_contacts.subscribed`, `visit_count`, `contact_id`, `first_seen_at`, `last_seen_at`.

### T3.10 Push endpoint inventory

**Definition:** How many active devices/browsers can be reached.

**Calculation:** Count `push_endpoints` where `active = true`, grouped by `channel` (`push` vs `web`) and `platform`.

**Tables / columns:** `campaign.push_endpoints.active`, `channel`, `platform`, `contact_id`.

### T3.11 Gallery / library / image ops

**Definition:** Creative pipeline health, not customer engagement.

**Calculation:** Gallery jobs by `campaign_gallery_jobs.status`; idea cards by `campaign_gallery_ideas.status`; library `used_count`; image assets by `campaign_image_gallery_assets.status` / `source`.

**Tables / columns:** `campaign.campaign_gallery_jobs`; `campaign.campaign_gallery_ideas`; `campaign.campaign_library_templates.used_count`, `approval_status`; `campaign.campaign_image_gallery_assets`.

### T3.12 Daily report email delivery log

**Definition:** Whether yesterday’s KPI email actually went out once per user.

**Calculation:** Rows in `daily_report_email_deliveries` for `report_date`; `status`; `error_message`.

**Tables / columns:** `campaign.daily_report_email_deliveries.report_date`, `status`, `recipient_email`, `error_message`, `sent_at`.

### T3.13 In-app notifications unread

**Definition:** Bell backlog.

**Calculation:** Count `app_notifications` where `read_at IS NULL` for the user or tenant-wide (`user_id IS NULL`).

**Tables / columns:** `campaign.app_notifications.read_at`, `user_id`, `kind`.

### T3.14 Pending recipient / live send pressure

**Definition:** Queue still to send.

**Calculation:** Count recipients with pending outcome; batches `status IN ('queued','sending')`.

**Tables / columns:** `campaign.campaign_send_recipients.status`; `campaign.campaign_send_batches.status`, `scheduled_for`.

### T3.15 Login / A2A / API key ops

**Definition:** Product access and integration health, not marketing performance.

**Calculation:** Active Campaign entitlement `organization_products` (`product_code=campaign`, `status=active`). Auth session rows with `product_id=campaign`. A2A token expiry on `a2a_spoke_clients`. API keys `organization_api_keys.active` / `last_used_at`.

**Tables / columns:** `campaign.organization_products`; `accounts.auth_sessions`; `accounts.a2a_spoke_clients`; `campaign.organization_api_keys`.

---

## Related docs

| File | Use |
|------|-----|
| This file | Campaign product catalog + metric tiers |
| `docs/CAMPAIGN_UI_METRICS.md` | What the screens label |
| `docs/CAMPAIGN_METRICS_SQL_AGENT.md` | SQL-agent / RBAC notes |
| `docs/CDP_AUDIENCE_IDENTITY_ONTOLOGY_HANDOFF.md` | Full CDP id vs bigint `contact_id` |
| `backend/prisma/schema.prisma` | Campaign Prisma models |

Replaces `CAMPAIGN_DB_ONTOLOGY.md` as the column catalog for this product.
