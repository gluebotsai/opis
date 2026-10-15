# Campaign platform — database schema with sample values

Companion to [`CAMPAIGN_DATABASE_SCHEMA.md`](CAMPAIGN_DATABASE_SCHEMA.md) (column definitions only).

**Source of truth:** [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma)  
**Sample values from:** `backend/prisma/seed.ts`, `backend/src/dao/agent-session.ts`, `backend/src/services/personalization/fixture-recipients.json`, `backend/src/helpers/industry-pack-seed.ts`

Each table below lists **every column** with a realistic **Example** value used in the Campaign product (demo seed, fixtures, or production defaults).

---

## Shared example IDs

These recur across tables in local/dev seed data:

| Symbol | Example value | Meaning |
|--------|---------------|---------|
| `TENANT_ID` | `00000000-0000-4000-8000-000000000001` | `DEFAULT_TENANT_ID` / org id (API string; DB bigint) |
| `BRANCH_ID` | `10000000-0000-4000-8000-000000000001` | Default branch |
| `USER_ID` | `20000000-0000-4000-8000-000000000001` | `SEED_USER_ID` |
| `CONTACT_ID` | `9000000000000000123` | Live CDP `cdp_id` (bigint) |
| `CAMPAIGN_ID` | `3000000000000000001` | Autoincrement campaign row |
| `SESSION_ID` | `9000000000000000042` | Create-campaign draft session |
| `NOW` | `2026-08-25T10:30:00.000Z` | Representative timestamp |

---

## Enums — example values

| Enum | Example column value |
|------|----------------------|
| `ProductCode` | `"campaign"` |
| `ProductStatus` | `"active"` |
| `CampaignStatus` | `"live"` (also `"draft"`, `"scheduled"`, `"completed"`, `"cancelled"`) |
| `SourceChannel` | `"standalone_campaign"` |
| `ChannelConfigStatus` | `"ready"` |
| `RegulatedTemplateStatus` | `"approved"` |

---

## `campaign` schema (27 tables)

### `branches`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `10000000-0000-4000-8000-000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `name` | text | NO | | `"Default"` |
| `is_default` | boolean | NO | `false` | `true` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

---

### `organization_products`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `1000000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `branch_id` | bigint | NO | | `10000000-0000-4000-8000-000000000001` |
| `product_code` | enum | NO | | `"campaign"` |
| `status` | enum | NO | `active` | `"active"` |
| `starts_at` | timestamptz | YES | | `2026-08-25T06:00:00.000Z` |
| `ends_at` | timestamptz | YES | | `null` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

Second row example: `product_code` = `"crm"`.

---

### `campaigns`

Demo row from seed key `live-summer-sale`:

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `3000000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `branch_id` | bigint | NO | | `10000000-0000-4000-8000-000000000001` |
| `name` | text | NO | | `"Demo · Summer Sale Blast"` |
| `description` | text | YES | | `"Live email promo for summer SKUs."` |
| `status` | enum | NO | `draft` | `"live"` |
| `starts_at` | timestamptz | YES | | `2026-08-22T12:00:00.000Z` |
| `ends_at` | timestamptz | YES | | `2026-09-05T12:00:00.000Z` |
| `source_channel` | enum | NO | `standalone_campaign` | `"standalone_campaign"` |
| `created_by_user_id` | bigint | NO | | `20000000-0000-4000-8000-000000000001` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-19T08:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T10:00:00.000Z` |
| `goal` | text | YES | | `"Drive seasonal revenue"` |
| `objective` | text | YES | | `"Increase checkout conversions this week"` |
| `session_id` | bigint | YES | | `9000000000000000042` (or `null` before save) |
| `audience_summary` | text | YES | | `"Contacts in Chennai & Bangalore with email"` |
| `audience_filters` | jsonb | YES | | `{"city":"Chennai","has_email":true}` |
| `audience_count` | int | NO | `0` | `1200` |
| `launch_plan` | jsonb | YES | | see below |
| `launch_local_date` | text | YES | | `"2026-06-05"` |
| `launch_local_time` | text | YES | | `"12:00"` |
| `timezone` | text | YES | `Asia/Kolkata` | `"Asia/Kolkata"` |

**Example `launch_plan` (email live campaign):**

