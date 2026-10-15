# Campaign product database — PostgreSQL tables, columns, entities

**Audience:** people who need to understand what Campaign stores in Postgres and how it relates to Accounts and CDP.

All of this data lives in **PostgreSQL**. Campaign-owned rows are in schema **`campaign`**. Login and contacts are in schemas **`accounts`** and **`cdp`** on the same Postgres instance (typical database name: `worktual_bigint`).

**How Campaign connects (two URLs, one Postgres):**

| Env var | Typical URL | Postgres objects |
|---------|-------------|------------------|
| `DATABASE_URL` / `CAMPAIGN_DATABASE_URL` | `postgresql://…/worktual_bigint?schema=campaign` | Tables and ENUMs in schema **`campaign`** |
| `ACCOUNT_DATABASE_URL` | `postgresql://…/worktual_bigint` | Schemas **`accounts`** and **`cdp`** (Campaign does not migrate these) |

`?schema=campaign` sets the connection **search_path** so unqualified names like `campaigns` resolve to `campaign.campaigns`. In SQL you should still write the schema when it is not on the search path:

```sql
SELECT * FROM campaign.campaigns WHERE organization_id = 1000;
SELECT * FROM cdp.customer_profile WHERE organization_id = 1000;
```

IDs (`id`, `organization_id`, `contact_id`, user refs) are **bigint**. APIs usually return them as strings.

**Sources (September 2026):** live Postgres `campaign` / `accounts` / `cdp` schemas as used by Campaign. Column lists match what Campaign reads and writes.

---

## How to read this document

Each table has:

1. **Purpose** — why the product has this table
2. **Keys** — primary key (PK) and foreign keys (FK). **Declared FK** = Postgres `REFERENCES` inside `campaign`. **Logical ref** = same id as another table/schema, but **no** Postgres FK (org, user, CDP contact, some denormalized campaign ids)
3. **Columns** — Postgres type, required?, allowed values, why the column exists
4. **Example row** — one realistic row using the shared IDs below

---

## Shared example IDs

| Symbol | Example | Meaning |
|--------|---------|---------|
| `ORG_ID` | `1000` | `accounts.organizations.id` — tenant on every Campaign row as `organization_id` |
| `BRANCH_ID` | `1000` | Default workspace branch in `campaign.branches` |
| `USER_ID` | `1005` | `accounts.setup_users.id` — logged-in marketer |
| `CONTACT_ID` | `9000000000000000123` | `cdp.customer_profile.cdp_id` — stored as `contact_id` in Campaign |
| `CAMPAIGN_ID` | `1012` | Saved campaign |
| `SESSION_ID` | `42` | Create-campaign chat draft |
| `TEMPLATE_ID` | `8801` | Draft channel template on a session |
| `BATCH_ID` | `501` | One send slice |
| `RECIPIENT_ID` | `9001` | One person in a send batch |

---

## Postgres layout: one instance, three schemas

Typical production/dev:

```text
PostgreSQL
  database: worktual_bigint
    schema campaign   ← Campaign application tables (this document’s main catalog)
    schema accounts   ← login, org profile, roles, WhatsApp/email configs, A2A clients
    schema cdp        ← people: customer_profile + email/phone identity_keys
```

Campaign **never copies full contact rows** into `campaign.*`. It stores `contact_id` only (except temporary upload rows and website visitors).

**Declared FKs vs logical refs**

- Inside `campaign`, some child tables have real Postgres FKs (for example `campaign_channels.campaign_id` → `campaign.campaigns.id` ON DELETE CASCADE).
- `organization_id` is a **logical** tenant id equal to `accounts.organizations.id` — there is no cross-schema FK.
- `created_by_user_id` / `user_id` equal `accounts.setup_users.id` — no FK.
- `contact_id` equals `cdp.customer_profile.cdp_id` — no FK.
- A few campaign columns point at other campaign rows **without** a Postgres FK (for example `campaign_send_recipients.campaign_id`, `campaign_channels.template_id`). SQL joins still work; the database will not cascade-delete those by itself.

---

# Core product entities (simple English)

These are the nouns the product is about. Tables persist them; agents talk about them.

| Entity | What it is in this product | Typical home |
|--------|----------------------------|--------------|
| **Organization (tenant)** | The company that bought Worktual. All campaign data is isolated by this id. | `accounts.organizations` |
| **User** | A person who logs in (admin or marketer). Creates campaigns and contacts. | `accounts.setup_users` |
| **Role** | Named access (e.g. `admin`). Decides whether reports show *all branch campaigns* or *only mine*. | `accounts.setup_roles` + `setup_user_product_access` |
| **Branch** | A workspace under the org (today often one “Default”). Campaigns and drafts belong to a branch. | `campaign.branches` |
| **Product entitlement** | Whether this branch may use Campaign (and optionally CRM). Login checks an active Campaign row. | `campaign.organization_products` |
| **Contact (person)** | Someone you can message: name, company, city, email, phone, extra fields. Lives in CDP, not in Campaign. | `cdp.customer_profile` + `cdp.identity_keys` |
| **Identity key** | One email or phone belonging to a contact. Used to find duplicates and to send. | `cdp.identity_keys` |
| **Temporary contact** | A row from an Excel/CSV uploaded only for this chat session. Not CRM until promoted. | `campaign.campaign_session_temp_contacts` |
| **Website visitor** | Someone who opened the site / opted into web push. Not a CRM contact until matched or promoted. | `campaign.website_contacts` |
| **Campaign draft (agent session)** | The create-campaign chat: messages, chosen channels, templates in progress. | `campaign.campaign_agent_sessions` |
| **Campaign** | A named marketing program you can schedule or launch: goal, audience, channels, launch time. | `campaign.campaigns` |
| **Channel (on a campaign)** | One send path on that campaign: email, WhatsApp, SMS, app push, web push, web, PPC. | `campaign.campaign_channels` |
| **Audience** | The frozen list of contact ids this campaign will (or did) send to. | `campaign.campaign_audience` (saved) / `campaign.campaign_audience_refs` (draft) |
| **Channel template (draft)** | The actual email HTML / WhatsApp body / push copy generated in chat, keyed by template id. | `campaign.campaign_channel_templates` |
| **Template message** | One chat turn in the template edit space (user or assistant). | `campaign.campaign_template_messages` |
| **Library template** | Reusable marketing creative in Template Library (system seed or user upload). | `campaign.campaign_library_templates` |
| **Regulated template** | SMS (DLT) or WhatsApp (Meta) template that must be approved before send. | `campaign.regulated_channel_templates` |
| **Gallery idea / job / image** | Auto-generated Template Gallery cards, background jobs, and reusable images. | `campaign.campaign_gallery_ideas`, `campaign.campaign_gallery_jobs`, `campaign.campaign_image_gallery_assets` |
| **Recommendation** | A suggested campaign card on the board (CRM embed or Campaign SPA). | `campaign.campaign_recommendations` |
| **Send batch** | One timed slice of a channel send (respects caps). | `campaign.campaign_send_batches` |
| **Send recipient** | One person (or device) in a batch: status, opens, clicks, A/B variant. | `campaign.campaign_send_recipients` |
| **Engagement (contact-level)** | Org-wide unsubscribe and last open/click for a contact (not per campaign). | `campaign.campaign_contact_engagement` |
| **Suppression** | Email address that must not be mailed (unsubscribe, hard bounce, complaint). | `campaign.email_suppressions` |
| **Sending configuration** | Org legal address, From addresses, domain DNS, push keys, SMS DLT, hourly caps. | `email_*`, `push_channel_settings`, `sms_channel_settings`, `channel_sending_profiles` |
| **Push endpoint** | Device token (app) or browser subscription (web push) for a contact. | `campaign.push_endpoints` |
| **Opportunity / event** | A form (or similar) you launch to collect replies. | `campaign.campaign_opportunity_events` |
| **Form submission** | One public form reply. | `campaign.campaign_form_submissions` |
| **In-app notification** | Bell item (approvals, activity). | `campaign.app_notifications` |
| **Industry pack** | Per-tenant field hints and company rules for contacts (B2B/B2C). | `campaign.tenant_industry_packs` |
| **Daily report delivery** | Log so each user gets at most one daily KPI email per calendar date. | `campaign.daily_report_email_deliveries` |
| **API key** | Org key for app-push register (no user JWT). | `campaign.organization_api_keys` |

