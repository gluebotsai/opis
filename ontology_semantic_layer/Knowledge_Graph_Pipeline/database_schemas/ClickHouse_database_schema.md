# Worktual Web Tracking — Complete Database Reference

**Audience:** Engineering, analytics, Campaign Management, AI chat  
**Version:** 1.0  
**Last updated:** 2026-09-01  

**Stores:**

| Store | Database | Role |
|-------|----------|------|
| **PostgreSQL** | `web_analytics` (dashboard auth) + `worktual_bigint` (My Accounts ingest registry) | Login, registered websites |
| **ClickHouse** | `web_tracking` | All tracking events, sessions, visitors, aggregates |

**Tenant key:** Almost every analytics query must filter `WHERE website_id = ?` (and often `organization_id`).

**Naming (current):** Use `website_id` / `website_url` (legacy docs may say `domain_id` / `domain_name` — same values).

---

## Table of contents

1. [Relationship diagram](#1-relationship-diagram)
2. [PostgreSQL tables & views](#2-postgresql-tables--views)
3. [ClickHouse dimensions](#3-clickhouse-dimensions)
4. [ClickHouse facts](#4-clickhouse-facts)
5. [ClickHouse aggregates & views](#5-clickhouse-aggregates--views)
6. [ClickHouse pipeline (internal)](#6-clickhouse-pipeline-internal)
7. [Dictionary & materialized views](#7-dictionary--materialized-views)
8. [Who queries what](#8-who-queries-what)
9. [DDL source files](#9-ddl-source-files)

---

## 1. Relationship diagram

ClickHouse does **not** enforce foreign keys. Joins use **logical keys** below.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ POSTGRESQL                                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  admin_accounts (PK: id, UK: website_id, email)                             │
│       │ website_id                                                          │
│       ▼                                                                     │
│  v_web_tracking_ingest_registry (VIEW — My Accounts)                        │
│       │ website_id, website_url, organization_id                            │
└───────┼─────────────────────────────────────────────────────────────────────┘
        │ reload every 15–60s
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLICKHOUSE dict_admin_accounts (PK: website_id) — ingest validation only    │
└───────┬─────────────────────────────────────────────────────────────────────┘
        │ valid ingest
        ▼
   raw_payloads ──mv_parse_events──► events_staging
        │                                    │
        │ mv_fact_replay_chunks              ├──► fact_page_views
        ▼                                    ├──► fact_interaction_events
   fact_replay_chunks                        ├──► fact_form_events
        │                                    ├──► fact_conversion_events
        │                                    ├──► fact_custom_events
        │ mv_dim_sessions                    ├──► fact_product_interactions
        ▼                                    ├──► fact_performance_events
   dim_sessions ◄── visitor_id, session_id ─├──► fact_error_events
        │                                    ├──► fact_cookie_operations
        │                                    ├──► fact_heap_snapshots
        ▼                                    ├──► mv_dim_visitors ──► dim_visitors
   dim_visitors                               └──► mv_dim_websites ──► dim_websites

   fact_* / dim_sessions ──mv_agg_*──► agg_web_daily | agg_page_daily | agg_product_daily

   fact_page_views + fact_interaction_events ──► agg_session_activity ──► v_session_bounce
```

### Join key cheat sheet

| Parent | Child | Join columns |
|--------|-------|--------------|
| `dim_visitors` | `dim_sessions` | `website_id`, `visitor_id` |
| `dim_sessions` | `fact_page_views` | `website_id`, `session_id` |
| `fact_page_views` | `fact_interaction_events` | `website_id`, `page_view_id` |
| `fact_page_views` | `fact_form_events` | `website_id`, `page_view_id` |
| `dim_sessions` | `fact_replay_chunks` | `website_id`, `session_id` |
| `dim_sessions` | `v_session_bounce` | `website_id`, `session_id` |
| `admin_accounts` / registry | All CH tables | `website_id` |
| Campaign (external) | `dim_sessions` | `wt_campaign_id`, `wt_contact_id`, `wt_organization_id` |

### Primary keys (grain / ORDER BY)

| Object | Primary / unique grain |
|--------|------------------------|
| `admin_accounts` | `id` (PK); `website_id` (unique) |
| `v_web_tracking_ingest_registry` | `website_id` (one row per slot) |
| `dict_admin_accounts` | `website_id` |
| `raw_payloads` | `website_id` + `payload_id` |
| `events_staging` | `website_id` + `event_ts` + `event_id` |
| `dim_websites` | `website_id` |
| `dim_visitors` | `website_id` + `visitor_id` |
| `dim_sessions` | `website_id` + `visitor_id` + `session_id` |
| `fact_page_views` | `website_id` + `created_at` + `page_view_id` |
| `fact_interaction_events` | `website_id` + `event_type` + `created_at` + `event_id` |
| `fact_form_events` | `website_id` + `event_type` + `created_at` + `event_id` |
| `fact_conversion_events` | `website_id` + `created_at` + `conversion_id` |
| `fact_custom_events` | `website_id` + `event_name` + `created_at` + `event_id` |
| `fact_product_interactions` | `website_id` + `product_id` + `created_at` + `interaction_id` |
| `fact_performance_events` | `website_id` + `metric_name` + `created_at` + `event_id` |
| `fact_error_events` | `website_id` + `error_type` + `created_at` + `event_id` |
| `fact_cookie_operations` | `website_id` + `cookie_name` + `created_at` + `event_id` |
| `fact_heap_snapshots` | `website_id` + `visitor_id` + `created_at` + `snapshot_id` |
| `fact_replay_chunks` | `website_id` + `session_id` + `chunk_index` |
| `agg_web_daily` | `website_id` + `event_date` |
| `agg_page_daily` | `website_id` + `page_path` + `event_date` |
| `agg_product_daily` | `website_id` + `product_id` + `event_date` |
| `agg_session_activity` | `website_id` + `session_id` |
| `v_session_bounce` | `website_id` + `session_id` (view) |

**ReplacingMergeTree tables** (`dim_*`): query with `FINAL` for deduplicated rows.

---

## 2. PostgreSQL tables & views

### 2.1 `admin_accounts`

| | |
|---|---|
| **Database** | `web_analytics` (Prisma / api-node) |
| **Retention** | Permanent |
| **Used by** | Dashboard login API; legacy site registry |
| **Why refer** | Authenticate dashboard users; map logged-in admin → `website_id` for API queries |

**Logical relationships:**

| Column | Relates to |
|--------|------------|
| `website_id` | ClickHouse `*.website_id` (all analytics tables) |
| `organization_id` | ClickHouse `organization_id` / `wt_organization_id` (when set) |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Surrogate primary key |
| `admin_name` | TEXT | Display name |
| `email` | TEXT | Login email (unique) |
| `password_hash` | TEXT | bcrypt hash |
| `website_id` | INTEGER | Tracked website id (unique) — tenant key for CH |
| `website_url` | TEXT | Registered site URL for ingest validation |
| `site_type` | TEXT | Site category for analytics behaviour |
| `status` | TEXT | Account/site status |
| `organization_id` | INTEGER (nullable) | Worktual org id stamped on ingest when set |
| `is_active` | BOOLEAN | Whether account can log in |
| `created_at` | TIMESTAMP | Row created |
| `updated_at` | TIMESTAMP | Last update |

#### Categorical values

| Column | Values |
|--------|--------|
| `site_type` | `blog` (default), `ecommerce` |
| `status` | `active` (default); other values possible per deployment |
| `is_active` | `true`, `false` |

#### Sample row

```json
{
  "id": 1,
  "admin_name": "Demo Admin",
  "email": "admin@worktual.co.uk",
  "password_hash": "$2b$...",
  "website_id": 12345,
  "website_url": "https://demo.example.com",
  "site_type": "ecommerce",
  "status": "active",
  "organization_id": 1003,
  "is_active": true,
  "created_at": "2026-01-15T10:00:00Z",
  "updated_at": "2026-08-20T14:30:00Z"
}
```

---

### 2.2 `v_web_tracking_ingest_registry` (VIEW)

| | |
|---|---|
| **Database** | `worktual_bigint` (My Accounts Postgres) |
| **Type** | View (not a physical table) |
| **Retention** | N/A — reflects live My Accounts config |
| **Used by** | ClickHouse `dict_admin_accounts` via `ch_sync` user |
| **Why refer** | **Authoritative list** of which `website_id` + URL may send ingest traffic; replaces legacy `admin_accounts` for production ingest |

**Source tables (external — My Accounts schema):**

- `accounts.subscriptions`
- `accounts.active_products`
- `accounts.product_go_live`
- JSON path: `config.visitorAllowanceBySlot` → slot key = `website_id`, value.url = `website_url`

#### Columns (view output)

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | INTEGER | Slot id from My Accounts JSON |
| `website_url` | TEXT | Registered URL (must match SDK `websiteUrl`) |
| `site_type` | TEXT | Fixed `ecommerce` in view |
| `status` | TEXT | Fixed `active` in view |
| `organization_id` | BIGINT | Org owning the subscription |
| `is_active` | BOOLEAN | Fixed `true` in view |

#### Categorical values

| Column | Values |
|--------|--------|
| `site_type` | `ecommerce` (hardcoded in view) |
| `status` | `active` (hardcoded in view) |
| `is_active` | `true` |

#### Sample row

```json
{
  "website_id": 1001,
  "website_url": "https://beta.worktual.co.uk/",
  "site_type": "ecommerce",
  "status": "active",
  "organization_id": 1003,
  "is_active": true
}
```

---

## 3. ClickHouse dimensions

Database: `web_tracking`. Query `dim_*` with **`FINAL`**.

---

### 3.1 `dim_websites`

| | |
|---|---|
| **Retention** | Permanent |
| **Used by** | Internal sync; site metadata mirror |
| **Why refer** | ClickHouse copy of site config seen in ingest; **authoritative registry** is Postgres view / dict |

**Logical FK:** `website_id` → `dict_admin_accounts.website_id`, `admin_accounts.website_id`

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Site id (tenant key) |
| `organization_id` | UInt32 | Org id (0 if unset) |
| `website_url` | String | Site URL |
| `site_type` | LowCardinality(String) | `blog`, `ecommerce`, etc. |
| `status` | LowCardinality(String) | Site status |
| `created_at` | DateTime64(3) UTC | First seen |
| `updated_at` | DateTime64(3) UTC | Last update (ReplacingMergeTree version) |

#### Categorical values

| Column | Values |
|--------|--------|
| `site_type` | `blog` (default), `ecommerce` |
| `status` | `active` (default) |

#### Sample row

```json
{
  "website_id": 1001,
  "organization_id": 1003,
  "website_url": "https://beta.worktual.co.uk/",
  "site_type": "ecommerce",
  "status": "active",
  "created_at": "2026-08-01T12:00:00.000Z",
  "updated_at": "2026-08-29T18:00:00.000Z"
}
```

---

### 3.2 `dim_visitors`

| | |
|---|---|
| **Retention** | Permanent |
| **Used by** | Visitors page, visitor detail, AI chat |
| **Why refer** | Lifetime visitor profile: first/last seen, totals, country |

**Logical FK:** `website_id` + `visitor_id` ← all `fact_*` and `dim_sessions`

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `visitor_id` | String | Anonymous id from SDK (`visitor_…`) |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org from ingest payload |
| `user_id` | String | Known user id after `identify()` |
| `anonymous_id` | String | Secondary anonymous id |
| `first_seen_at` | DateTime64(3) | First visit |
| `last_seen_at` | DateTime64(3) | Most recent activity |
| `total_sessions` | UInt32 | Lifetime session count |
| `total_pageviews` | UInt32 | Lifetime pageview count |
| `country` | LowCardinality(String) | ISO country code or name |
| `created_at` | DateTime64(3) | Row created |
| `updated_at` | DateTime64(3) | ReplacingMergeTree version |

#### Sample row

```json
{
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "website_id": 1001,
  "organization_id": 1003,
  "user_id": "",
  "anonymous_id": "anon_9f8e7d6c",
  "first_seen_at": "2026-08-20T09:15:00.000Z",
  "last_seen_at": "2026-08-29T17:45:00.000Z",
  "total_sessions": 4,
  "total_pageviews": 18,
  "country": "IN",
  "created_at": "2026-08-20T09:15:00.000Z",
  "updated_at": "2026-08-29T17:45:00.000Z"
}
```

---

### 3.3 `dim_sessions`

| | |
|---|---|
| **Retention** | 400 days (`started_at` TTL) |
| **Used by** | Dashboard, sessions, traffic sources, geography, bounce (legacy), AI chat |
| **Why refer** | **Main session-level analytics**: UTM, device, geo, entry/exit, campaign attribution |

**Logical FK:**

- `visitor_id` → `dim_visitors.visitor_id`
- `website_id` → tenant
- `wt_campaign_id`, `wt_contact_id` → Campaign product (external DB)

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | String | Session id from SDK |
| `visitor_id` | String | Parent visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org from payload |
| `user_id` | String | Identified user if any |
| `started_at` | DateTime64(3) | Session start |
| `ended_at` | Nullable(DateTime64(3)) | Session end if known |
| `duration_seconds` | UInt32 | Session length |
| `entry_page` | String | Landing path |
| `exit_page` | String | Last page path |
| `entry_url` | String | Full landing URL |
| `exit_url` | String | Full exit URL |
| `pageview_count` | UInt32 | Pages in session (may be stale — use `v_session_bounce`) |
| `is_bounce` | UInt8 | 0/1 bounce flag (may be stale — use `v_session_bounce`) |
| `referrer` | String | Referrer URL |
| `referrer_domain` | String | Referrer hostname |
| `utm_source` | LowCardinality(String) | Campaign source |
| `utm_medium` | LowCardinality(String) | Campaign medium |
| `utm_campaign` | String | Campaign name/id |
| `utm_term` | String | Paid keyword |
| `utm_content` | String | Ad variant |
| `wt_organization_id` | Nullable(UInt64) | Worktual campaign token org |
| `wt_campaign_id` | Nullable(UInt64) | Campaign DB id |
| `wt_contact_id` | Nullable(UInt64) | Contact/recipient id |
| `user_agent` | String | Browser UA string |
| `language` | LowCardinality(String) | Browser language |
| `platform` | LowCardinality(String) | OS |
| `browser` | LowCardinality(String) | Browser name |
| `browser_version` | String | Browser version |
| `device` | LowCardinality(String) | Device class |
| `screen_width` | UInt16 | Screen width px |
| `screen_height` | UInt16 | Screen height px |
| `country` | LowCardinality(String) | Geo country |
| `city` | String | Geo city |
| `region` | String | Geo region |
| `latitude` | Float64 | Geo lat |
| `longitude` | Float64 | Geo lon |
| `ip_hash` | String | Hashed IP |
| `geo_data` | String | Raw geo JSON |
| `sdk_version` | LowCardinality(String) | SDK version |
| `created_at` | DateTime64(3) | Row created |
| `updated_at` | DateTime64(3) | ReplacingMergeTree version |

#### Categorical values

| Column | Values |
|--------|--------|
| `is_bounce` | `0` = not bounce, `1` = bounce (prefer `v_session_bounce` for accurate bounce) |
| `device` | `desktop`, `mobile`, `tablet`, `""` (unknown) |
| `utm_medium` | Common: `email`, `cpc`, `organic`, `social`, `referral`, `""` |

#### Sample row

```json
{
  "session_id": "session_a1b2c3d4e5f6",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "website_id": 1001,
  "organization_id": 1003,
  "started_at": "2026-08-29T17:40:00.000Z",
  "duration_seconds": 245,
  "entry_page": "/book-demo/",
  "pageview_count": 3,
  "is_bounce": 0,
  "utm_source": "worktual_campaign",
  "utm_medium": "email",
  "utm_campaign": "10042",
  "wt_organization_id": 1003,
  "wt_campaign_id": 10042,
  "wt_contact_id": 55201,
  "browser": "Chrome",
  "device": "desktop",
  "country": "IN",
  "city": "Chennai",
  "referrer_domain": ""
}
```

---

## 4. ClickHouse facts

Always filter `website_id` and `created_at` (or relevant time column).

---

### 4.1 `fact_page_views`

| | |
|---|---|
| **Retention** | 180 days |
| **Used by** | Dashboard, top pages, journeys, AI chat |
| **Why refer** | One row per page load — core content analytics |

**Logical FK:** `session_id` → `dim_sessions`; `visitor_id` → `dim_visitors`; `page_view_id` → child facts

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `page_view_id` | String | Unique page load id |
| `session_id` | String | Parent session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `page_path` | String | URL path |
| `page_title` | String | Document title |
| `referrer` | String | Referrer for this view |
| `time_on_page_sec` | UInt32 | Time on page |
| `max_scroll_depth` | Float32 | Max scroll % (0–100) |
| `sdk_version` | LowCardinality(String) | SDK version |
| `device` | LowCardinality(String) | Device class |
| `country` | LowCardinality(String) | Country |
| `utm_source` | LowCardinality(String) | UTM at page level |
| `utm_medium` | LowCardinality(String) | UTM medium |
| `utm_campaign` | String | UTM campaign |
| `extra_data` | String | JSON extras |
| `created_at` | DateTime64(3) | Event time |

#### Sample row

```json
{
  "page_view_id": "pv_8a7b6c5d4e3f",
  "session_id": "session_a1b2c3d4e5f6",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "website_id": 1001,
  "organization_id": 1003,
  "page_path": "/pricing/",
  "page_title": "Pricing — Worktual",
  "time_on_page_sec": 42,
  "max_scroll_depth": 75.5,
  "country": "IN",
  "created_at": "2026-08-29T17:42:00.000Z"
}
```

---

### 4.2 `fact_interaction_events`

| | |
|---|---|
| **Retention** | 90 days |
| **Used by** | Behavior, heatmaps, visitor detail |
| **Why refer** | Clicks, scroll, rage/dead clicks — heatmap source |

**Logical FK:** `page_view_id` → `fact_page_views`; `session_id` → `dim_sessions`

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | String | Unique event id |
| `event_type` | LowCardinality(String) | Interaction type |
| `page_view_id` | String | Page context |
| `session_id` | String | Session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `x_coord` | Int32 | Click X (viewport) |
| `y_coord` | Int32 | Click Y |
| `element` | String | DOM selector / tag |
| `element_type` | LowCardinality(String) | HTML tag |
| `element_text` | String | Visible text (truncated) |
| `href` | String | Link href if any |
| `scroll_depth` | Float32 | Scroll milestone % |
| `velocity` | Int32 | Move velocity |
| `click_count` | UInt8 | Clicks in rage cluster |
| `reason` | LowCardinality(String) | Why fired (e.g. rage threshold) |
| `viewport_w` | UInt16 | Viewport width |
| `viewport_h` | UInt16 | Viewport height |
| `device` | LowCardinality(String) | Device |
| `country` | LowCardinality(String) | Country |
| `page_path` | String | Page path |
| `extra_data` | String | JSON extras |
| `created_at` | DateTime64(3) | Event time |

#### Categorical values — `event_type`

| Value | Meaning |
|-------|---------|
| `click` | Mouse click |
| `move` | Mouse movement sample |
| `scroll` | Scroll event |
| `scroll_depth` | Scroll depth milestone |
| `rage_click` | Repeated fast clicks same spot |
| `dead_click` | Click on non-interactive element |
| `hover` | Hover (if enabled in SDK) |

#### Sample row

```json
{
  "event_id": "evt_click_001",
  "event_type": "click",
  "page_view_id": "pv_8a7b6c5d4e3f",
  "session_id": "session_a1b2c3d4e5f6",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "website_id": 1001,
  "x_coord": 420,
  "y_coord": 680,
  "element": "button.cta-primary",
  "page_path": "/pricing/",
  "created_at": "2026-08-29T17:42:15.000Z"
}
```

---

### 4.3 `fact_form_events`

| | |
|---|---|
| **Retention** | 180 days |
| **Used by** | Forms analytics dashboard |
| **Why refer** | Form funnel: views, starts, submits, successes |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | String | Unique event id |
| `page_view_id` | String | Page containing form |
| `session_id` | String | Session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `event_type` | LowCardinality(String) | Form event name |
| `form_id` | String | Form identifier |
| `form_name` | String | Display name |
| `field_name` | String | Field name (for field events) |
| `field_value` | String | Field value (masked for sensitive) |
| `device` | LowCardinality(String) | Device |
| `country` | LowCardinality(String) | Country |
| `page_path` | String | Page path |
| `extra_data` | String | JSON (includes `fields` on submit) |
| `created_at` | DateTime64(3) | Event time |

#### Categorical values — `event_type`

| Value | Meaning |
|-------|---------|
| `form_view` | Form entered viewport |
| `form_start` | First interaction |
| `form_focus` | Field focused |
| `form_blur` | Field blurred |
| `form_change` | Field value changed |
| `form_validation` | HTML5 validation failed |
| `form_submit` | Submit attempted |
| `form_success` | Submit succeeded |
| `form_failure` | Submit failed |
| `form_abandon` | Left page with incomplete form |

#### Sample row

```json
{
  "event_id": "evt_form_001",
  "event_type": "form_submit",
  "form_id": "contact",
  "form_name": "Contact Us",
  "session_id": "session_a1b2c3d4e5f6",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "website_id": 1001,
  "page_path": "/contact/",
  "extra_data": "{\"fields\":{\"name\":\"Jane\",\"email\":\"jane@co.com\"}}",
  "created_at": "2026-08-29T17:43:00.000Z"
}
```

---

### 4.4 `fact_conversion_events`

| | |
|---|---|
| **Retention** | 400 days |
| **Used by** | Conversions, ROI, AI chat |
| **Why refer** | Goals: purchase, signup, login, checkout |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `conversion_id` | String | Unique conversion id |
| `page_view_id` | String | Page context |
| `session_id` | String | Session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `conversion_type` | LowCardinality(String) | Goal type |
| `product_id` | String | Product if applicable |
| `value` | Decimal(12,2) | Monetary value |
| `currency` | LowCardinality(String) | Currency code |
| `device` | LowCardinality(String) | Device |
| `country` | LowCardinality(String) | Country |
| `utm_source` | LowCardinality(String) | Attribution |
| `utm_campaign` | String | Campaign |
| `created_at` | DateTime64(3) | Event time |

#### Categorical values — `conversion_type`

| Value | Meaning |
|-------|---------|
| `purchase` | Order completed |
| `refund` | Refund |
| `signup` | New account |
| `login` | User logged in |
| `begin_checkout` | Checkout started |
| *(custom)* | Any string from SDK |

#### Categorical values — `currency`

| Value | Meaning |
|-------|---------|
| `USD` | Default |
| `GBP`, `EUR`, … | Per transaction |

#### Sample row

```json
{
  "conversion_id": "conv_001",
  "conversion_type": "purchase",
  "session_id": "session_a1b2c3d4e5f6",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "website_id": 1001,
  "product_id": "SKU-123",
  "value": 99.00,
  "currency": "GBP",
  "utm_source": "worktual_campaign",
  "created_at": "2026-08-29T17:44:00.000Z"
}
```

---

### 4.5 `fact_custom_events`

| | |
|---|---|
| **Retention** | 180 days |
| **Used by** | Custom events, session replay refs, AI chat |
| **Why refer** | `WorktualAnalytics.track('name', props)` — business-specific actions |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | String | Unique id |
| `page_view_id` | String | Page context |
| `session_id` | String | Session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `event_name` | LowCardinality(String) | Custom event name |
| `event_data` | String | JSON properties |
| `device` | LowCardinality(String) | Device |
| `country` | LowCardinality(String) | Country |
| `created_at` | DateTime64(3) | Event time |

#### Sample row

```json
{
  "event_id": "evt_custom_001",
  "event_name": "demo_requested",
  "session_id": "session_a1b2c3d4e5f6",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "website_id": 1001,
  "event_data": "{\"plan\":\"enterprise\"}",
  "created_at": "2026-08-29T17:44:30.000Z"
}
```

---

### 4.6 `fact_product_interactions`

| | |
|---|---|
| **Retention** | 180 days |
| **Used by** | E-commerce product analytics |
| **Why refer** | Product views, clicks, impressions |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `interaction_id` | String | Unique id |
| `page_view_id` | String | Page context |
| `session_id` | String | Session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `product_id` | String | Product id |
| `product_name` | String | Product name |
| `product_category` | LowCardinality(String) | Category |
| `product_price` | Decimal(12,2) | Price |
| `currency` | LowCardinality(String) | Currency |
| `product_sku` | String | SKU |
| `product_brand` | String | Brand |
| `section` | LowCardinality(String) | Listing section |
| `scroll_depth` | Float32 | Scroll on product page |
| `time_on_page_sec` | UInt32 | Time on page |
| `device` | LowCardinality(String) | Device |
| `country` | LowCardinality(String) | Country |
| `extra_data` | String | JSON extras |
| `created_at` | DateTime64(3) | Event time |

#### Sample row

```json
{
  "interaction_id": "prod_int_001",
  "product_id": "SKU-123",
  "product_name": "LUKAS Widget",
  "product_price": 49.99,
  "currency": "GBP",
  "session_id": "session_a1b2c3d4e5f6",
  "website_id": 1001,
  "section": "featured",
  "created_at": "2026-08-29T17:41:00.000Z"
}
```

---

### 4.7 `fact_performance_events`

| | |
|---|---|
| **Retention** | 90 days |
| **Used by** | Performance page |
| **Why refer** | Core Web Vitals and navigation timing |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | String | Unique id |
| `page_view_id` | String | Page measured |
| `session_id` | String | Session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `metric_name` | LowCardinality(String) | Metric id |
| `metric_value` | Float64 | Value (ms or score) |
| `rating` | LowCardinality(String) | good / needs-improvement / poor |
| `page_path` | String | Page path |
| `device` | LowCardinality(String) | Device |
| `extra_data` | String | JSON extras |
| `created_at` | DateTime64(3) | Event time |

#### Categorical values — `metric_name`

| Value | Meaning |
|-------|---------|
| `LCP` | Largest Contentful Paint |
| `FCP` | First Contentful Paint |
| `CLS` | Cumulative Layout Shift |
| `INP` | Interaction to Next Paint |
| `TTFB` | Time to First Byte |
| `FID` | First Input Delay (legacy) |
| `performance_navigation` | Combined navigation timing |

#### Categorical values — `rating`

| Value | Meaning |
|-------|---------|
| `good` | Within threshold |
| `needs-improvement` | Middle tier |
| `poor` | Below threshold |
| `""` | Not rated |

#### Sample row

```json
{
  "event_id": "perf_001",
  "metric_name": "LCP",
  "metric_value": 2100.5,
  "rating": "good",
  "page_path": "/",
  "session_id": "session_a1b2c3d4e5f6",
  "website_id": 1001,
  "created_at": "2026-08-29T17:40:05.000Z"
}
```

---

### 4.8 `fact_error_events`

| | |
|---|---|
| **Retention** | 90 days |
| **Used by** | Errors page |
| **Why refer** | Front-end JavaScript errors |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | String | Unique id |
| `page_view_id` | String | Page context |
| `session_id` | String | Session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `error_type` | LowCardinality(String) | Error class |
| `message` | String | Error message |
| `stack` | String | Stack trace |
| `page_path` | String | Page path |
| `device` | LowCardinality(String) | Device |
| `browser` | LowCardinality(String) | Browser |
| `extra_data` | String | JSON extras |
| `created_at` | DateTime64(3) | Event time |

#### Categorical values — `error_type`

| Value | Meaning |
|-------|---------|
| `javascript` | Uncaught JS error |
| `unhandledrejection` | Promise rejection |
| `resource` | Failed resource load |
| *(SDK-defined)* | Other types |

#### Sample row

```json
{
  "event_id": "err_001",
  "error_type": "javascript",
  "message": "Cannot read properties of undefined",
  "page_path": "/checkout/",
  "session_id": "session_a1b2c3d4e5f6",
  "website_id": 1001,
  "browser": "Chrome",
  "created_at": "2026-08-29T17:45:00.000Z"
}
```

---

### 4.9 `fact_cookie_operations`

| | |
|---|---|
| **Retention** | 60 days |
| **Used by** | Not in dashboard (future compliance) |
| **Why refer** | Cookie consent audit trail |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | String | Unique id |
| `session_id` | String | Session |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `action` | LowCardinality(String) | Operation type |
| `cookie_name` | String | Cookie name |
| `cookie_value` | String | Value (may truncate) |
| `expiry_days` | Int32 | Expiry |
| `page_path` | String | Page path |
| `created_at` | DateTime64(3) | Event time |

#### Categorical values — `action`

| Value | Meaning |
|-------|---------|
| `set` | Cookie written |
| `delete` | Cookie removed |
| `read` | Cookie read |
| `consent_granted` | User accepted |
| `consent_denied` | User rejected |

#### Sample row

```json
{
  "event_id": "cookie_001",
  "action": "consent_granted",
  "cookie_name": "wt_visitor_id",
  "session_id": "session_a1b2c3d4e5f6",
  "website_id": 1001,
  "created_at": "2026-08-29T17:40:02.000Z"
}
```

---

### 4.10 `fact_heap_snapshots`

| | |
|---|---|
| **Retention** | 30 days |
| **Used by** | Debug only |
| **Why refer** | Browser memory diagnostics |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_id` | String | Unique id |
| `visitor_id` | String | Visitor |
| `website_id` | UInt32 | Tenant |
| `page_path` | String | Page |
| `used_heap_bytes` | UInt64 | Used heap |
| `total_heap_bytes` | UInt64 | Total heap |
| `heap_limit_bytes` | UInt64 | Limit |
| `used_percentage` | Float32 | Used % |
| `browser` | LowCardinality(String) | Browser |
| `summary_data` | String | JSON summary |
| `created_at` | DateTime64(3) | Snapshot time |

#### Sample row

```json
{
  "snapshot_id": "heap_001",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "website_id": 1001,
  "page_path": "/",
  "used_heap_bytes": 45000000,
  "total_heap_bytes": 67000000,
  "used_percentage": 67.2,
  "created_at": "2026-08-29T17:40:10.000Z"
}
```

---

### 4.11 `fact_replay_chunks`

| | |
|---|---|
| **Retention** | 30 days |
| **Used by** | Session replay player |
| **Why refer** | Compressed rrweb recording chunks per session |

**Logical FK:** `session_id` → `dim_sessions`; `page_view_id` → `fact_page_views`

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `chunk_id` | UUID | Chunk id |
| `website_id` | UInt32 | Tenant |
| `organization_id` | Nullable(UInt32) | Org |
| `visitor_id` | String | Visitor |
| `session_id` | String | Session |
| `page_view_id` | String | Page |
| `chunk_index` | UInt32 | Order in session |
| `encoding` | LowCardinality(String) | Compression |
| `events_data` | String | gzip+base64 rrweb events |
| `event_count` | UInt32 | Events in chunk |
| `source` | LowCardinality(String) | Recorder library |
| `created_at` | DateTime64(3) | Received time |

#### Categorical values

| Column | Values |
|--------|--------|
| `encoding` | `gzip_b64` (default) |
| `source` | `rrweb` (default) |
| `payload_type` (in raw_payloads) | `replay_chunk_v1` |

#### Sample row

```json
{
  "chunk_id": "550e8400-e29b-41d4-a716-446655440000",
  "website_id": 1001,
  "organization_id": 1003,
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "session_id": "session_a1b2c3d4e5f6",
  "page_view_id": "pv_8a7b6c5d4e3f",
  "chunk_index": 0,
  "encoding": "gzip_b64",
  "event_count": 30,
  "source": "rrweb",
  "events_data": "H4sIAAAAAAAA...",
  "created_at": "2026-08-29T17:40:20.000Z"
}
```

---

## 5. ClickHouse aggregates & views

Use `*Merge()` functions on `*_state` columns in `agg_*` tables.

---

### 5.1 `agg_web_daily`

| | |
|---|---|
| **Retention** | 3 years |
| **Used by** | Long-term trends, AI chat |
| **Why refer** | Pre-rolled daily site KPIs — faster than scanning facts |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `event_date` | Date | Day |
| `visitors_state` | AggregateFunction(uniqExact, String) | Unique visitors |
| `sessions_state` | AggregateFunction(uniqExact, String) | Unique sessions |
| `pageviews_state` | AggregateFunction(count) | Pageview count |
| `clicks_state` | AggregateFunction(count) | Click count |
| `rage_clicks_state` | AggregateFunction(count) | Rage clicks |
| `dead_clicks_state` | AggregateFunction(count) | Dead clicks |
| `conversions_state` | AggregateFunction(count) | Conversions |
| `conversion_value_state` | AggregateFunction(sum, Decimal) | Revenue sum |
| `session_duration_state` | AggregateFunction(avg, Float64) | Avg session duration |
| `scroll_depth_state` | AggregateFunction(avg, Float32) | Avg scroll depth |
| `bounce_cnt_state` | AggregateFunction(sum, UInt64) | Bounce count (legacy) |
| `session_cnt_state` | AggregateFunction(sum, UInt64) | Session count |

#### Sample query result (after merge)

```json
{
  "website_id": 1001,
  "event_date": "2026-08-29",
  "visitors": 31,
  "sessions": 52,
  "pageviews": 148,
  "clicks": 320,
  "conversions": 3
}
```

---

### 5.2 `agg_page_daily`

| | |
|---|---|
| **Retention** | 2 years |
| **Why refer** | Daily metrics per page path |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `page_path` | String | Page path |
| `event_date` | Date | Day |
| `views_state` | AggregateFunction(count) | Page views |
| `visitors_state` | AggregateFunction(uniqExact, String) | Unique visitors |
| `time_on_page_state` | AggregateFunction(avg, Float64) | Avg time on page |
| `scroll_depth_state` | AggregateFunction(avg, Float32) | Avg scroll |
| `rage_clicks_state` | AggregateFunction(count) | Rage clicks |
| `dead_clicks_state` | AggregateFunction(count) | Dead clicks |

#### Sample merged row

```json
{
  "website_id": 1001,
  "page_path": "/pricing/",
  "event_date": "2026-08-29",
  "views": 24,
  "visitors": 18,
  "avg_time_on_page_sec": 38.5
}
```

---

### 5.3 `agg_product_daily`

| | |
|---|---|
| **Retention** | 2 years |
| **Why refer** | Daily e-commerce product metrics |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `product_id` | String | Product |
| `event_date` | Date | Day |
| `clicks_state` | AggregateFunction(count) | Product clicks |
| `visitors_state` | AggregateFunction(uniqExact, String) | Unique visitors |
| `conversions_state` | AggregateFunction(count) | Conversions |
| `price_state` | AggregateFunction(avg, Decimal) | Avg price |

#### Sample merged row

```json
{
  "website_id": 1001,
  "product_id": "SKU-123",
  "event_date": "2026-08-29",
  "clicks": 12,
  "visitors": 9,
  "conversions": 2
}
```

---

### 5.4 `agg_session_activity` (pipeline support)

| | |
|---|---|
| **Retention** | No TTL (aggregating states) |
| **Queryable** | Via `v_session_bounce` only |
| **Why refer** | Intermediate states for correct bounce calculation |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `session_id` | String | Session |
| `pageviews_state` | AggregateFunction(count) | Pageview count |
| `activity_min_state` | AggregateFunction(min, DateTime64) | First activity ts |
| `activity_max_state` | AggregateFunction(max, DateTime64) | Last activity ts |

---

### 5.5 `v_session_bounce` (VIEW)

| | |
|---|---|
| **Availability** | Local DDL (`11_session_bounce_metrics.sql`); optional on live |
| **Used by** | api-node bounce queries (when deployed) |
| **Why refer** | **Correct bounce rate** — 1 pageview AND duration &lt; 10 seconds |

#### Output columns

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `session_id` | String | Session |
| `pageview_count` | UInt64 | Pages in session |
| `duration_seconds` | UInt32 | Activity span |
| `is_bounce` | UInt8 | 0/1 |
| `session_started_at` | DateTime64(3) | First activity |

#### Bounce rule

| Condition | `is_bounce` |
|-----------|-------------|
| `pageview_count = 1` AND `duration_seconds < 10` | `1` |
| Otherwise | `0` |

#### Sample row

```json
{
  "website_id": 1001,
  "session_id": "session_a1b2c3d4e5f6",
  "pageview_count": 1,
  "duration_seconds": 4,
  "is_bounce": 1,
  "session_started_at": "2026-08-29T17:40:00.000Z"
}
```

---

## 6. ClickHouse pipeline (internal)

**Do not query in dashboards.** Listed for debugging and understanding data flow.

---

### 6.1 `raw_payloads`

| | |
|---|---|
| **Retention** | 90 days |
| **Why refer** | Source of truth for ingest — full SDK JSON per HTTP POST |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `payload_id` | UUID | Dedup key per batch |
| `website_id` | UInt32 | Tenant |
| `website_url` | String | URL from payload |
| `visitor_id` | String | Visitor |
| `payload_type` | LowCardinality(String) | Batch type |
| `source_ip` | String | Client IP |
| `user_agent` | String | UA |
| `received_at` | DateTime64(3) | Ingest time |
| `payload` | String | Full JSON body |
| `processing_status` | LowCardinality(String) | Pipeline status |
| `processed_at` | Nullable(DateTime64(3)) | When processed |
| `retry_count` | UInt16 | Retries |
| `error_message` | String | Error if failed |
| `ingested_at` | DateTime64(3) | Row version |

#### Categorical values — `payload_type`

| Value | Meaning |
|-------|---------|
| `events_v3` | Standard event batch (default) |
| `replay_chunk_v1` | Session replay chunk |

#### Categorical values — `processing_status`

| Value | Meaning |
|-------|---------|
| `accepted` | Default on insert |

#### Sample row

```json
{
  "payload_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "website_id": 1001,
  "website_url": "https://beta.worktual.co.uk/",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "payload_type": "events_v3",
  "received_at": "2026-08-29T17:40:00.000Z",
  "processing_status": "accepted",
  "payload": "{\"events\":[...],\"profiles\":{...}}"
}
```

---

### 6.2 `events_staging`

| | |
|---|---|
| **Retention** | No TTL (recommend 90 days) |
| **Why refer** | Parsed events — one row per event from batch JSON |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `payload_id` | UUID | Parent batch |
| `website_id` | UInt32 | Tenant |
| `website_url` | String | Site URL |
| `visitor_id` | String | Visitor |
| `session_id` | String | Session |
| `event_id` | String | Event id |
| `event_name` | LowCardinality(String) | SDK event name |
| `event_ts` | DateTime64(3) | Event timestamp |
| `page_view_id` | String | Page id |
| `props_json` | String | Event properties JSON |
| `profiles_json` | String | Batch profiles JSON |
| `payload_type` | LowCardinality(String) | Batch type |
| `received_at` | DateTime64(3) | Ingest time |
| `country` | LowCardinality(String) | Geo |
| `sdk_version` | LowCardinality(String) | SDK version |
| `organization_id` | Nullable(UInt32) | Org |

#### Sample row

```json
{
  "payload_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "website_id": 1001,
  "event_id": "evt_001",
  "event_name": "page_view",
  "session_id": "session_a1b2c3d4e5f6",
  "visitor_id": "visitor_5d1b2300a1b2c3d4",
  "event_ts": "2026-08-29T17:40:00.000Z",
  "organization_id": 1003
}
```

---

## 7. Dictionary & materialized views

### 7.1 `dict_admin_accounts` (dictionary)

| | |
|---|---|
| **Type** | ClickHouse dictionary (not a table) |
| **Source** | PostgreSQL `v_web_tracking_ingest_registry` |
| **Reload** | Every 15–60 seconds |
| **PK** | `website_id` |
| **Used by** | Ingest validation (`dictGet`) |

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Site id |
| `website_url` | String | Registered URL |
| `site_type` | String | Site type |
| `status` | String | Status |
| `organization_id` | Int64 | Org id |
| `is_active` | Bool | Active flag |

---

### 7.2 Materialized views (pipeline)

| View | Reads from | Writes to |
|------|------------|-----------|
| `mv_parse_events` | `raw_payloads` | `events_staging` |
| `mv_fact_page_views` | `events_staging` | `fact_page_views` |
| `mv_fact_interactions` | `events_staging` | `fact_interaction_events` |
| `mv_fact_form_events` | `events_staging` | `fact_form_events` |
| `mv_fact_performance` | `events_staging` | `fact_performance_events` |
| `mv_fact_errors` | `events_staging` | `fact_error_events` |
| `mv_fact_product` | `events_staging` | `fact_product_interactions` |
| `mv_fact_conversions` | `events_staging` | `fact_conversion_events` |
| `mv_fact_custom` | `events_staging` | `fact_custom_events` |
| `mv_dim_visitors` | `events_staging` | `dim_visitors` |
| `mv_dim_sessions` | `raw_payloads` | `dim_sessions` |
| `mv_dim_websites` | `raw_payloads` | `dim_websites` |
| `mv_fact_replay_chunks` | `raw_payloads` | `fact_replay_chunks` |
| `mv_agg_web_daily_*` | facts / dim_sessions | `agg_web_daily` |
| `mv_agg_page_daily` | `fact_page_views` | `agg_page_daily` |
| `mv_agg_product_daily` | `fact_product_interactions` | `agg_product_daily` |
| `mv_agg_session_activity_*` | facts | `agg_session_activity` |

---

## 8. Who queries what

| Consumer | Tables |
|----------|--------|
| **Dashboard API (api-node)** | `dim_visitors FINAL`, `dim_sessions FINAL`, `fact_*`, `agg_*`, `v_session_bounce` |
| **AI Chat** | Same as dashboard (`AI_CHAT/app/schema/registry.py`) |
| **Ingest (Python/Node)** | `dict_admin_accounts` / Postgres registry |
| **Campaign (future join)** | `dim_sessions.wt_campaign_id`, `wt_contact_id` |
| **Pipeline** | `raw_payloads`, `events_staging`, `mv_*` (automatic) |

### Time filter cheat sheet

| Question | Table | Filter column |
|----------|-------|---------------|
| Sessions this week | `dim_sessions FINAL` | `started_at` |
| Page views today | `fact_page_views` | `created_at` |
| Clicks / heatmap | `fact_interaction_events` | `created_at` |
| Daily trend (1 year) | `agg_web_daily` | `event_date` |
| Visitor lifetime | `dim_visitors FINAL` | `first_seen_at` / `last_seen_at` |
| Correct bounce rate | `v_session_bounce` | `session_started_at` |

### Data flow

```
SDK → Ingest API → raw_payloads → events_staging → fact_* / dim_*
                                              → dim_sessions
                                              → agg_* (daily)
                                                      ↓
                                            Dashboard + AI Chat
```

---

## 9. DDL source files

| File | Contents |
|------|----------|
| `clickhouse/ddl/01_bronze.sql` | `raw_payloads` |
| `clickhouse/ddl/02_auth_and_dim.sql` | `dim_websites`, `dim_visitors`, `dim_sessions` |
| `clickhouse/ddl/02b_dict_admin_accounts.sql` | Dictionary |
| `clickhouse/ddl/03_silver_facts.sql` | All `fact_*` (except replay) |
| `clickhouse/ddl/04_gold_aggs.sql` | `agg_*` + agg MVs |
| `clickhouse/ddl/05_materialized_views_pipeline.sql` | `events_staging`, fact/dim MVs |
| `clickhouse/ddl/07_replay_chunks.sql` | `fact_replay_chunks` |
| `clickhouse/ddl/10_session_campaign_attribution.sql` | `wt_*` columns on `dim_sessions` |
| `clickhouse/ddl/11_session_bounce_metrics.sql` | `agg_session_activity`, `v_session_bounce` |
| `postgres/ddl/10_v_web_tracking_ingest_registry.sql` | Ingest registry view |
| `api-node/prisma/schema.prisma` | `admin_accounts` |

Apply ClickHouse: `python scripts/apply_clickhouse_ddl.py`

---

## Related docs

| Document | Topic |
|----------|-------|
| `docs/DATABASE_TABLES_RETENTION.md` | Retention summary (partial) |
| `docs/CLICKHOUSE_CDP_REFERENCE.md` | Column reference |
| `docs/CDP_PAYLOAD_FIELD_REFERENCE.md` | SDK payload JSON |
| `docs/CDP_EVENTS_CATALOG.md` | Event names → tables |
| `docs/CAMPAIGN_TRACK_LINK_SPEC.md` | Campaign link → `wt_*` columns |

---

*Generated for Worktual Web Tracking — complete table reference v1.0*