```json
{
  "schedule_mode": "now",
  "scheduled_at": "2026-08-22T12:00:00.000Z",
  "launch_channels": ["email"],
  "ab_enabled": false,
  "channel_run": {
    "email": {
      "sent": 860,
      "failed": 24,
      "opens": 318,
      "clicks": 74,
      "paused": false,
      "reason": null,
      "paused_at": null
    }
  },
  "timezone": "Asia/Kolkata",
  "launch_local_date": "2026-06-05"
}
```

**Example `launch_plan.channel_run.ppc` (Meta PPC):**

```json
{
  "network": "meta",
  "impressions": 48200,
  "clicks": 1260,
  "spend": 18420,
  "currency": "INR",
  "conversions": 96,
  "daily_budget": 3500,
  "plan_summary": "Meta · leads · video · feed/reels · CTA Register free",
  "sent": 0,
  "failed": 0,
  "opens": 0,
  "clicks": 1260,
  "paused": false,
  "reason": null
}
```

---

### `campaign_channels`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `4000000000000000001` |
| `campaign_id` | bigint | NO | | `3000000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `channel` | text | NO | | `"email"` |
| `template_id` | bigint | YES | | `5000000000000000001` |
| `how_it_works` | text | YES | | `"Email drip with product highlights and limited-time offer."` |
| `planned_launch_at` | text | YES | | `"2026-08-22T12:00:00.000Z"` |
| `status` | text | NO | `ready` | `"ready"` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-19T08:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T10:00:00.000Z` |

Other channel examples: `"push"`, `"web"`, `"ppc"`, `"sms"`, `"whatsapp"`.

---

### `campaign_audience`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `campaign_id` | bigint | NO | | `3000000000000000001` |
| `contact_id` | bigint | NO | | `9000000000000000123` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-22T11:55:00.000Z` |

---

### `campaign_agent_sessions`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | | `9000000000000000042` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `branch_id` | bigint | NO | | `10000000-0000-4000-8000-000000000001` |
| `created_by_user_id` | bigint | NO | | `20000000-0000-4000-8000-000000000001` |
| `module` | text | NO | `create_campaign` | `"create_campaign"` |
| `stage` | text | NO | `intake` | `"audience"` |
| `payload` | jsonb | NO | | see below |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T09:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T10:30:00.000Z` |

**Example `payload` (`create_campaign`):**

```json
{
  "session_id": "9000000000000000042",
  "user_id": "20000000-0000-4000-8000-000000000001",
  "tenant_id": "00000000-0000-4000-8000-000000000001",
  "branch_id": "10000000-0000-4000-8000-000000000001",
  "module": "create_campaign",
  "stage": "audience",
  "campaign": {
    "name": "Summer Sale Blast",
    "goal": "Drive seasonal revenue",
    "objective": "Increase checkout conversions this week"
  },
  "audience": {
    "filters": { "city": "Chennai", "has_email": true },
    "matched_count": 1200,
    "sample_names": ["Alice Nguyen", "Bob Patel"],
    "description": "Contacts in Chennai with email",
    "scores": null
  },
  "channels": ["email"],
  "channel_plans": [
    {
      "channel": "email",
      "how_it_works": "Single promo email with summer SKU highlights and limited-time CTA"
    }
  ],
  "confirmed_create_templates": false,
  "templates": [],
  "active_edit_channel": null,
  "launch_plan": null,
  "launch_confirmed": false,
  "messages": [
    {
      "role": "user",
      "text": "Create a summer sale email for Chennai contacts",
      "created_at": "2026-08-25T09:01:00.000Z"
    },
    {
      "role": "assistant",
      "text": "I found 1,200 contacts in Chennai with email. Ready to draft the template?",
      "created_at": "2026-08-25T09:01:05.000Z"
    }
  ],
  "llm_memory": [],
  "hub_mode": false
}
```

**Example `payload` (`contacts` module):**

```json
{
  "module": "contacts",
  "stage": "idle",
  "focus_contact_id": "9000000000000000123",
  "draft_contact": {
    "first_name": "Alice",
    "last_name": "Nguyen",
    "email": "alice@example.com",
    "phone": "+6591234567",
    "company_name": "Northwind Labs",
    "city": "Singapore"
  },
  "candidates": [],
  "pending_delete_id": null,
  "messages": []
}
```

---