### Relations between entities

```text
Organization 1──* User
Organization 1──* Branch
Branch 1──* Product entitlement
Branch 1──* Campaign
Branch 1──* Agent session (draft)
User  *── creates ──* Campaign / Session / Recommendation / Opportunity

Contact  (CDP)  *── referenced by ── Audience, AudienceRef, SendRecipient, PushEndpoint, Engagement
Contact 1──* Identity key (email/phone)

Agent session 1──* AudienceRef
Agent session 1──* Temp contact
Agent session 1──* Channel template 1──* Template message
Campaign 0..1──1 Agent session   (optional session_id when saved from chat)

Campaign 1──* Campaign channel
Campaign 1──* Audience (frozen contact ids)
Campaign 1──* Send batch 1──* Send recipient

Organization 1──1 Email org profile / return path / sending caps / SMS settings / industry pack
Organization 1──* Email sender, email domain, suppressions, push settings, library templates, gallery

Opportunity 1──* Form submission   (joined by public_id / slug; no Postgres FK)

Regulated template  *── optional source ── Campaign (source_campaign_id, logical)
Campaign channel.template_id  → campaign.campaign_channel_templates.id (logical; no Postgres FK)
```

---

# PostgreSQL ENUM types (schema `campaign`)

These are real Postgres types in schema `campaign` (quoted identifiers):

```sql
SELECT n.nspname AS schema, t.typname
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'campaign' AND t.typtype = 'e';
```

Example: `campaign."CampaignStatus"`, `campaign."ProductCode"`, `campaign."ProductStatus"`, `campaign."SourceChannel"`, `campaign."ChannelConfigStatus"`, `campaign."RegulatedTemplateStatus"`.

### `campaign."ProductCode"`

| Value | Meaning |
|-------|---------|
| `campaign` | Campaign product entitlement |
| `crm` | CRM product entitlement |

### `campaign."ProductStatus"`

| Value | Meaning |
|-------|---------|
| `active` | Product is allowed for this branch |
| `inactive` | Entitlement turned off |

### `campaign."CampaignStatus"`

| Value | Meaning |
|-------|---------|
| `draft` | Not launched; still being built |
| `scheduled` | Launch time in the future |
| `live` | Sending or currently running |
| `completed` | Finished |
| `cancelled` | Stopped / cancelled |

### `campaign."SourceChannel"`

| Value | Meaning |
|-------|---------|
| `standalone_campaign` | Created inside Campaign app |
| `crm_marketing` | Created from CRM marketing embed |

### `campaign."ChannelConfigStatus"`

| Value | Meaning |
|-------|---------|
| `not_started` | Channel setup not begun |
| `in_progress` | Operator is filling config |
| `ready` | Allowed to send |
| `blocked` | Cannot send until fixed |

### `campaign."RegulatedTemplateStatus"`

| Value | Meaning |
|-------|---------|
| `draft` | Not submitted |
| `pending` | Waiting for DLT / Meta |
| `approved` | Allowed to send |
| `rejected` | Failed review (`rejected_reason` set) |
| `paused` | Temporarily not sendable |
| `disabled` | Turned off |

---

# Schema `campaign` (Campaign application tables)

Qualified name: `campaign.<table>`. Types: `bigint`, `text`, `boolean`, `integer`, `timestamp(3)`, `jsonb`, plus the ENUMs above.

Logical refs to `accounts.*` / `cdp.*` have **no** Postgres FK. You must still filter `organization_id` on every query.

---

## `campaign.branches`

**Purpose:** Workspace under an organization. Campaigns and chat drafts are scoped to org **and** branch.

**Keys:** PK `id`. Logical FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | autoincrement | PK |
| `organization_id` | bigint | yes | | Tenant |
| `name` | text | yes | | Label in UI (e.g. Default) |
| `is_default` | boolean | yes | `true`/`false` | Fallback branch on first login |
| `created_at` | timestamp(3) | yes | | Created |
| `updated_at` | timestamp(3) | yes | | Last change |

**Example row**

| id | organization_id | name | is_default | created_at | updated_at |
|----|-----------------|------|------------|------------|------------|
| 1000 | 1000 | Default | true | 2026-08-25T06:00:00Z | 2026-08-25T06:00:00Z |

---

## `campaign.organization_products`

**Purpose:** Records which Worktual products this branch may use. Login requires an **active** `campaign` row.