### `campaign_audience_refs`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `session_id` | bigint | NO | | `9000000000000000042` |
| `contact_id` | bigint | NO | | `9000000000000000123` |

---

### `campaign_channel_templates`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `5000000000000000001` |
| `session_id` | bigint | NO | | `9000000000000000042` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `branch_id` | bigint | NO | | `10000000-0000-4000-8000-000000000001` |
| `channel` | text | NO | | `"email"` |
| `logo` | text | YES | | `"https://cdn.example.com/brand/logo.png"` |
| `launch_at` | text | YES | | `"2026-08-26T10:00:00+05:30"` |
| `how_it_works` | text | YES | | `"Promo email with hero banner and shop-now CTA"` |
| `fields` | jsonb | NO | | see below |
| `generation_batch_id` | bigint | YES | | `6000000000000000001` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T09:30:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T10:15:00.000Z` |

**Example `fields` (email):**

```json
{
  "subject": "Summer Sale — up to 30% off this week",
  "preheader": "Limited-time offers on top SKUs",
  "blocks": [
    { "type": "hero", "headline": "Summer Sale", "body": "Shop now and save." },
    { "type": "cta", "label": "Shop the sale", "url": "https://shop.example.com/summer" }
  ],
  "from_display": "Worktual Team"
}
```

---

### `campaign_template_messages`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `7000000000000000001` |
| `template_id` | bigint | NO | | `5000000000000000001` |
| `role` | text | NO | | `"user"` |
| `seq` | int | NO | | `0` |
| `kind` | text | NO | | `"text"` |
| `payload` | jsonb | NO | | `{"text":"Make the headline more urgent"}` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T10:00:00.000Z` |

Assistant row example: `role` = `"assistant"`, `kind` = `"template"`, `payload` = `{"text":"Updated headline to: Last chance — Summer Sale ends Sunday"}`.

---

### `channel_sending_profiles`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8000000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `channel` | text | NO | | `"email"` |
| `status` | enum | NO | `not_started` | `"ready"` |
| `checklist` | jsonb | YES | | see below |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

**Example `checklist` (seed):**

```json
{
  "postal": true,
  "sender_verified": true,
  "domain_authenticated": true,
  "return_path_verified": true,
  "compliance_defaults": true,
  "forced_unsubscribe": true,
  "doi_default_on": true
}
```

---

### `push_channel_settings`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8100000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `channel` | text | NO | | `"web_push"` |
| `settings` | jsonb | NO | `{}` | `{"vapid_public_key":"BEl…","vapid_subject":"mailto:ops@company.com"}` |
| `status` | text | NO | `not_started` | `"ready"` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

App push row: `channel` = `"app_push"`, `settings` = `{"fcm_project_id":"my-app","apns_team_id":"ABCDE12345"}` (secrets stored server-side).

---

### `email_org_profiles`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8200000000000000001` |
| `tenant_id` | bigint | NO (unique) | | `00000000-0000-4000-8000-000000000001` |
| `legal_name` | text | NO | | `"Worktual"` |
| `street` | text | NO | | `"Campaign HQ"` |
| `city` | text | NO | | `"London"` |
| `country` | text | NO | | `"UK"` |
| `phone` | text | YES | | `null` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

---

### `email_senders`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8300000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `display_name` | text | NO | | `"Worktual Team"` |
| `from_email` | text | NO | | `"hello@example.com"` |
| `reply_to` | text | YES | | `null` |
| `status` | text | NO | `pending_verification` | `"verified"` |
| `verify_token` | text | YES | | `null` |
| `verify_expires_at` | timestamptz | YES | | `null` |
| `verified_at` | timestamptz | YES | | `2026-08-25T06:00:00.000Z` |
| `is_active` | boolean | NO | `false` | `true` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

Pending example: `status` = `"pending_verification"`, `verify_token` = `"a1b2c3d4…"`, `verify_expires_at` = `2026-08-26T06:00:00.000Z`.

---

### `email_domains`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8400000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `domain` | text | NO | | `"example.com"` |
| `spf_ok` | boolean | NO | `false` | `true` |
| `dkim_ok` | boolean | NO | `false` | `true` |
| `dmarc_ok` | boolean | NO | `false` | `true` |
| `status` | text | NO | `not_started` | `"authenticated"` |
| `provider_domain_id` | text | YES | | `"20607"` |
| `dns_records` | jsonb | YES | | `[]` |
| `dkim_selector` | text | YES | | `"campaign"` |
| `dkim_public_key` | text | YES | | `"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A…"` |
| `dkim_private_key_encrypted` | text | YES | | `"aes-gcm:…"` (never returned to FE) |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

---

### `email_return_paths`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8500000000000000001` |
| `tenant_id` | bigint | NO (unique) | | `00000000-0000-4000-8000-000000000001` |
| `domain` | text | NO | | `"example.com"` |
| `status` | text | NO | `not_started` | `"verified"` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

---

### `email_sending_caps`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8600000000000000001` |
| `tenant_id` | bigint | NO (unique) | | `00000000-0000-4000-8000-000000000001` |
| `batch_size` | int | NO | `200` | `20` (seed) |
| `hourly_cap` | int | NO | `500` | `200` |
| `daily_cap` | int | NO | `1000` | `1000` |
| `warmup_stage` | int | NO | `0` | `0` |
| `health_status` | text | NO | `healthy` | `"healthy"` |
| `health_stats` | jsonb | YES | | `{"sent":42,"hardBounce":0,"complaint":0,"windowStart":"2026-08-25T00:00:00.000Z"}` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

Blocked example: `health_status` = `"blocked_sending"`.

---

### `email_suppressions`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8700000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `email` | text | NO | | `"unsubscribed@example.com"` |
| `reason` | text | NO | | `"unsub"` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-20T14:22:00.000Z` |

Other reasons: `"hard_bounce"`, `"complaint"`.

---

### `sms_channel_settings`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8800000000000000001` |
| `tenant_id` | bigint | NO (unique) | | `00000000-0000-4000-8000-000000000001` |
| `settings` | jsonb | NO | `{}` | see below |
| `status` | text | NO | `not_started` | `"ready"` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

**Example `settings`:**

```json
{
  "provider": "msg91",
  "sender_id": "WTUAL",
  "entity_id": "1201150123456789012345",
  "base_url": "https://api.msg91.com/api/v5/flow/",
  "api_key": "••••••••"
}
```

---

### `regulated_channel_templates`

WhatsApp example:

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `8900000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `channel` | text | NO | | `"whatsapp"` |
| `name` | text | NO | | `"order_update_v1"` |
| `external_id` | text | NO | `""` | `"order_update_v1"` |
| `provider_template_id` | text | YES | | `"1234567890123456"` |
| `language` | text | NO | `en` | `"en"` |
| `category` | text | NO | `""` | `"UTILITY"` |
| `header` | text | NO | `""` | `"Order update"` |
| `body` | text | NO | | `"Hi {{1}}, your order {{2}} is on the way."` |
| `footer` | text | NO | `""` | `"Reply STOP to opt out"` |
| `buttons` | text | NO | `""` | `"Track order\nContact support"` |
| `status` | enum | NO | `draft` | `"approved"` |
| `rejected_reason` | text | YES | | `null` |
| `channel_config_id` | bigint | YES | | `454094b7…` (internal bigint ref) |
| `submitted_at` | timestamptz | YES | | `2026-08-18T09:00:00.000Z` |
| `last_status_checked_at` | timestamptz | YES | | `2026-08-25T08:00:00.000Z` |
| `created_by_user_id` | bigint | YES | | `20000000-0000-4000-8000-000000000001` |
| `campaign_name` | text | NO | `""` | `"Demo · Summer Sale Blast"` |
| `goal` | text | NO | `""` | `"Drive seasonal revenue"` |
| `objective` | text | NO | `""` | `"Increase checkout conversions"` |
| `source_campaign_id` | bigint | YES | | `3000000000000000001` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-18T08:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T08:00:00.000Z` |

SMS row: `channel` = `"sms"`, `external_id` = `"1207160123456789012345"` (DLT template id).

---