**Keys:** PK `id`. FK `branch_id` → `campaign.branches.id` (CASCADE). Unique (`organization_id`, `branch_id`, `product_code`). Logical FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `branch_id` | bigint | yes | | Which branch is entitled |
| `product_code` | `campaign."ProductCode"` | yes | `campaign`, `crm` | Which product |
| `status` | `campaign."ProductStatus"` | yes | `active`, `inactive` | On/off |
| `starts_at` | timestamp(3) | no | | Optional start |
| `ends_at` | timestamp(3) | no | | Optional expiry |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=1, organization_id=1000, branch_id=1000, product_code=campaign, status=active, starts_at=2026-08-25T06:00:00Z, ends_at=null`

---

## `campaign.campaigns`

**Purpose:** The saved campaign the rest of the product hangs off: name, status, audience snapshot, launch plan and timezone.

**Keys:** PK `id`. FK `branch_id` → `campaign.branches.id`. Unique `session_id` when saved from a draft. Logical FKs: `organization_id` → `accounts.organizations.id`, `created_by_user_id` → `accounts.setup_users.id`, `session_id` → `campaign.campaign_agent_sessions.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `branch_id` | bigint | yes | | Workspace |
| `name` | text | yes | | Display name |
| `description` | text | no | | Longer description |
| `status` | `campaign."CampaignStatus"` | yes | `draft`, `scheduled`, `live`, `completed`, `cancelled` | Lifecycle |
| `starts_at` / `ends_at` | timestamp(3) | no | | Optional window |
| `source_channel` | `campaign."SourceChannel"` | yes | `standalone_campaign`, `crm_marketing` | Where it was created |
| `created_by_user_id` | bigint | yes | | Creator (RBAC “mine”) |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |
| `goal` | text | no | | Marketing goal |
| `objective` | text | no | | More specific objective |
| `session_id` | bigint | no | | Draft session this was saved from |
| `audience_summary` | text | no | | Human summary of who was selected |
| `audience_filters` | jsonb | no | | Filter snapshot used at save |
| `audience_count` | int | yes | default 0 | How many people frozen |
| `launch_plan` | jsonb | no | | Schedule, channels, email A/B, `channel_run` metrics fallback |
| `launch_local_date` | text | no | `YYYY-MM-DD` | Launch date in tenant timezone |
| `launch_local_time` | text | no | `HH:mm` | Launch clock time |
| `timezone` | text | no | default `Asia/Kolkata` | IANA tz for scheduling and reports |

**Example row:** `id=1012, organization_id=1000, branch_id=1000, name=Q3 SaaS webinar invite, status=live, source_channel=standalone_campaign, created_by_user_id=1005, session_id=42, audience_count=120, launch_local_date=2026-09-20, launch_local_time=10:00, timezone=Asia/Kolkata, goal=Registrations, objective=Fill 20 Sep webinar`

---

## `campaign.campaign_channels`

**Purpose:** One row per channel on a **saved** campaign (which channels will run, optional template pointer, planned launch).

**Keys:** PK `id`. FK `campaign_id` → `campaign.campaigns.id` CASCADE. Unique (`campaign_id`, `channel`). Logical: `template_id` → `campaign.campaign_channel_templates.id` (**no Postgres FK**), `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `campaign_id` | bigint | yes | | Parent campaign |
| `organization_id` | bigint | yes | | Tenant (denormalized) |
| `channel` | text | yes | `email`, `whatsapp`, `sms`, `push`, `web`, `ppc`, … | Agent-canonical channel id |
| `template_id` | bigint | no | | Draft template used |
| `how_it_works` | text | no | | Operator note |
| `planned_launch_at` | text | no | | Planned launch string |
| `status` | text | yes | default `ready`; also used as channel-run state | Ready / paused etc. |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=201, campaign_id=1012, organization_id=1000, channel=email, template_id=8801, status=ready`

---

## `campaign.campaign_audience`

**Purpose:** Frozen contact ids at save/launch. This is the send list, not a copy of names.

**Keys:** Composite PK (`campaign_id`, `contact_id`). FK `campaign_id` → `campaign.campaigns.id` CASCADE. Logical FK `contact_id` → `cdp.customer_profile.cdp_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `campaign_id` | bigint | yes | | Which campaign |
| `contact_id` | bigint | yes | | Which person |
| `created_at` | timestamp(3) | yes | | When frozen |

**Example row:** `campaign_id=1012, contact_id=9000000000000000123, created_at=2026-09-19T08:00:00Z`

---

## `campaign.campaign_agent_sessions`

**Purpose:** Create-campaign (and related) **chat draft**. Payload holds messages and working state. People are only id refs (plus temp uploads).

**Keys:** PK `id`. FK `branch_id` → `campaign.branches.id`. Logical: `organization_id` → `accounts.organizations.id`, `created_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK / `session_id` |
| `organization_id` | bigint | yes | | Tenant |
| `branch_id` | bigint | yes | | Workspace |
| `created_by_user_id` | bigint | yes | | Owner of the draft |
| `module` | text | yes | default `create_campaign`; also other SPA modules | Which product surface |
| `stage` | text | yes | default `intake` | Coarse funnel stage |
| `payload` | jsonb | yes | | Chat + draft JSON |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=42, organization_id=1000, branch_id=1000, created_by_user_id=1005, module=create_campaign, stage=intake, payload={"campaign":{"name":"Q3 SaaS webinar invite"}}`

---

## `campaign.campaign_audience_refs`

**Purpose:** Contact ids attached to a **draft session** before the campaign is saved.

**Keys:** Composite PK (`session_id`, `contact_id`). FK `session_id` → `campaign.campaign_agent_sessions.id` CASCADE. Logical FK `contact_id` → `cdp.customer_profile.cdp_id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `session_id` | bigint | yes | Draft |
| `contact_id` | bigint | yes | Person |

**Example row:** `session_id=42, contact_id=9000000000000000123`

---

## `campaign.campaign_session_temp_contacts`

**Purpose:** People uploaded only for this session (sheet). Not CRM. Used when the user does not want to write into CDP yet.

**Keys:** PK `id`. FK `session_id` → `campaign.campaign_agent_sessions.id` CASCADE. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `session_id` | bigint | yes | Which draft |
| `organization_id` | bigint | yes | Tenant |
| `first_name`, `last_name`, `email`, `phone`, `company_name`, `city` | text | yes (default `""`) | Columns from the sheet |
| `raw` | jsonb | yes | Extra original columns |
| `created_at` | timestamp(3) | yes | When uploaded |

**Example row:** `id=77, session_id=42, organization_id=1000, first_name=Ravi, last_name=Kumar, email=ravi@example.com, phone=+919876543210, company_name=Acme, city=Chennai, raw={}`

---

## `campaign.campaign_channel_templates`

**Purpose:** Structured channel creative for a **session** (fields JSON for FE shells: subject, HTML, buttons, etc.).