### `campaign_send_batches`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `9100000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `campaign_id` | bigint | NO | | `3000000000000000001` |
| `channel` | text | NO | `email` | `"email"` |
| `seq` | int | NO | | `0` |
| `scheduled_for` | timestamptz | NO | | `2026-08-22T12:00:00.000Z` |
| `status` | text | NO | `queued` | `"done"` |
| `size` | int | NO | `0` | `860` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-22T11:58:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-22T12:45:00.000Z` |

---

### `campaign_send_recipients`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `9200000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `batch_id` | bigint | NO | | `9100000000000000001` |
| `campaign_id` | bigint | NO | | `3000000000000000001` |
| `contact_id` | bigint | YES | | `9000000000000000123` |
| `email` | text | YES | | `"alice@example.com"` |
| `destination` | text | YES | | `null` (email) or push URL |
| `platform` | text | YES | | `"web"` |
| `status` | text | NO | `pending` | `"sent"` |
| `skip_fail_reason` | text | YES | | `null` |
| `provider_message_id` | text | YES | | `"esp-msg-7f3a9c2b"` |
| `attempt_count` | int | NO | `0` | `1` |
| `ab_variant` | text | YES | | `"a"` |
| `opened_at` | timestamptz | YES | | `2026-08-22T12:15:00.000Z` |
| `clicked_at` | timestamptz | YES | | `2026-08-22T12:18:00.000Z` |
| `open_count` | int | NO | `0` | `3` |
| `click_count` | int | NO | `0` | `1` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-22T12:00:01.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-22T12:18:00.000Z` |

Skipped example: `status` = `"skipped"`, `skip_fail_reason` = `"suppressed"`.  
Failed example: `status` = `"failed"`, `skip_fail_reason` = `"invalid_email"`.

Push row: `channel` implied by batch, `destination` = `"https://fcm.googleapis.com/fcm/send/…"`, `email` = `null`.

---

### `push_endpoints`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `9300000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `contact_id` | bigint | YES | | `9000000000000000123` |
| `channel` | text | NO | | `"web"` |
| `platform` | text | YES | | `"chrome"` |
| `endpoint` | text | NO | | `"https://fcm.googleapis.com/fcm/send/dGhpcy1pcy1hLXRlc3Q…"` |
| `auth_keys` | jsonb | YES | | `{"p256dh":"BNcRd…","auth":"tBHIt…"}` |
| `label` | text | YES | | `"Marketing site"` |
| `active` | boolean | NO | `true` | `true` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-10T08:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T09:00:00.000Z` |

App push: `channel` = `"push"`, `endpoint` = device token string, `platform` = `"ios"`.

---

### `website_contacts`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `9400000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `visitor_id` | text | NO | | `"550e8400-e29b-41d4-a716-446655440000"` |
| `contact_id` | bigint | YES | | `null` |
| `email` | text | YES | | `"visitor@example.com"` |
| `phone` | text | YES | | `null` |
| `first_name` | text | YES | | `"Sam"` |
| `last_name` | text | YES | | `"Lee"` |
| `origin` | text | NO | `""` | `"https://shop.example.com"` |
| `path` | text | YES | | `"/summer-sale"` |
| `user_agent` | text | YES | | `"Mozilla/5.0 (Windows NT 10.0; Win64; x64)…"` |
| `subscribed` | boolean | NO | `false` | `true` |
| `endpoint` | text | YES | | `"https://fcm.googleapis.com/fcm/send/…"` |
| `auth_keys` | jsonb | YES | | `{"p256dh":"…","auth":"…"}` |
| `platform` | text | YES | | `"web"` |
| `visit_count` | int | NO | `1` | `5` |
| `first_seen_at` | timestamptz | NO | `now()` | `2026-08-20T10:00:00.000Z` |
| `last_seen_at` | timestamptz | NO | `now()` | `2026-08-25T10:00:00.000Z` |
| `subscribed_at` | timestamptz | YES | | `2026-08-21T11:00:00.000Z` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-20T10:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T10:00:00.000Z` |

---

### `campaign_contact_engagement`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `9500000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `contact_id` | bigint | NO | | `9000000000000000123` |
| `email_unsubscribed` | boolean | NO | `false` | `false` |
| `email_unsubscribed_at` | timestamptz | YES | | `null` |
| `email_unsubscribe_reason` | text | YES | | `null` |
| `last_email_opened_at` | timestamptz | YES | | `2026-08-22T12:15:00.000Z` |
| `last_email_clicked_at` | timestamptz | YES | | `2026-08-22T12:18:00.000Z` |
| `email_open_count` | int | NO | `0` | `12` |
| `email_click_count` | int | NO | `0` | `4` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-01T00:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-22T12:18:00.000Z` |

Unsubscribed example: `email_unsubscribed` = `true`, `email_unsubscribed_at` = `2026-08-20T14:22:00.000Z`, `email_unsubscribe_reason` = `"user_link"`.

---

### `tenant_industry_packs`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `9600000000000000001` |
| `tenant_id` | bigint | NO (unique) | | `00000000-0000-4000-8000-000000000001` |
| `pack_id` | text | NO | `generic-b2b` | `"generic-b2b"` |
| `seed_industry_type` | text | NO | `""` | `"Software / SaaS"` |
| `payload` | jsonb | NO | `{}` | see below |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T06:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T06:00:00.000Z` |

**Example `payload`:**

```json
{
  "version": 1,
  "mode": "b2b",
  "seedIndustryType": "Software / SaaS",
  "fields": [
    {
      "key": "job_title",
      "label": "job title",
      "type": "string",
      "ask": "recommended",
      "source": "seed",
      "status": "active"
    }
  ],
  "rules": [
    {
      "id": "rule-1",
      "text": "Prefer business email domains for B2B outreach",
      "source": "seed",
      "createdAt": "2026-08-25T06:00:00.000Z"
    }
  ]
}
```

B2C example: `pack_id` = `"generic-b2c"`, `mode` = `"b2c"`, fields include `segment`, `product_interest`.

---

### `campaign_recommendations`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `9700000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `branch_id` | bigint | NO | | `10000000-0000-4000-8000-000000000001` |
| `created_by_user_id` | bigint | NO | | `20000000-0000-4000-8000-000000000001` |
| `public_id` | text | NO | | `"rec-20260825-winback"` |
| `status` | text | NO | | `"active"` |
| `title` | text | NO | `""` | `"Re-engage dormant trial users"` |
| `payload` | jsonb | NO | `{}` | see below |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T08:00:00.000Z` |
| `updated_at` | timestamptz | NO | auto | `2026-08-25T09:30:00.000Z` |

**Example `payload` (PII arrays stripped at persist):**

```json
{
  "id": "rec-20260825-winback",
  "title": "Re-engage dormant trial users",
  "status": "active",
  "channels": ["email"],
  "audienceHint": "No login in 14 days",
  "goal": "Bring users back to the product",
  "chatMessages": [
    { "role": "user", "text": "Suggest a win-back campaign", "at": "2026-08-25T08:00:00.000Z" }
  ],
  "editLog": []
}
```

Other statuses: `"creating"`, `"dismissed"`, `"used"`, `"expired"`, `"deleted"`.

---

### `app_notifications`

| Column | Type | Null | Default | Example |
|--------|------|------|---------|---------|
| `id` | bigint | NO | autoincrement | `9800000000000000001` |
| `tenant_id` | bigint | NO | | `00000000-0000-4000-8000-000000000001` |
| `user_id` | bigint | YES | | `20000000-0000-4000-8000-000000000001` (or `null` = tenant-wide) |
| `kind` | text | NO | | `"template_pending"` |
| `title` | text | NO | | `"WhatsApp template pending review"` |
| `body` | text | NO | | `"order_update_v1 is awaiting Meta approval."` |
| `href` | text | YES | | `"/configuration/whatsapp"` |
| `source_key` | text | NO | | `"template:pending-stuck:8900000000000000001"` |
| `created_at` | timestamptz | NO | `now()` | `2026-08-25T08:00:00.000Z` |
| `read_at` | timestamptz | YES | | `null` |

---

## `accounts` schema — sample values

### `accounts.setup_users`

| Column | Type | Example |
|--------|------|---------|
| `id` | bigint | `20000000-0000-4000-8000-000000000001` |
| `work_email` | text | `"priya.sharma@company.com"` |
| `password_hash` | text | `"$2b$10$…"` (bcrypt) |
| `first_name` | text | `"Priya"` |
| `last_name` | text | `"Sharma"` |
| `status` | text | `"active"` |
| `organization_id` | bigint | `00000000-0000-4000-8000-000000000001` |

---

### `accounts.organizations`

| Column | Type | Example |
|--------|------|---------|
| `id` | bigint | `00000000-0000-4000-8000-000000000001` |
| `company_name` | text | `"Acme Retail Pvt Ltd"` |
| `business_type` | text | `"B2B"` (or `"B2C"`) |
| `industry_type` | text | `"Software / SaaS"` |

---

### `accounts.setup_user_product_access`

| Column | Type | Example |
|--------|------|---------|
| `user_id` | bigint | `20000000-0000-4000-8000-000000000001` |
| `organization_id` | bigint | `00000000-0000-4000-8000-000000000001` |
| `role_id` | bigint | `3000000000000000001` |

---

### `accounts.setup_roles`

| Column | Type | Example |
|--------|------|---------|
| `id` | bigint | `3000000000000000001` |
| `name` | text | `"admin"` |

---

### `accounts.setup_channel_configs`

| Column | Type | Example |
|--------|------|---------|
| `id` | bigint | `454094b7-4a9a-43b0-b4cd-59663a8f1a06` (stored as bigint in regulated templates) |
| `organization_id` | bigint | `00000000-0000-4000-8000-000000000001` |
| `channel_type` | text | `"whatsapp"` |
| `name` | text | `"Meta WhatsApp Business"` |
| `status` | text | `"active"` |
| `product_ids` | json/jsonb | `["campaign"]` |

Email row: `channel_type` = `"email"`, `status` = `"active"`.

---

### `accounts.setup_email_configs` / `accounts.mail_oauth_connections`

Read-only for mailbox test send. Example email config row: `from_address` = `"user@company.com"`, OAuth connection with encrypted refresh token (never logged).

---

## `cdp` schema — sample values

### `cdp.customer_profile`

Live contact (maps to API + fixture Alice):

| Column | Type | Example |
|--------|------|---------|
| `cdp_id` | bigint | `9000000000000000123` |
| `organization_id` | bigint | `00000000-0000-4000-8000-000000000001` |
| `first_name` | text | `"Alice"` |
| `last_name` | text | `"Nguyen"` |
| `company` | text | `"Northwind Labs"` |
| `city` | text | `"Chennai"` |
| `custom_fields` | jsonb | `{"job_title":"Head of Growth","segment":"vip","score":82}` |
| `created_at` | timestamptz | `2026-07-01T08:00:00.000Z` |
| `updated_at` | timestamptz | `2026-08-25T09:00:00.000Z` |
| `first_seen_at` | timestamptz | `2026-07-01T08:00:00.000Z` |
| `last_seen_at` | timestamptz | `2026-08-25T09:00:00.000Z` |
| `acquisition_channel` | text | `"campaign"` |

Soft-deleted contact: `custom_fields` = `{"campaign_deleted": true}`.

**Fixture-only ids** (personalization preview, not in CDP): `fixture-alice-001`, `fixture-bob-002`, … from `fixture-recipients.json`.

---

### `cdp.identity_keys`

Email row:

| Column | Type | Example |
|--------|------|---------|
| `identity_id` | uuid | `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"` |
| `cdp_id` | bigint | `9000000000000000123` |
| `organization_id` | bigint | `00000000-0000-4000-8000-000000000001` |
| `key_type` | text | `"email"` |
| `key_value` | text | `"alice@example.com"` |
| `source_system` | text | `"campaign"` |
| `verified` | boolean | `true` |
| `created_at` | timestamptz | `2026-07-01T08:00:00.000Z` |
| `custom_fields` | jsonb | `{}` |

Phone row: `key_type` = `"phone"`, `key_value` = `"+919876543210"`.

---

## Fixture catalog (not DB tables)

Used when no live CDP ids are available (`fixture-recipients.json`):

| `contact_id` | Email | Name | City |
|--------------|-------|------|------|
| `fixture-alice-001` | `alice@example.com` | Alice Nguyen | Singapore |
| `fixture-bob-002` | `bob@example.com` | Bob Patel | Mumbai |
| `fixture-cara-003` | `cara@example.com` | Cara Singh | London |

Each fixture includes an `offer` object for dynamic-offer email personalization (product name, price, URL).

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [`CAMPAIGN_DATABASE_SCHEMA.md`](CAMPAIGN_DATABASE_SCHEMA.md) | Schema reference without samples |
| [`schema/campaign_er_diagram.md`](schema/campaign_er_diagram.md) | ER diagram |
| [`schema/campaign_tables.csv`](schema/campaign_tables.csv) | Table index CSV |
| [`schema/campaign_columns.csv`](schema/campaign_columns.csv) | Column index CSV |