**Keys:** PK `id`. FK `session_id` → `campaign.campaign_agent_sessions.id` CASCADE. Logical `organization_id` → `accounts.organizations.id`, `branch_id` → `campaign.branches.id` (**no Postgres FK** on org).

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | Template id used in UI and `campaign_channels.template_id` |
| `session_id` | bigint | yes | Draft |
| `organization_id` / `branch_id` | bigint | yes | Scope |
| `channel` | text | yes | `email`, `whatsapp`, … |
| `logo` | text | no | Logo URL |
| `launch_at` | text | no | Suggested launch |
| `how_it_works` | text | no | Explanation for operator |
| `fields` | jsonb | yes | Structured template fields |
| `generation_batch_id` | bigint | no | Which generate batch produced this |
| `created_at` / `updated_at` | timestamp(3) | yes | Audit |

**Example row:** `id=8801, session_id=42, organization_id=1000, branch_id=1000, channel=email, fields={"subject":"Join our webinar","html":"<html>…</html>"}`

---

## `campaign.campaign_template_messages`

**Purpose:** Ordered chat in the template **edit space**.

**Keys:** PK `id`. FK `template_id` → `campaign.campaign_channel_templates.id` CASCADE. Unique (`template_id`, `seq`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `template_id` | bigint | yes | | Which template |
| `role` | text | yes | `user`, `assistant`, `system` | Who spoke |
| `seq` | int | yes | | Order |
| `kind` | text | yes | `text`, `template` | Plain chat vs template payload |
| `payload` | jsonb | yes | | Message body |
| `created_at` | timestamp(3) | yes | | When |

**Example row:** `id=1, template_id=8801, role=user, seq=1, kind=text, payload={"text":"Make the CTA green"}`

---

## `campaign.channel_sending_profiles`

**Purpose:** Per-org, per-channel **readiness** to send (checklist + status). Email is filled; other channels reserved.

**Keys:** PK `id`. Unique (`organization_id`, `channel`). Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `channel` | text | yes | `email`, `sms`, `whatsapp`, `push`, `web`, … | Which channel |
| `status` | `campaign."ChannelConfigStatus"` | yes | `not_started`, `in_progress`, `ready`, `blocked` | Gate |
| `checklist` | jsonb | no | | Operator checklist |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=1, organization_id=1000, channel=email, status=ready, checklist={"spf":true,"dkim":true}`

---

## `campaign.organization_api_keys`

**Purpose:** Integration keys (app push register API) so devices can register without a user JWT.

**Keys:** PK `id`. Unique `key_hash`. Unique (`organization_id`, `purpose`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `purpose` | text | yes | default `app_push` | Which integration |
| `key_hash` | text | yes | | Stored hash of secret |
| `key_prefix` | text | yes | | Prefix shown in UI |
| `active` | boolean | yes | | Can be used |
| `created_at` | timestamp(3) | yes | | Created |
| `last_used_at` | timestamp(3) | no | | Last successful use |

**Example row:** `id=3, organization_id=1000, purpose=app_push, key_hash=sha256:…, key_prefix=wtc_live_, active=true, last_used_at=2026-09-21T11:00:00Z`

---

## `campaign.push_channel_settings`

**Purpose:** VAPID / FCM / APNs credentials collected in Configuration.

**Keys:** PK `id`. Unique (`organization_id`, `channel`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `channel` | text | yes | UI ids: `web_push`, `app_push` | Which push product |
| `settings` | jsonb | yes | secrets server-side | Provider fields |
| `status` | text | yes | default `not_started` | Config progress |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=1, organization_id=1000, channel=web_push, settings={"vapidPublicKey":"B…"}, status=ready`

---

## `campaign.email_org_profiles`

**Purpose:** Legal sender identity (CAN-SPAM / footer address) for the org.

**Keys:** PK `id`. Unique `organization_id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `organization_id` | bigint | yes | One profile per org |
| `legal_name`, `street`, `city`, `country` | text | yes | Physical identity in footers |
| `phone` | text | no | Contact phone |
| `created_at` / `updated_at` | timestamp(3) | yes | Audit |

**Example row:** `id=1, organization_id=1000, legal_name=Acme Retail Pvt Ltd, street=12 Mount Road, city=Chennai, country=IN, phone=+914400000000`

---

## `campaign.email_senders`

**Purpose:** From addresses. One `is_active=true` per tenant is used by the bulk send worker.

**Keys:** PK `id`. Unique (`organization_id`, `from_email`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `display_name` | text | yes | | From name |
| `from_email` | text | yes | | From address |
| `reply_to` | text | no | | Reply-To |
| `status` | text | yes | default `pending_verification`; also `verified` | Verification |
| `verify_token` / `verify_expires_at` / `verified_at` | text / timestamp(3) | no | | Email verification flow |
| `is_active` | boolean | yes | | Worker uses this From |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=9, organization_id=1000, display_name=Acme Marketing, from_email=hello@acme.example, status=verified, is_active=true, verified_at=2026-08-01T10:00:00Z`

---

## `campaign.email_domains`

**Purpose:** Sending domain + SPF/DKIM/DMARC flags and ESP DNS records. Private DKIM key never goes to the frontend.

**Keys:** PK `id`. Unique (`organization_id`, `domain`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `domain` | text | yes | | e.g. `mail.acme.example` |
| `spf_ok`, `dkim_ok`, `dmarc_ok` | boolean | yes | | DNS health |
| `status` | text | yes | default `not_started` | Setup progress |
| `provider_domain_id` | text | no | | Optional ops domain id (legacy); unused for send |
| `dns_records` | jsonb | no | | Records to paste into DNS |
| `dkim_selector` | text | no | | Selector (e.g. `campaign`) |
| `dkim_public_key` | text | no | | Public p= for DNS |
| `dkim_private_key_encrypted` | text | no | | AES-GCM PEM — server only |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=2, organization_id=1000, domain=mail.acme.example, spf_ok=true, dkim_ok=true, dmarc_ok=true, status=ready, dkim_selector=campaign`

---

## `campaign.email_return_paths`

**Purpose:** Bounce/return-path domain for the org.

**Keys:** PK `id`. Unique `organization_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | One per org |
| `domain` | text | yes | | Return-path domain |
| `status` | text | yes | default `not_started` | Setup |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=1, organization_id=1000, domain=bounces.acme.example, status=ready`

---

## `campaign.email_sending_caps`

**Purpose:** Warm-up and rate limits (batch, hourly, daily) plus rolling health stats for auto-pause.

**Keys:** PK `id`. Unique `organization_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `batch_size` | int | yes | default 200 | Recipients per batch |
| `hourly_cap` | int | yes | default 500 | Max per hour |
| `daily_cap` | int | yes | default 1000 | Max per day |
| `warmup_stage` | int | yes | default 0 | Warm-up ladder |
| `health_status` | text | yes | default `healthy` | Sending health |
| `health_stats` | jsonb | no | `{ sent, hardBounce, complaint, windowStart }` | Rolling counters |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=1, organization_id=1000, batch_size=200, hourly_cap=500, daily_cap=1000, warmup_stage=2, health_status=healthy`

---

## `campaign.email_suppressions`

**Purpose:** Durable “do not email” list (unsubscribe, hard bounce, complaint).

**Keys:** PK `id`. Unique (`organization_id`, `email`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `email` | text | yes | | Address to block |
| `reason` | text | yes | typically `unsubscribe`, `hard_bounce`, `complaint` | Why blocked |
| `created_at` | timestamp(3) | yes | | When added |

**Example row:** `id=15, organization_id=1000, email=alice@example.com, reason=unsubscribe, created_at=2026-09-01T12:00:00Z`

---

## `campaign.campaign_send_batches`

**Purpose:** One timed slice of a channel send (email, push, web, WhatsApp, …). Workers pick `queued` batches.

**Keys:** PK `id`. FK `campaign_id` → `campaign.campaigns.id` CASCADE. Unique (`campaign_id`, `channel`, `seq`). Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `campaign_id` | bigint | yes | | Campaign |
| `seq` | int | yes | | Slice number |
| `scheduled_for` | timestamp(3) | yes | | When worker may send |
| `status` | text | yes | default `queued`; also `sending`, `sent`, `failed`, `cancelled` | Batch lifecycle |
| `size` | int | yes | | Planned recipient count |
| `channel` | text | yes | default `email`; `push`, `web`, `whatsapp`, … | Which worker |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=501, organization_id=1000, campaign_id=1012, seq=1, scheduled_for=2026-09-20T04:30:00Z, status=sent, size=120, channel=email`

---

## `campaign.campaign_send_recipients`

**Purpose:** One intended delivery. **This is the fact table for KPIs** (sent, failed, unique open/click, A/B).

**Keys:** PK `id`. FK `batch_id` → `campaign.campaign_send_batches.id` CASCADE. Logical: `campaign_id` → `campaign.campaigns.id` (**no Postgres FK**), `contact_id` → `cdp.customer_profile.cdp_id`, `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `batch_id` | bigint | yes | | Parent batch |
| `campaign_id` | bigint | yes | | Campaign (denormalized for reports) |
| `contact_id` | bigint | no | | CDP person; null for some temp/web cases |
| `email` | text | no | | Address when channel is email |
| `status` | text | yes | default `pending`. Seen in code: `pending`, `queued`, `sending`, `sent`, `delivered`, `failed`, `cancelled`, `skipped`, `stub`, `stub_sent`, `bounced`, `hard_bounce`, `soft_bounce` | Delivery outcome |
| `skip_fail_reason` | text | no | | Why skipped/failed/bounced |
| `provider_message_id` | text | no | | ESP/FCM/Meta id; `stub-` / `stub://` = demo, not real delivery |
| `attempt_count` | int | yes | | Send retries |
| `destination` | text | no | | Push token or web-push URL |
| `platform` | text | no | | `ios`, `android`, `web`, … |
| `ab_variant` | text | no | `a`, `b`, `holdout`, `winner` | Email A/B assignment |
| `opened_at` | timestamp(3) | no | | First unique open |
| `clicked_at` | timestamp(3) | no | | First unique click |
| `open_count` | int | yes | | Total open pixel hits |
| `click_count` | int | yes | | Total tracked clicks |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=9001, organization_id=1000, batch_id=501, campaign_id=1012, contact_id=9000000000000000123, email=alice@example.com, status=sent, ab_variant=a, opened_at=2026-09-20T05:10:00Z, clicked_at=2026-09-20T05:12:00Z, open_count=2, click_count=1, provider_message_id=re_abc123`

---

## `campaign.push_endpoints`

**Purpose:** App device tokens and web-push subscriptions, keyed by org + optional contact.

**Keys:** PK `id`. Unique (`organization_id`, `channel`, `endpoint`). Logical `contact_id` → `cdp.customer_profile.cdp_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `contact_id` | bigint | no | | Linked person |
| `channel` | text | yes | `push` (app), `web` (web push) | Agent-canonical |
| `platform` | text | no | | Device OS |
| `endpoint` | text | yes | | Token or subscription URL |
| `auth_keys` | jsonb | no | | Web-push keys |
| `label` | text | no | | Operator label |
| `active` | boolean | yes | | Eligible to send |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=40, organization_id=1000, contact_id=9000000000000000123, channel=web, platform=chrome, endpoint=https://fcm.googleapis.com/…, active=true`

---

## `campaign.website_contacts`

**Purpose:** Site visitors (page open + optional web-push opt-in). **Not** Audience until promoted into CDP.

**Keys:** PK `id`. Unique (`organization_id`, `visitor_id`). Logical `contact_id` → `cdp.customer_profile.cdp_id` when promoted.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `organization_id` | bigint | yes | Tenant |
| `visitor_id` | text | yes | Browser visitor id |
| `contact_id` | bigint | no | Set after promote/match |
| `email` / `phone` / `first_name` / `last_name` | text | no | Known identity |
| `origin` | text | yes | Site origin |
| `path` | text | no | Last path |
| `user_agent` | text | no | Browser |
| `subscribed` | boolean | yes | Web-push opted in |
| `endpoint` / `auth_keys` / `platform` | text/json | no | Push subscription |
| `visit_count` | int | yes | Visits |
| `first_seen_at` / `last_seen_at` / `subscribed_at` | timestamp(3) | | Activity |
| `created_at` / `updated_at` | timestamp(3) | yes | Audit |

**Example row:** `id=12, organization_id=1000, visitor_id=vid_9f, contact_id=null, email=null, origin=https://www.acme.example, path=/pricing, subscribed=true, visit_count=3`

---

## `campaign.campaign_contact_engagement`

**Purpose:** Campaign-only **contact-level** email engagement and unsubscribe (not a CDP column). Per-send detail stays on recipients.

**Keys:** PK `id`. Unique (`organization_id`, `contact_id`). Logical `contact_id` → `cdp.customer_profile.cdp_id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `organization_id` | bigint | yes | Tenant |
| `contact_id` | bigint | yes | Person |
| `email_unsubscribed` | boolean | yes | Global campaign unsub |
| `email_unsubscribed_at` | timestamp(3) | no | When |
| `email_unsubscribe_reason` | text | no | Why |
| `last_email_opened_at` / `last_email_clicked_at` | timestamp(3) | no | Last activity |
| `email_open_count` / `email_click_count` | int | yes | Lifetime totals |
| `created_at` / `updated_at` | timestamp(3) | yes | Audit |

**Example row:** `id=5, organization_id=1000, contact_id=9000000000000000123, email_unsubscribed=false, last_email_opened_at=2026-09-20T05:10:00Z, email_open_count=4, email_click_count=1`

---

## `campaign.regulated_channel_templates`

**Purpose:** SMS DLT / WhatsApp Meta templates that need external approval.

**Keys:** PK `id`. Logical: `organization_id` → `accounts.organizations.id`, `created_by_user_id` → `accounts.setup_users.id`, `source_campaign_id` → `campaign.campaigns.id` (**no Postgres FK**), `channel_config_id` → `accounts.setup_channel_configs.id` (**never expose to UI**).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `channel` | text | yes | `sms`, `whatsapp` | Regulator |
| `name` | text | yes | | Internal name |
| `external_id` | text | yes | | DLT id or Meta template **name** |
| `provider_template_id` | text | no | | Meta Graph template id |
| `language` | text | yes | default `en` | Language |
| `category` | text | yes | | Marketing / utility / … |
| `header` / `body` / `footer` | text | body required | | Copy |
| `buttons` | text | yes | newline-separated labels | WhatsApp buttons |
| `status` | `campaign."RegulatedTemplateStatus"` | yes | `draft`, `pending`, `approved`, `rejected`, `paused`, `disabled` | Approval |
| `rejected_reason` | text | no | | Why rejected |
| `channel_config_id` | bigint | no | | Internal Accounts config |
| `submitted_at` / `last_status_checked_at` | timestamp(3) | no | | Sync |
| `created_by_user_id` | bigint | no | | Who created |
| `campaign_name` / `goal` / `objective` | text | yes default `""` | | Context from campaign |
| `source_campaign_id` | bigint | no | | Origin campaign |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=301, organization_id=1000, channel=whatsapp, name=webinar_invite_v1, external_id=webinar_invite_v1, status=approved, language=en, body=Hi {{1}}, join our webinar…, source_campaign_id=1012`

---

## `campaign.campaign_library_templates`

**Purpose:** Template Library catalog: system seeds + user uploads.

**Keys:** PK `id`. Unique (`organization_id`, `seed_slug`). Logical `created_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `source` | text | yes | `system`, `user` | Who owns the creative |
| `seed_slug` | text | no | | Stable id for system rows |
| `seed_catalog` | text | yes | e.g. `b2b-v11` | Catalog version |
| `name` / `description` / `style_notes` | text | yes | | Catalog copy |
| `goal` | text | yes | | Intended goal |
| `primary_channel` | text | yes | `email`, … | Main channel |
| `channels` | jsonb | yes | default `[]` | Channel labels for UI |
| `audience` | text | yes | | Suggested audience |
| `flow_steps` | jsonb | yes | | Suggested flow |
| `starter_message` | text | yes | | Chat starter |
| `approval_status` | text | yes | default `approved` | Library gate |
| `body_preview` / `content_body` | text | yes | | Preview vs full body |
| `preview_image` | text | no | | Card image |
| `preview` / `fields` / `metadata` | jsonb | preview/fields optional | | Card meta, structured fields, tags |
| `used_count` | int | yes | | How often used |
| `external_template_id` | text | yes | | External id if any |
| `created_by_user_id` | bigint | no | | Uploader |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=44, organization_id=1000, source=system, seed_slug=b2b-webinar-invite, name=Webinar invite, primary_channel=email, approval_status=approved, used_count=3`

---

## `campaign.campaign_gallery_ideas`

**Purpose:** AI Template Gallery idea cards per org.

**Keys:** PK `id`. Unique (`organization_id`, `idea_key`).

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `idea_key` | text | yes | | Stable idea id |
| `title` / `summary` | text | yes | | Card copy |
| `industry` / `industry_type` | text | yes | | Personalization |
| `pack_id` | text | yes | default `generic-b2b` | Industry pack |
| `image_url` | text | no | | Hero image |
| `image_meta` | jsonb | yes | | Image metadata |
| `generation_version` | text | yes | default `gallery-v1` | Generator version |
| `status` | text | yes | default `active` | Show/hide |
| `sort_order` | int | yes | | Card order |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=8, organization_id=1000, idea_key=saas-webinar, title=Product webinar, pack_id=generic-b2b, status=active, sort_order=1`

---

## `campaign.campaign_gallery_jobs`

**Purpose:** Background job that bootstraps Template Gallery for an org.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `job_type` | text | yes | | Kind of gallery job |
| `status` | text | yes | default `queued`; also `running`, `done`, `failed` | Job state |
| `channels_snapshot` | jsonb | yes | | Channels at start |
| `progress` | jsonb | yes | | Progress payload |
| `error_message` | text | no | | Failure |
| `started_at` / `finished_at` | timestamp(3) | no | | Timing |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=2, organization_id=1000, job_type=bootstrap_gallery, status=done, channels_snapshot=["email","whatsapp"]`

---

## `campaign.campaign_image_gallery_assets`

**Purpose:** Reusable marketing images (Image Gallery). Forward-only catalog.

**Keys:** PK `id`. Unique (`organization_id`, `media_id`). Logical `created_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `media_id` | text | yes | | Stable media id |
| `image_url` | text | yes | | URL |
| `short_description` | text | yes | | Alt/summary |
| `generation_prompt` | text | yes | | Prompt if AI |
| `source` | text | yes | `ai_generated`, `uploaded`, `imported` | Provenance |
| `channel` | text | yes | | Intended channel |
| `context` / `reuse_tags` | jsonb | yes | | Extra / tags |
| `status` | text | yes | `active`, `archived` | Visibility |
| `created_by_user_id` | bigint | no | | Who added |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=19, organization_id=1000, media_id=img_20260917_064501, image_url=https://…/hero.png, source=ai_generated, status=active, channel=email`

---

## `campaign.sms_channel_settings`

**Purpose:** Per-tenant SMS/DLT provider settings (Campaign Configuration).

**Keys:** PK `id`. Unique `organization_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `settings` | jsonb | yes | provider, api_key, sender_id, entity_id, base_url, … | Secrets + DLT ids |
| `status` | text | yes | default `not_started` | Setup |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=1, organization_id=1000, settings={"sender_id":"ACMEIN","entity_id":"…"}, status=ready`

---

## `campaign.tenant_industry_packs`

**Purpose:** Per-org industry pack: soft contact field hints + editable company rules.

**Keys:** PK `id`. Unique `organization_id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `pack_id` | text | yes | `generic-b2b`, `generic-b2c` | Pack family |
| `seed_industry_type` | text | yes | | Snapshot of `organizations.industry_type` |
| `payload` | jsonb | yes | `{ version, mode, fields[], rules[] }` | Hints + rules |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=1, organization_id=1000, pack_id=generic-b2b, seed_industry_type=Software / SaaS, payload={"version":1,"fields":["job_title"],"rules":[]}`

---

## `campaign.campaign_recommendations`

**Purpose:** Shared recommendation board cards (Campaign SPA + CRM embed). Full card JSON in `payload`.

**Keys:** PK `id`. Unique (`organization_id`, `public_id`). Logical `branch_id` → `campaign.branches.id` (**no Postgres FK**), `created_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `organization_id` / `branch_id` | bigint | yes | Scope |
| `created_by_user_id` | bigint | yes | Who created the card |
| `public_id` | text | yes | Frontend `rec-…` id |
| `status` | text | yes | Board state (e.g. open / used / dismissed — stored as string) |
| `title` | text | yes | Card title |
| `payload` | jsonb | yes | Full recommendation JSON |
| `created_at` / `updated_at` | timestamp(3) | yes | Audit |

**Example row:** `id=6, organization_id=1000, branch_id=1000, created_by_user_id=1005, public_id=rec-webinar-01, status=open, title=Run a webinar invite`

---

## `campaign.app_notifications`

**Purpose:** In-app bell (approvals, activity). `user_id` null = visible to whole tenant.

**Keys:** PK `id`. Unique (`organization_id`, `source_key`). Logical `user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `organization_id` | bigint | yes | Tenant |
| `user_id` | bigint | no | Target user; null = all |
| `kind` | text | yes | Notification type |
| `title` / `body` | text | yes | Copy |
| `href` | text | no | Deep link |
| `source_key` | text | yes | Dedup key |
| `created_at` | timestamp(3) | yes | When |
| `read_at` | timestamp(3) | no | When read |

**Example row:** `id=88, organization_id=1000, user_id=1005, kind=template_pending, title=WhatsApp template pending, body=webinar_invite_v1 is awaiting Meta, href=/templates, source_key=template:pending:301, read_at=null`

---

## `campaign.campaign_opportunity_events`

**Purpose:** Forms / events you launch. Payload matches the SPA OpportunityEvent.

**Keys:** PK `id`. Unique (`organization_id`, `public_id`). Unique `public_slug` when set. Logical `branch_id` → `campaign.branches.id` (**no Postgres FK**), `created_by_user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` / `branch_id` | bigint | yes | | Scope |
| `created_by_user_id` | bigint | yes | | Owner |
| `public_id` | text | yes | | Frontend event id |
| `kind` | text | yes | default `form` | Event type |
| `status` | text | yes | default `draft`; also launched states | Lifecycle |
| `title` | text | yes | | Name |
| `public_slug` | text | no | unique | Public `/f/:slug` |
| `launched_at` | timestamp(3) | no | | When published |
| `submission_count` / `open_count` | int | yes | | Counters |
| `payload` | jsonb | yes | | Form schema, theme, … |
| `created_at` / `updated_at` | timestamp(3) | yes | | Audit |

**Example row:** `id=3, organization_id=1000, branch_id=1000, created_by_user_id=1005, public_id=evt_form_1, kind=form, status=launched, title=Webinar signup, public_slug=webinar-signup, submission_count=18, open_count=90`

---

## `campaign.campaign_form_submissions`

**Purpose:** Public form replies.

**Keys:** PK `id`. Unique `public_reply_id`. Logical join: `event_public_id` → `campaign.campaign_opportunity_events.public_id` (**no Postgres FK**).

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `organization_id` | bigint | yes | Tenant |
| `event_public_id` | text | yes | Which event |
| `form_slug` | text | yes | Public slug |
| `public_reply_id` | text | yes | Public reply id |
| `answers` / `fields` | jsonb | yes | Submitted values + field defs snapshot |
| `created_at` | timestamp(3) | yes | When submitted |

**Example row:** `id=200, organization_id=1000, event_public_id=evt_form_1, form_slug=webinar-signup, public_reply_id=rpl_88, answers={"email":"alice@example.com","name":"Alice"}`

---

## `campaign.daily_report_email_deliveries`

**Purpose:** Prevent duplicate daily KPI emails (one row per org + user + report calendar date).

**Keys:** PK `id`. Unique (`organization_id`, `user_id`, `report_date`). Logical `user_id` → `accounts.setup_users.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `user_id` | bigint | yes | | Recipient user |
| `report_date` | text | yes | `YYYY-MM-DD` in recipient tz | Which day |
| `timezone` | text | yes | default `Asia/Kolkata` | Calendar tz |
| `recipient_email` | text | yes | | To address |
| `status` | text | yes | default `sent` | Delivery log |
| `provider_id` | text | no | | ESP id |
| `error_message` | text | no | | Failure |
| `sent_at` | timestamp(3) | yes | | When attempted |

**Example row:** `id=40, organization_id=1000, user_id=1005, report_date=2026-09-22, timezone=Asia/Kolkata, recipient_email=priya.sharma@company.com, status=sent`

---

# `accounts` schema (Campaign reads; does not own)

Campaign login and channel wiring live here. Extra columns may exist on Accounts that Campaign never touches; below is what **this product uses**.

---

## `accounts.organizations`

**Purpose:** The tenant company. Campaign copies `id` onto every row as `organization_id`. `business_type` sets B2B vs B2C mode. `industry_type` seeds industry packs.

**Keys:** PK `id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Tenant id |
| `company_name` | text | no | | Display name |
| `business_type` | text | no | `B2B`, `B2C` | Product mode |
| `industry_type` | text | no | free text | Pack seed |

**Example row:** `id=1000, company_name=Acme Retail Pvt Ltd, business_type=B2B, industry_type=Software / SaaS`

---

## `accounts.setup_users`

**Purpose:** People who log into Campaign. Password never returned to the client.

**Keys:** PK `id`. Logical FK `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | JWT subject |
| `work_email` | text | yes | | Login email |
| `password_hash` | text | yes | | Bcrypt |
| `first_name` / `last_name` | text | yes | | Display |
| `status` | text | yes | must be `active` to log in | Account state |
| `organization_id` | bigint | yes | | Home tenant |

**Example row:** `id=1005, work_email=priya.sharma@company.com, first_name=Priya, last_name=Sharma, status=active, organization_id=1000`

---

## `accounts.setup_roles`

**Purpose:** Named roles. Campaign treats `name=admin` as **branch-wide** reports; any other name as **my campaigns only**.

**Keys:** PK `id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `name` | text | yes | Role slug in session (`admin`, `marketing`, …) |

**Example row:** `id=3001, name=admin`

---

## `accounts.setup_user_product_access`

**Purpose:** Join user + org to a role (and product access). Campaign uses this to resolve `session.role`.

**Keys:** Composite usage: `user_id` + `organization_id` + `role_id`. Logical FKs to `accounts.setup_users`, `accounts.organizations`, `accounts.setup_roles`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `user_id` | bigint | yes | User |
| `organization_id` | bigint | yes | Org |
| `role_id` | bigint | yes | Role |

**Example row:** `user_id=1005, organization_id=1000, role_id=3001`

---

## `accounts.setup_channel_configs`

**Purpose:** Cross-product WhatsApp/email (etc.) integrations. Referenced internally by regulated templates.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | Internal config id |
| `organization_id` | bigint | yes | | Tenant |
| `channel_type` | text | yes | `whatsapp`, `email`, … | Integration type |
| `name` | text | yes | | Display |
| `status` | text | yes | `active`, `pending`, … | Connection state |
| `product_ids` | jsonb | yes | e.g. `["campaign"]` | Which products may use it |

**Example row:** `id=7001, organization_id=1000, channel_type=whatsapp, name=Meta WhatsApp Business, status=active, product_ids=["campaign"]`

---

## `accounts.setup_email_configs`

**Purpose:** User mailbox From metadata for **test send from connected inbox** (not bulk ESP).

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `id` | bigint | yes | PK |
| `organization_id` | bigint | yes | Tenant |
| `from_address` | text | yes | Mailbox From |
| `display_name` | text | no | From name |
| `status` | text | yes | Connection status |

**Example row:** `id=1, organization_id=1000, from_address=priya.sharma@company.com, display_name=Priya Sharma, status=active`

---

## `accounts.mail_oauth_connections`

**Purpose:** Encrypted Google/Microsoft tokens for mailbox test send. Never log refresh tokens.

**Keys:** PK `id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `id` | bigint | yes | | PK |
| `organization_id` | bigint | yes | | Tenant |
| `provider` | text | yes | `google`, `microsoft` | OAuth vendor |
| `email` | text | yes | | Connected mailbox |
| `refresh_token_encrypted` | text | yes | | Server only |
| `status` | text | yes | | Connection |

**Example row:** `id=1, organization_id=1000, provider=google, email=priya.sharma@company.com, status=active`

---

## `accounts.a2a_spoke_clients`

**Purpose:** Agent-to-agent client credentials between Hub and Campaign (`a2a_server_name`, `client_id`, `client_secret`, tokens). Seeded by Campaign SQL scripts. Not a `campaign` schema table.

**Example row:** `a2a_server_name=worktual-campaign, client_id=worktual-hub-campaign, created_at=now()`

---

# `cdp` schema (contacts)

Campaign may SELECT/INSERT/UPDATE/DELETE **existing columns only**. Soft-delete in Campaign UI sets `custom_fields.campaign_deleted = true`.

---

## `cdp.customer_profile`

**Purpose:** Canonical person. Campaign Audience lists these people. Campaign tables store `cdp_id` as `contact_id`.

**Keys:** PK `cdp_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Why it exists |
|--------|------|----------|----------------|
| `cdp_id` | bigint | yes | Contact id everywhere in Campaign |
| `organization_id` | bigint | yes | Tenant |
| `first_name` / `last_name` | text | no | Name |
| `company` | text | no | API: `company_name` |
| `city` | text | no | City |
| `custom_fields` | jsonb | no | Extra attrs (`job_title`, `score`, `campaign_deleted`, industry, …) |
| `created_at` / `updated_at` | timestamptz | yes | Audit |
| `first_seen_at` / `last_seen_at` | timestamptz | no | Activity |
| `acquisition_channel` | text | no | Campaign sets `'campaign'` on insert |

**Example row:** `cdp_id=9000000000000000123, organization_id=1000, first_name=Alice, last_name=Nguyen, company=Northwind Labs, city=Chennai, custom_fields={"job_title":"Head of Growth","score":82,"campaign_deleted":false}, acquisition_channel=campaign`

---

## `cdp.identity_keys`

**Purpose:** Email and phone rows for a profile. Uniqueness and lookup live here, not on the profile.

**Keys:** PK `identity_id` (uuid). FK `cdp_id` → `cdp.customer_profile.cdp_id`. Logical `organization_id` → `accounts.organizations.id`.

| Column | Type | Required | Values | Why it exists |
|--------|------|----------|--------|----------------|
| `identity_id` | uuid | yes | | PK |
| `cdp_id` | bigint | yes | | Profile |
| `organization_id` | bigint | yes | | Tenant uniqueness |
| `key_type` | text | yes | `email`, `primary_email`, `phone`, `primary_phone`, `mobile` | Kind |
| `key_value` | text | yes | | Normalized email or phone |
| `source_system` | text | yes | Campaign writes `campaign` | Origin |
| `verified` | boolean | yes | | Verified flag |
| `created_at` | timestamptz | yes | | Created |
| `custom_fields` | jsonb | no | | Extra |

**Example row:** `identity_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890, cdp_id=9000000000000000123, organization_id=1000, key_type=email, key_value=alice@example.com, source_system=campaign, verified=true`

---

# Typical data flow

```text
Login          accounts.setup_users + organizations + roles
               → campaign.organization_products must be active campaign
Draft          campaign_agent_sessions
               + audience_refs and/or session_temp_contacts
               + campaign_channel_templates + template_messages
Save           campaigns + campaign_channels + campaign_audience
Configure      email_* / push_* / sms_* / channel_sending_profiles
Launch         campaign_send_batches → campaign_send_recipients
Measure        recipient opens/clicks + campaign_contact_engagement + suppressions
People         cdp.customer_profile + identity_keys
Visitors       website_contacts (optional promote to CDP)
```

---

# Related files

| File | Use |
|------|-----|
| Postgres schema `campaign` | Source of truth for Campaign tables (`\dt campaign.*`) |
| `docs/CAMPAIGN_DATABASE_TABLES_REFERENCE.md` | Older table guide |
| `docs/CAMPAIGN_AGENTS_ONTOLOGY.md` | Which MAS agents talk about these entities |
| `docs/CAMPAIGN_METRICS_SQL_AGENT.md` | How to query this data for KPIs |
