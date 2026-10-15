# Web Tracking — ClickHouse Full Database Schema

**Database:** `web_tracking`  
**Product:** Worktual Web Tracking  
**Version:** 1.0  
**Last updated:** 2026-09-19  
**Source of truth:** `clickhouse/ddl/*.sql`

Complete schema reference for the Web Tracking ClickHouse database — all tables, views, dictionary, engines, keys, TTLs, and column definitions.

**Related docs:**

- [WEB_TRACKING_SEMANTIC_LAYER_DATABASE.md](./WEB_TRACKING_SEMANTIC_LAYER_DATABASE.md) — semantic layer column purposes & enums
- [DATABASE_TABLES_COMPLETE.md](./DATABASE_TABLES_COMPLETE.md) — engineering reference with samples & relationships
- [CDP_EVENTS_CATALOG.md](./CDP_EVENTS_CATALOG.md) — SDK event → table routing

---

## Table of contents

1. [Database overview](#1-database-overview)
2. [Schema layers](#2-schema-layers)
3. [Bronze — ingest](#3-bronze--ingest)
4. [Pipeline staging](#4-pipeline-staging)
5. [Dimensions (silver)](#5-dimensions-silver)
6. [Facts (silver)](#6-facts-silver)
7. [Aggregates (gold)](#7-aggregates-gold)
8. [Views](#8-views)
9. [Dictionary](#9-dictionary)
10. [Session replay tables](#10-session-replay-tables)
11. [Optional / migration objects](#11-optional--migration-objects)
12. [Materialized views catalog](#12-materialized-views-catalog)
13. [Join key reference](#13-join-key-reference)
14. [Categorical value index](#14-categorical-value-index)
15. [DDL file map](#15-ddl-file-map)

---

## 1. Database overview

```sql
CREATE DATABASE IF NOT EXISTS web_tracking
COMMENT 'Web analytics CDP — bronze/silver/gold in single database';
```

| Property | Value |
|----------|-------|
| **Engine** | ClickHouse |
| **Database name** | `web_tracking` |
| **Tenant key** | `website_id` (UInt32) — required on every analytics query |
| **Org key** | `organization_id` (Nullable UInt32) — from ingest payload when set |
| **Timestamps** | `DateTime64(3, 'UTC')` unless noted |
| **Legacy naming** | `domain_id` / `domainName` in old SDK docs = `website_id` / `website_url` |

### Object counts

| Type | Count |
|------|-------|
| Tables | 25 (+ 3 migration temp tables) |
| Views | 2 |
| Dictionary | 1 |
| Materialized views | 22+ |

---

## 2. Schema layers

```
SDK / Ingest API
       │
       ▼
┌────────────────── BRONZE ──────────────────┐
│  raw_payloads                               │
└──────────────────┬─────────────────────────┘
                   │ mv_parse_events
                   ▼
┌────────────────── STAGING ─────────────────┐
│  events_staging                             │
└──────────────────┬─────────────────────────┘
                   │ mv_fact_* / mv_dim_*
       ┌───────────┼───────────┐
       ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ dim_*    │ │ fact_*   │ │ agg_*    │
│ (silver) │ │ (silver) │ │ (gold)   │
└──────────┘ └──────────┘ └──────────┘
       │           │           │
       └───────────┴───────────┘
                   │
       ┌───────────┴───────────┐
       ▼                       ▼
 v_session_bounce          ecommerce
     (view)                  (view)
                   │
                   ▼
         Dashboard API + AI Chat
```

---

## 3. Bronze — ingest

### 3.1 `raw_payloads`

Stores the full JSON body of every ingest HTTP POST. Bronze audit layer — one row per batch.

| Property | Value |
|----------|-------|
| **Engine** | `ReplacingMergeTree(ingested_at)` |
| **ORDER BY** | `(website_id, payload_id)` |
| **PARTITION BY** | `toYYYYMM(received_at)` |
| **TTL** | `received_at + 90 DAY` |
| **Grain** | One row per ingest batch (`payload_id`) |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `payload_id` | UUID | — | Deduplication key for the HTTP batch |
| `website_id` | UInt32 | — | Tenant / tracked site id |
| `website_url` | String | — | Site URL from payload |
| `visitor_id` | String | — | Visitor id from payload |
| `payload_type` | LowCardinality(String) | — | Batch type discriminator |
| `source_ip` | String | — | Client IP at ingest |
| `user_agent` | String | — | Browser user-agent at ingest |
| `received_at` | DateTime64(3, 'UTC') | — | When batch was received |
| `payload` | String | — | Full JSON body (events_v3 or replay) |
| `processing_status` | LowCardinality(String) | `'accepted'` | Pipeline processing status |
| `ingested_at` | DateTime64(3, 'UTC') | `now64(3)` | ReplacingMergeTree version column |

**Enums — `payload_type`:** `events_v3`, `replay_chunk_v1`  
**Enums — `processing_status`:** `accepted`

---

## 4. Pipeline staging

### 4.1 `events_staging`

Parsed events — one row per event exploded from `raw_payloads.events[]`.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, event_ts, event_id)` |
| **PARTITION BY** | `toYYYYMM(received_at)` |
| **TTL** | None in base DDL (recommend 90 days operationally) |
| **Grain** | One row per SDK event |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `payload_id` | UUID | — | Parent batch id |
| `website_id` | UInt32 | — | Tenant |
| `website_url` | String | — | Site URL |
| `visitor_id` | String | — | Visitor |
| `session_id` | String | — | Session |
| `event_id` | String | — | Unique event id |
| `event_name` | LowCardinality(String) | — | SDK event name (may be transformed, e.g. `scroll_milestone` → `scroll_depth`) |
| `event_ts` | DateTime64(3, 'UTC') | — | Event timestamp from SDK |
| `page_view_id` | String | `''` | Page id (`pid` or `pageViewId`) |
| `props_json` | String | `'{}'` | Event properties JSON |
| `profiles_json` | String | `'{}'` | Batch profiles JSON (browser, session, campaign, pages) |
| `payload_type` | LowCardinality(String) | `'events_v3'` | Parent batch type |
| `received_at` | DateTime64(3, 'UTC') | — | Ingest receive time |
| `country` | LowCardinality(String) | `''` | Geo country from `_geo` |
| `sdk_version` | LowCardinality(String) | `''` | SDK version |
| `organization_id` | Nullable(UInt32) | — | Organization from payload |

---

## 5. Dimensions (silver)

Query all `ReplacingMergeTree` dimension tables with **`FINAL`**.

### 5.1 `dim_websites`

Site registration metadata mirror in ClickHouse.

| Property | Value |
|----------|-------|
| **Engine** | `ReplacingMergeTree(updated_at)` |
| **ORDER BY** | `(website_id)` |
| **PARTITION BY** | None |
| **TTL** | None |
| **Grain** | One row per `website_id` |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `website_id` | UInt32 | — | Primary tenant key |
| `organization_id` | UInt32 | `0` | Owning organization |
| `website_url` | String | — | Registered site URL |
| `site_type` | LowCardinality(String) | `'blog'` | Site category |
| `status` | LowCardinality(String) | `'active'` | Site status |
| `created_at` | DateTime64(3, 'UTC') | `now64(3)` | Row created |
| `updated_at` | DateTime64(3, 'UTC') | `now64(3)` | Version column |

**Enums — `site_type`:** `blog`, `ecommerce`  
**Enums — `status`:** `active`

---

### 5.2 `dim_visitors`

Lifetime visitor profile — one row per browser visitor per site.

| Property | Value |
|----------|-------|
| **Engine** | `ReplacingMergeTree(updated_at)` |
| **ORDER BY** | `(website_id, visitor_id)` |
| **PARTITION BY** | None |
| **TTL** | None |
| **Grain** | One row per `(website_id, visitor_id)` |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `visitor_id` | String | — | SDK visitor id (`visitor_<uuid>`) |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization from ingest |
| `user_id` | String | `''` | Known user id after identify |
| `anonymous_id` | String | `''` | Secondary anonymous id |
| `first_seen_at` | DateTime64(3, 'UTC') | — | First activity timestamp |
| `last_seen_at` | DateTime64(3, 'UTC') | — | Most recent activity |
| `total_sessions` | UInt32 | `0` | **Often stale (0)** — aggregate from `dim_sessions` |
| `total_pageviews` | UInt32 | `0` | **Often stale (0)** — aggregate from `fact_page_views` |
| `country` | LowCardinality(String) | `''` | Last-known country on profile |
| `created_at` | DateTime64(3, 'UTC') | `now64(3)` | Row created |
| `updated_at` | DateTime64(3, 'UTC') | `now64(3)` | Version column |

---

### 5.3 `dim_sessions`

Browsing session with traffic source, device, geo, and campaign attribution.

| Property | Value |
|----------|-------|
| **Engine** | `ReplacingMergeTree(updated_at)` |
| **ORDER BY** | `(website_id, visitor_id, session_id)` |
| **PARTITION BY** | `toYYYYMM(started_at)` |
| **TTL** | `started_at + 400 DAY` |
| **Grain** | One row per `(website_id, visitor_id, session_id)` |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `session_id` | String | — | SDK session id |
| `visitor_id` | String | — | Parent visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization from ingest |
| `user_id` | String | `''` | Identified user id if any |
| `started_at` | DateTime64(3, 'UTC') | — | Session start — primary time filter |
| `ended_at` | Nullable(DateTime64(3, 'UTC')) | — | Session end if detected |
| `duration_seconds` | UInt32 | `0` | Session length — may be batch-scoped |
| `entry_page` | String | `''` | Landing page path |
| `exit_page` | String | `''` | **Not populated** — always empty in MV |
| `entry_url` | String | `''` | Full landing URL |
| `exit_url` | String | `''` | **Not populated** |
| `pageview_count` | UInt32 | `0` | **Stale** — use `v_session_bounce.pageview_count` |
| `is_bounce` | UInt8 | `0` | **Stale** — use `v_session_bounce.is_bounce` |
| `referrer` | String | `''` | Full HTTP referrer URL |
| `referrer_domain` | String | `''` | Referrer hostname |
| `utm_source` | LowCardinality(String) | `''` | UTM source |
| `utm_medium` | LowCardinality(String) | `''` | UTM medium |
| `utm_campaign` | String | `''` | UTM campaign |
| `utm_term` | String | `''` | **Not populated** in current MV |
| `utm_content` | String | `''` | **Not populated** in current MV |
| `wt_organization_id` | Nullable(UInt64) | — | Worktual campaign token org id |
| `wt_campaign_id` | Nullable(UInt64) | — | Worktual Campaign id |
| `wt_contact_id` | Nullable(UInt64) | — | Campaign contact/recipient id |
| `user_agent` | String | `''` | Raw user-agent |
| `language` | LowCardinality(String) | `''` | Browser language |
| `platform` | LowCardinality(String) | `''` | Operating system |
| `browser` | LowCardinality(String) | `''` | Browser name |
| `browser_version` | String | `''` | Browser version |
| `device` | LowCardinality(String) | `''` | Device class |
| `screen_width` | UInt16 | `0` | Screen width px |
| `screen_height` | UInt16 | `0` | Screen height px |
| `country` | LowCardinality(String) | `''` | Geo country |
| `city` | String | `''` | Geo city |
| `region` | String | `''` | Geo region/state |
| `latitude` | Float64 | `0` | Geo latitude |
| `longitude` | Float64 | `0` | Geo longitude |
| `ip_hash` | String | `''` | Hashed client IP |
| `geo_data` | String | `''` | Raw geo JSON |
| `sdk_version` | LowCardinality(String) | `''` | SDK version |
| `created_at` | DateTime64(3, 'UTC') | `now64(3)` | Row created |
| `updated_at` | DateTime64(3, 'UTC') | `now64(3)` | Version column — used for online visitors |

**Enums — `device`:** `desktop`, `mobile`, `tablet`, `""`  
**Enums — `is_bounce`:** `0`, `1` (stale — do not use for bounce rate)

---

### 5.4 `dim_known_users`

Maps `visitor_id` ↔ authenticated `user_id` with identity traits.

| Property | Value |
|----------|-------|
| **Engine** | `ReplacingMergeTree(updated_at)` |
| **ORDER BY** | `(website_id, user_id, visitor_id)` |
| **PARTITION BY** | None |
| **TTL** | None |
| **Grain** | One row per `(website_id, user_id, visitor_id)` mapping |
| **Refresh** | `mv_dim_known_users` — REFRESH EVERY 1 MINUTE |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `user_id` | String | — | Authenticated user id |
| `visitor_id` | String | — | Linked browser visitor id |
| `email` | String | `''` | Email from traits |
| `phone` | String | `''` | Phone from traits |
| `first_name` | String | `''` | First name |
| `last_name` | String | `''` | Last name |
| `method` | LowCardinality(String) | `''` | Auth method |
| `last_event_type` | LowCardinality(String) | `''` | Latest identity event |
| `traits_json` | String | `''` | Full traits JSON |
| `first_identified_at` | DateTime64(3, 'UTC') | — | First identity link |
| `last_identified_at` | DateTime64(3, 'UTC') | — | Latest identity event |
| `updated_at` | DateTime64(3, 'UTC') | — | Version column |

**Enums — `last_event_type`:** `identify`, `login`, `register`, `signup`

---

## 6. Facts (silver)

Event-level tables — filter on `website_id` and `created_at` (or relevant time column).

### 6.1 `fact_page_views`

One row per page load / SPA navigation.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, visitor_id, created_at, page_view_id)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 180 DAY` |
| **Grain** | One row per page view event |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `page_view_id` | String | — | Unique page load id |
| `session_id` | String | — | Parent session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `page_path` | String | — | URL path |
| `page_title` | String | `''` | Document title |
| `referrer` | String | `''` | Referrer for this view |
| `time_on_page_sec` | UInt32 | `0` | Seconds on page |
| `max_scroll_depth` | Float32 | `0` | Max scroll 0–100 |
| `sdk_version` | LowCardinality(String) | `''` | SDK version |
| `device` | LowCardinality(String) | `''` | Device class |
| `country` | LowCardinality(String) | `''` | Country |
| `utm_source` | LowCardinality(String) | `''` | UTM source |
| `utm_medium` | LowCardinality(String) | `''` | UTM medium |
| `utm_campaign` | String | `''` | UTM campaign |
| `extra_data` | String | `''` | Event props JSON |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

---

### 6.2 `fact_interaction_events`

Clicks, scrolls, mouse movement, rage/dead clicks.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, event_type, visitor_id, created_at)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 90 DAY` |
| **Grain** | One row per interaction event |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `event_id` | String | — | Unique event id |
| `event_type` | LowCardinality(String) | — | Interaction subtype |
| `page_view_id` | String | `''` | Page context |
| `session_id` | String | — | Session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `x_coord` | Int32 | `0` | Click X (viewport px) |
| `y_coord` | Int32 | `0` | Click Y (viewport px) |
| `element` | String | `''` | DOM selector / path |
| `element_type` | LowCardinality(String) | `''` | HTML tag name |
| `element_text` | String | `''` | Visible element text |
| `href` | String | `''` | Anchor href |
| `scroll_depth` | Float32 | `0` | Scroll milestone % |
| `velocity` | Int32 | `0` | Mouse velocity |
| `click_count` | UInt8 | `0` | Clicks in rage cluster |
| `reason` | LowCardinality(String) | `''` | Frustration reason |
| `viewport_w` | UInt16 | `0` | Viewport width |
| `viewport_h` | UInt16 | `0` | Viewport height |
| `device` | LowCardinality(String) | `''` | Device class |
| `country` | LowCardinality(String) | `''` | Country |
| `page_path` | String | `''` | Page path |
| `extra_data` | String | `''` | Props JSON |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

**Enums — `event_type`:** `click`, `move`, `scroll`, `scroll_depth`, `rage_click`, `dead_click`, `hover`

---

### 6.3 `fact_form_events`

Form funnel lifecycle events.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, event_type, visitor_id, created_at)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 180 DAY` |
| **Grain** | One row per form event |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `event_id` | String | — | Unique event id |
| `page_view_id` | String | `''` | Page containing form |
| `session_id` | String | — | Session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `event_type` | LowCardinality(String) | — | Form funnel step |
| `form_id` | String | `''` | Form identifier |
| `form_name` | String | `''` | Form display name |
| `field_name` | String | `''` | Field name |
| `field_value` | String | `''` | Field value (may be masked) |
| `device` | LowCardinality(String) | `''` | Device class |
| `country` | LowCardinality(String) | `''` | Country |
| `page_path` | String | `''` | Page path |
| `extra_data` | String | `''` | Props JSON |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

**Enums — `event_type`:** `form_view`, `form_start`, `form_focus`, `form_blur`, `form_change`, `form_validation`, `form_submit`, `form_success`, `form_failure`, `form_abandon`

---

### 6.4 `fact_conversion_events`

Goal completions — purchases, signups, logins, refunds.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, visitor_id, created_at, conversion_id)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 400 DAY` |
| **Grain** | One row per conversion event |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `conversion_id` | String | — | Unique conversion id |
| `page_view_id` | String | `''` | Page context |
| `session_id` | String | — | Session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `conversion_type` | LowCardinality(String) | — | Goal type |
| `product_id` | String | `''` | Product id if applicable |
| `value` | Decimal(12, 2) | `0` | Monetary value |
| `currency` | LowCardinality(String) | `'USD'` | ISO currency code |
| `device` | LowCardinality(String) | `''` | Device class |
| `country` | LowCardinality(String) | `''` | Country |
| `utm_source` | LowCardinality(String) | `''` | Attribution source |
| `utm_campaign` | String | `''` | Attribution campaign |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

**Enums — `conversion_type`:** `purchase`, `refund`, `signup`, `login`, `register`, `begin_checkout`, + custom strings

---

### 6.5 `fact_custom_events`

Custom `track()` events and selected built-in engagement events.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, event_name, visitor_id, created_at)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 180 DAY` |
| **Grain** | One row per custom/built-in routed event |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `event_id` | String | — | Unique event id |
| `page_view_id` | String | `''` | Page context |
| `session_id` | String | — | Session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `event_name` | LowCardinality(String) | — | Event name |
| `event_data` | String | `''` | Properties JSON |
| `device` | LowCardinality(String) | `''` | Device class |
| `country` | LowCardinality(String) | `''` | Country |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

**Enums — `event_name`:** Open set — any valid SDK name; includes `page_transition`, `page_visible`, `page_hidden`, `user_active`, `user_idle`, `outbound_link`, `site_search`, `identify`, etc.

---

### 6.6 `fact_product_interactions`

E-commerce product views, cart, wishlist, checkout actions.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, product_id, created_at, interaction_id)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 180 DAY` |
| **Grain** | One row per product interaction |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `interaction_id` | String | — | Unique interaction id |
| `page_view_id` | String | `''` | Page context |
| `session_id` | String | — | Session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `product_id` | String | — | Product / SKU id |
| `product_name` | String | `''` | Product name |
| `product_category` | LowCardinality(String) | `''` | Category |
| `product_price` | Decimal(12, 2) | `0` | Price at interaction |
| `currency` | LowCardinality(String) | `'USD'` | Currency |
| `product_sku` | String | `''` | SKU |
| `product_brand` | String | `''` | Brand |
| `section` | LowCardinality(String) | `''` | E-commerce action type |
| `scroll_depth` | Float32 | `0` | Scroll on product page |
| `time_on_page_sec` | UInt32 | `0` | Time on product page |
| `device` | LowCardinality(String) | `''` | Device class |
| `country` | LowCardinality(String) | `''` | Country |
| `extra_data` | String | `''` | Props JSON |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

**Enums — `section`:** `product_view`, `add_to_cart`, `remove_from_cart`, `add_to_wishlist`, `remove_from_wishlist`, `begin_checkout`, `featured`, `listing`

---

### 6.7 `fact_performance_events`

Core Web Vitals and navigation timing.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, metric_name, created_at)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 90 DAY` |
| **Grain** | One row per performance measurement |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `event_id` | String | — | Unique event id |
| `page_view_id` | String | `''` | Page measured |
| `session_id` | String | — | Session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `metric_name` | LowCardinality(String) | — | Vitals metric id |
| `metric_value` | Float64 | — | Value (ms or score) |
| `rating` | LowCardinality(String) | `''` | CWV rating bucket |
| `page_path` | String | `''` | Page path |
| `device` | LowCardinality(String) | `''` | Device class |
| `extra_data` | String | `''` | Raw vitals JSON |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

**Enums — `metric_name`:** `LCP`, `FCP`, `CLS`, `INP`, `TTFB`, `FID`, `performance_navigation`  
**Enums — `rating`:** `good`, `needs-improvement`, `poor`, `""`

---

### 6.8 `fact_error_events`

Client-side JavaScript and resource errors.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, error_type, created_at)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 90 DAY` |
| **Grain** | One row per error event |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `event_id` | String | — | Unique event id |
| `page_view_id` | String | `''` | Page context |
| `session_id` | String | — | Session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `error_type` | LowCardinality(String) | — | Error class |
| `message` | String | `''` | Error message |
| `stack` | String | `''` | Stack trace |
| `page_path` | String | `''` | Page path |
| `device` | LowCardinality(String) | `''` | Device class |
| `browser` | LowCardinality(String) | `''` | Browser |
| `extra_data` | String | `''` | Props JSON |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

**Enums — `error_type`:** `javascript`, `unhandledrejection`, `resource`, + SDK-defined types

---

### 6.9 `fact_cookie_operations`

Cookie read/write and consent audit events.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, cookie_name, created_at)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 60 DAY` |
| **Grain** | One row per cookie operation |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `event_id` | String | — | Unique event id |
| `session_id` | String | — | Session |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `action` | LowCardinality(String) | — | Operation type |
| `cookie_name` | String | — | Cookie name |
| `cookie_value` | String | `''` | Cookie value |
| `expiry_days` | Int32 | `0` | Expiry days |
| `page_path` | String | `''` | Page path |
| `created_at` | DateTime64(3, 'UTC') | — | Event timestamp |

**Enums — `action`:** `set`, `delete`, `read`, `consent_granted`, `consent_denied`

---

### 6.10 `fact_heap_snapshots`

Browser memory heap diagnostics.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, visitor_id, created_at)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 30 DAY` |
| **Grain** | One row per heap snapshot |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `snapshot_id` | String | — | Unique snapshot id |
| `visitor_id` | String | — | Visitor |
| `website_id` | UInt32 | — | Tenant |
| `page_path` | String | `''` | Page path |
| `used_heap_bytes` | UInt64 | — | Used heap bytes |
| `total_heap_bytes` | UInt64 | — | Total heap bytes |
| `heap_limit_bytes` | UInt64 | — | Heap limit bytes |
| `used_percentage` | Float32 | — | Used % |
| `browser` | LowCardinality(String) | `''` | Browser |
| `summary_data` | String | `''` | JSON summary |
| `created_at` | DateTime64(3, 'UTC') | — | Snapshot time |

---

## 7. Aggregates (gold)

Use `*Merge()` functions on `*_state` columns. Example: `uniqExactMerge(visitors_state) AS visitors`.

### 7.1 `agg_web_daily`

Daily site-wide KPI aggregate states.

| Property | Value |
|----------|-------|
| **Engine** | `AggregatingMergeTree` |
| **ORDER BY** | `(website_id, event_date)` |
| **PARTITION BY** | `toYYYYMM(event_date)` |
| **TTL** | `event_date + 3 YEAR` |
| **Grain** | One row per `(website_id, event_date)` |

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `event_date` | Date | Calendar date |
| `visitors_state` | AggregateFunction(uniqExact, String) | → `uniqExactMerge()` |
| `sessions_state` | AggregateFunction(uniqExact, String) | → `uniqExactMerge()` |
| `pageviews_state` | AggregateFunction(count) | → `countMerge()` |
| `clicks_state` | AggregateFunction(count) | → `countMerge()` |
| `rage_clicks_state` | AggregateFunction(count) | → `countMerge()` |
| `dead_clicks_state` | AggregateFunction(count) | → `countMerge()` |
| `conversions_state` | AggregateFunction(count) | → `countMerge()` |
| `conversion_value_state` | AggregateFunction(sum, Decimal(12, 2)) | → `sumMerge()` |
| `session_duration_state` | AggregateFunction(avg, Float64) | → `avgMerge()` |
| `scroll_depth_state` | AggregateFunction(avg, Float32) | → `avgMerge()` |
| `bounce_cnt_state` | AggregateFunction(sum, UInt64) | **Stale — do not use for bounce rate** |
| `session_cnt_state` | AggregateFunction(sum, UInt64) | Legacy session count |

---

### 7.2 `agg_page_daily`

Daily metrics per page path.

| Property | Value |
|----------|-------|
| **Engine** | `AggregatingMergeTree` |
| **ORDER BY** | `(website_id, page_path, event_date)` |
| **PARTITION BY** | `toYYYYMM(event_date)` |
| **TTL** | `event_date + 2 YEAR` |
| **Grain** | One row per `(website_id, page_path, event_date)` |

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `page_path` | String | Page path |
| `event_date` | Date | Calendar date |
| `views_state` | AggregateFunction(count) | → `countMerge()` |
| `visitors_state` | AggregateFunction(uniqExact, String) | → `uniqExactMerge()` |
| `time_on_page_state` | AggregateFunction(avg, Float64) | → `avgMerge()` |
| `scroll_depth_state` | AggregateFunction(avg, Float32) | → `avgMerge()` |
| `rage_clicks_state` | AggregateFunction(count) | Often zero — prefer facts |
| `dead_clicks_state` | AggregateFunction(count) | Often zero — prefer facts |

---

### 7.3 `agg_product_daily`

Daily metrics per product.

| Property | Value |
|----------|-------|
| **Engine** | `AggregatingMergeTree` |
| **ORDER BY** | `(website_id, product_id, event_date)` |
| **PARTITION BY** | `toYYYYMM(event_date)` |
| **TTL** | `event_date + 2 YEAR` |
| **Grain** | One row per `(website_id, product_id, event_date)` |

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `product_id` | String | Product id |
| `event_date` | Date | Calendar date |
| `clicks_state` | AggregateFunction(count) | → `countMerge()` |
| `visitors_state` | AggregateFunction(uniqExact, String) | → `uniqExactMerge()` |
| `conversions_state` | AggregateFunction(count) | → `countMerge()` |
| `price_state` | AggregateFunction(avg, Decimal(12, 2)) | → `avgMerge()` |

---

### 7.4 `agg_ecommerce_daily`

Daily e-commerce funnel aggregate states.

| Property | Value |
|----------|-------|
| **Engine** | `AggregatingMergeTree` |
| **ORDER BY** | `(website_id, event_date)` |
| **PARTITION BY** | `toYYYYMM(event_date)` |
| **TTL** | `event_date + 2 YEAR` |
| **Grain** | One row per `(website_id, event_date)` |

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `event_date` | Date | Calendar date |
| `product_views_state` | AggregateFunction(count) | → `countMerge()` |
| `cart_adds_state` | AggregateFunction(count) | → `countMerge()` |
| `cart_removes_state` | AggregateFunction(count) | → `countMerge()` |
| `wishlist_adds_state` | AggregateFunction(count) | → `countMerge()` |
| `wishlist_removes_state` | AggregateFunction(count) | → `countMerge()` |
| `checkout_starts_state` | AggregateFunction(count) | → `countMerge()` |
| `product_visitors_state` | AggregateFunction(uniqExact, String) | → `uniqExactMerge()` |
| `purchases_state` | AggregateFunction(count) | → `countMerge()` |
| `purchase_revenue_state` | AggregateFunction(sum, Decimal(12, 2)) | → `sumMerge()` |
| `refunds_state` | AggregateFunction(count) | → `countMerge()` |

---

### 7.5 `agg_session_activity`

Intermediate session activity states for bounce calculation. Query via `v_session_bounce` — not for direct analytics.

| Property | Value |
|----------|-------|
| **Engine** | `AggregatingMergeTree` |
| **ORDER BY** | `(website_id, session_id)` |
| **PARTITION BY** | None |
| **TTL** | None |
| **Grain** | One row per `(website_id, session_id)` |

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `session_id` | String | Session |
| `pageviews_state` | AggregateFunction(count) | Pageview count state |
| `activity_min_state` | AggregateFunction(min, DateTime64(3, 'UTC')) | First activity timestamp |
| `activity_max_state` | AggregateFunction(max, DateTime64(3, 'UTC')) | Last activity timestamp |

---

## 8. Views

### 8.1 `v_session_bounce`

Canonical per-session bounce metrics computed from fact tables.

```sql
CREATE VIEW web_tracking.v_session_bounce AS
SELECT
    website_id,
    session_id,
    countMerge(pageviews_state) AS pageview_count,
    toUInt32(greatest(0, dateDiff('second',
        minMerge(activity_min_state),
        maxMerge(activity_max_state)))) AS duration_seconds,
    toUInt8(countMerge(pageviews_state) = 1
        AND greatest(0, dateDiff('second',
            minMerge(activity_min_state),
            maxMerge(activity_max_state))) < 10) AS is_bounce,
    minMerge(activity_min_state) AS session_started_at
FROM web_tracking.agg_session_activity
GROUP BY website_id, session_id
HAVING pageview_count > 0;
```

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `session_id` | String | Session |
| `pageview_count` | UInt64 | Page views in session |
| `duration_seconds` | UInt32 | Activity span seconds |
| `is_bounce` | UInt8 | `1` if 1 pageview AND duration < 10s |
| `session_started_at` | DateTime64(3, 'UTC') | First activity time |

**Bounce rule:** `is_bounce = 1` when `pageview_count = 1` AND `duration_seconds < 10`.

---

### 8.2 `ecommerce`

Query-friendly daily e-commerce KPIs with states already merged.

```sql
CREATE VIEW web_tracking.ecommerce AS
SELECT
    website_id,
    event_date,
    countMerge(product_views_state) AS product_views,
    countMerge(cart_adds_state) AS cart_adds,
    countMerge(cart_removes_state) AS cart_removes,
    countMerge(wishlist_adds_state) AS wishlist_adds,
    countMerge(wishlist_removes_state) AS wishlist_removes,
    countMerge(checkout_starts_state) AS checkout_starts,
    uniqExactMerge(product_visitors_state) AS product_engaged_visitors,
    countMerge(purchases_state) AS purchases,
    sumMerge(purchase_revenue_state) AS purchase_revenue,
    countMerge(refunds_state) AS refunds
FROM web_tracking.agg_ecommerce_daily
GROUP BY website_id, event_date;
```

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Tenant |
| `event_date` | Date | Calendar date |
| `product_views` | UInt64 | Daily product views |
| `cart_adds` | UInt64 | Daily add-to-cart |
| `cart_removes` | UInt64 | Daily cart removes |
| `wishlist_adds` | UInt64 | Daily wishlist adds |
| `wishlist_removes` | UInt64 | Daily wishlist removes |
| `checkout_starts` | UInt64 | Daily checkout starts |
| `product_engaged_visitors` | UInt64 | Unique product-engaged visitors |
| `purchases` | UInt64 | Daily purchases |
| `purchase_revenue` | Decimal | Daily purchase revenue |
| `refunds` | UInt64 | Daily refunds |

---

## 9. Dictionary

### 9.1 `dict_admin_accounts`

ClickHouse dictionary — not a table. Reloads from PostgreSQL ingest registry every 15–60 seconds for ingest validation.

| Property | Value |
|----------|-------|
| **Type** | Dictionary |
| **PRIMARY KEY** | `website_id` |
| **SOURCE** | PostgreSQL `v_web_tracking_ingest_registry` |
| **LAYOUT** | `HASHED()` |
| **LIFETIME** | MIN 15 MAX 60 seconds |

| Column | Type | Description |
|--------|------|-------------|
| `website_id` | UInt32 | Site id |
| `website_url` | String | Registered URL |
| `site_type` | String | Site type |
| `status` | String | Status |
| `organization_id` | Int64 | Organization id |
| `is_active` | Bool | Active flag |

---

## 10. Session replay tables

### 10.1 `fact_replay_chunks`

Compressed rrweb recording chunks from `replay_chunk_v1` payloads.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, session_id, chunk_index)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 30 DAY` |
| **Grain** | One row per replay chunk |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `chunk_id` | UUID | — | Chunk id |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `visitor_id` | String | — | Visitor |
| `session_id` | String | — | Session |
| `page_view_id` | String | `''` | Page view |
| `chunk_index` | UInt32 | — | Order in session |
| `encoding` | LowCardinality(String) | `'gzip_b64'` | Compression encoding |
| `events_data` | String | — | gzip+base64 rrweb events |
| `event_count` | UInt32 | — | Events in chunk |
| `source` | LowCardinality(String) | `'rrweb'` | Recorder library |
| `created_at` | DateTime64(3, 'UTC') | — | Received time |

**Enums — `encoding`:** `gzip_b64`  
**Enums — `source`:** `rrweb`

---

### 10.2 `session_replay_chunks`

HTML snapshot replay chunks from `session_replay_chunk` SDK events.

| Property | Value |
|----------|-------|
| **Engine** | `MergeTree` |
| **ORDER BY** | `(website_id, session_id, chunk_index)` |
| **PARTITION BY** | `toYYYYMM(received_at)` |
| **TTL** | `received_at + 90 DAY` |
| **Grain** | One row per snapshot chunk |

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `event_id` | String | — | Event id |
| `website_id` | UInt32 | — | Tenant |
| `organization_id` | Nullable(UInt32) | — | Organization |
| `visitor_id` | String | — | Visitor |
| `session_id` | String | — | Session |
| `page_view_id` | String | `''` | Page view |
| `chunk_index` | UInt32 | — | Chunk order |
| `is_snapshot` | UInt8 | `0` | Whether chunk is DOM snapshot |
| `href` | String | `''` | Page URL |
| `viewport_width` | UInt16 | `0` | Viewport width |
| `viewport_height` | UInt16 | `0` | Viewport height |
| `event_timestamp` | DateTime64(3, 'UTC') | — | Event time |
| `records` | String | `'[]'` | Replay records JSON |
| `raw_event_data` | String | `'{}'` | Raw props JSON |
| `received_at` | DateTime64(3, 'UTC') | — | Ingest time |

**Enums — `is_snapshot`:** `0`, `1`

---

## 11. Optional / migration objects

### 11.1 `fact_page_views_deduped` (optional deployment)

Deduplicated page views — one row per `(website_id, session_id, page_view_id)`. Applied via `16_fact_page_views_dedupe.sql` on some deployments.

| Property | Value |
|----------|-------|
| **Engine** | `ReplacingMergeTree(dedupe_version)` |
| **ORDER BY** | `(website_id, session_id, page_view_id)` |
| **PARTITION BY** | `toYYYYMM(created_at)` |
| **TTL** | `created_at + 180 DAY` |

Same columns as `fact_page_views` plus:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `dedupe_version` | Int64 | `0` | ReplacingMergeTree version |

---

### 11.2 Migration temp tables (one-time backfill)

Not part of production analytics. Created by `12b_backfill_organization_id.sql`:

| Table | Engine | Purpose |
|-------|--------|---------|
| `_org_backfill_payload` | Join(ANY, LEFT, payload_id) | Lookup org by payload |
| `_org_backfill_session` | Join(ANY, LEFT, session_id) | Lookup org by session |
| `_org_backfill_website` | Join(ANY, LEFT, website_id) | Lookup org by website |

---

## 12. Materialized views catalog

| Materialized view | Source | Target | Purpose |
|-------------------|--------|--------|---------|
| `mv_parse_events` | `raw_payloads` | `events_staging` | Explode events array |
| `mv_fact_page_views` | `events_staging` | `fact_page_views` | Page view facts |
| `mv_fact_interactions` | `events_staging` | `fact_interaction_events` | Interaction facts |
| `mv_fact_form_events` | `events_staging` | `fact_form_events` | Form facts |
| `mv_fact_performance` | `events_staging` | `fact_performance_events` | Performance facts |
| `mv_fact_errors` | `events_staging` | `fact_error_events` | Error facts |
| `mv_fact_product` | `events_staging` | `fact_product_interactions` | Product facts |
| `mv_fact_conversions` | `events_staging` | `fact_conversion_events` | Conversion facts |
| `mv_fact_custom` | `events_staging` | `fact_custom_events` | Custom/built-in routed events |
| `mv_dim_visitors` | `events_staging` | `dim_visitors` | Visitor profile updates |
| `mv_dim_sessions` | `raw_payloads` | `dim_sessions` | Session dimension updates |
| `mv_dim_websites` | `raw_payloads` | `dim_websites` | Site metadata |
| `mv_dim_known_users` | `events_staging` | `dim_known_users` | Identity mapping (refresh 1 min) |
| `mv_fact_replay_chunks` | `raw_payloads` | `fact_replay_chunks` | rrweb replay chunks |
| `mv_session_replay_chunks` | `events_staging` | `session_replay_chunks` | HTML snapshot replay |
| `mv_agg_web_daily_pageviews` | `fact_page_views` | `agg_web_daily` | Daily pageview rollups |
| `mv_agg_web_daily_interactions` | `fact_interaction_events` | `agg_web_daily` | Daily click rollups |
| `mv_agg_web_daily_conversions` | `fact_conversion_events` | `agg_web_daily` | Daily conversion rollups |
| `mv_agg_web_daily_sessions` | `dim_sessions` | `agg_web_daily` | Daily session rollups |
| `mv_agg_page_daily` | `fact_page_views` | `agg_page_daily` | Daily per-page rollups |
| `mv_agg_product_daily` | `fact_product_interactions` | `agg_product_daily` | Daily per-product rollups |
| `mv_agg_ecommerce_daily_products` | `fact_product_interactions` | `agg_ecommerce_daily` | E-com funnel from products |
| `mv_agg_ecommerce_daily_conversions` | `fact_conversion_events` | `agg_ecommerce_daily` | E-com funnel from conversions |
| `mv_agg_session_activity_pageviews` | `fact_page_views` | `agg_session_activity` | Session pageview states |
| `mv_agg_session_activity_interactions` | `fact_interaction_events` | `agg_session_activity` | Session activity timestamps |

---

## 13. Join key reference

ClickHouse does not enforce foreign keys. Use these logical joins:

| Parent | Child | Join columns |
|--------|-------|--------------|
| `dim_visitors` | `dim_sessions` | `website_id`, `visitor_id` |
| `dim_sessions` | `fact_page_views` | `website_id`, `session_id` |
| `fact_page_views` | `fact_interaction_events` | `website_id`, `page_view_id` |
| `fact_page_views` | `fact_form_events` | `website_id`, `page_view_id` |
| `fact_page_views` | `fact_conversion_events` | `website_id`, `page_view_id` |
| `dim_sessions` | `v_session_bounce` | `website_id`, `session_id` |
| `dim_visitors` | `dim_known_users` | `website_id`, `visitor_id` |
| `dim_sessions` | `fact_replay_chunks` | `website_id`, `session_id` |
| All analytics tables | Tenant scope | `website_id` |

### Primary key / sort key summary

| Object | ORDER BY (grain) |
|--------|------------------|
| `raw_payloads` | `(website_id, payload_id)` |
| `events_staging` | `(website_id, event_ts, event_id)` |
| `dim_websites` | `(website_id)` |
| `dim_visitors` | `(website_id, visitor_id)` |
| `dim_sessions` | `(website_id, visitor_id, session_id)` |
| `dim_known_users` | `(website_id, user_id, visitor_id)` |
| `fact_page_views` | `(website_id, visitor_id, created_at, page_view_id)` |
| `fact_interaction_events` | `(website_id, event_type, visitor_id, created_at)` |
| `fact_form_events` | `(website_id, event_type, visitor_id, created_at)` |
| `fact_conversion_events` | `(website_id, visitor_id, created_at, conversion_id)` |
| `fact_custom_events` | `(website_id, event_name, visitor_id, created_at)` |
| `fact_product_interactions` | `(website_id, product_id, created_at, interaction_id)` |
| `fact_performance_events` | `(website_id, metric_name, created_at)` |
| `fact_error_events` | `(website_id, error_type, created_at)` |
| `fact_cookie_operations` | `(website_id, cookie_name, created_at)` |
| `fact_heap_snapshots` | `(website_id, visitor_id, created_at)` |
| `fact_replay_chunks` | `(website_id, session_id, chunk_index)` |
| `session_replay_chunks` | `(website_id, session_id, chunk_index)` |
| `agg_web_daily` | `(website_id, event_date)` |
| `agg_page_daily` | `(website_id, page_path, event_date)` |
| `agg_product_daily` | `(website_id, product_id, event_date)` |
| `agg_ecommerce_daily` | `(website_id, event_date)` |
| `agg_session_activity` | `(website_id, session_id)` |

---

## 14. Categorical value index

Quick reference for all enumerated / LowCardinality columns across the schema.

| Table | Column | Values |
|-------|--------|--------|
| `raw_payloads` | `payload_type` | `events_v3`, `replay_chunk_v1` |
| `raw_payloads` | `processing_status` | `accepted` |
| `dim_websites` | `site_type` | `blog`, `ecommerce` |
| `dim_websites` | `status` | `active` |
| `dim_sessions` | `device` | `desktop`, `mobile`, `tablet`, `""` |
| `dim_sessions` | `is_bounce` | `0`, `1` (stale) |
| `dim_known_users` | `last_event_type` | `identify`, `login`, `register`, `signup` |
| `fact_interaction_events` | `event_type` | `click`, `move`, `scroll`, `scroll_depth`, `rage_click`, `dead_click`, `hover` |
| `fact_form_events` | `event_type` | `form_view`, `form_start`, `form_focus`, `form_blur`, `form_change`, `form_validation`, `form_submit`, `form_success`, `form_failure`, `form_abandon` |
| `fact_conversion_events` | `conversion_type` | `purchase`, `refund`, `signup`, `login`, `register`, `begin_checkout`, + custom |
| `fact_conversion_events` | `currency` | `USD` (default), `GBP`, `EUR`, ISO 4217 |
| `fact_product_interactions` | `section` | `product_view`, `add_to_cart`, `remove_from_cart`, `add_to_wishlist`, `remove_from_wishlist`, `begin_checkout`, `featured`, `listing` |
| `fact_performance_events` | `metric_name` | `LCP`, `FCP`, `CLS`, `INP`, `TTFB`, `FID`, `performance_navigation` |
| `fact_performance_events` | `rating` | `good`, `needs-improvement`, `poor`, `""` |
| `fact_error_events` | `error_type` | `javascript`, `unhandledrejection`, `resource`, + SDK-defined |
| `fact_cookie_operations` | `action` | `set`, `delete`, `read`, `consent_granted`, `consent_denied` |
| `fact_replay_chunks` | `encoding` | `gzip_b64` |
| `fact_replay_chunks` | `source` | `rrweb` |
| `session_replay_chunks` | `is_snapshot` | `0`, `1` |
| `v_session_bounce` | `is_bounce` | `0`, `1` |
| Shared | `device` (multiple tables) | `desktop`, `mobile`, `tablet`, `""` |
| Shared | `platform` | `Windows`, `macOS`, `Linux`, `Android`, `iOS`, `""` |
| Shared | `browser` | `Chrome`, `Safari`, `Firefox`, `Edge`, `Opera`, `Brave`, `""` |
| Shared | `utm_medium` | `email`, `cpc`, `organic`, `social`, `referral`, `""`, + client-defined |

---

## 15. DDL file map

| File | Objects defined |
|------|-----------------|
| `00_web_tracking.sql` | Database |
| `01_bronze.sql` | `raw_payloads` |
| `02_auth_and_dim.sql` | `dim_websites`, `dim_visitors`, `dim_sessions` |
| `02b_dict_admin_accounts.sql` | `dict_admin_accounts` |
| `03_silver_facts.sql` | All core `fact_*` tables |
| `04_gold_aggs.sql` | `agg_web_daily`, `agg_page_daily`, `agg_product_daily` + agg MVs |
| `05_materialized_views_pipeline.sql` | `events_staging`, fact/dim MVs |
| `07_replay_chunks.sql` | `fact_replay_chunks` + MV |
| `10_session_campaign_attribution.sql` | `wt_*` columns on `dim_sessions` |
| `11_session_bounce_metrics.sql` | `agg_session_activity`, `v_session_bounce` |
| `13_ecommerce_daily.sql` | `agg_ecommerce_daily`, `ecommerce` view |
| `14_session_replay_chunks.sql` | `session_replay_chunks` + MV |
| `15_dim_known_users.sql` | `dim_known_users` + MV |
| `16_fact_page_views_dedupe.sql` | `fact_page_views_deduped` (optional) |
| `17_fix_dim_known_users.sql` | `dim_known_users` migration |

**Apply all DDL:** `python scripts/apply_clickhouse_ddl.py`

---

## Retention summary

| Table | TTL |
|-------|-----|
| `raw_payloads` | 90 days |
| `dim_sessions` | 400 days (by `started_at`) |
| `fact_page_views` | 180 days |
| `fact_interaction_events` | 90 days |
| `fact_form_events` | 180 days |
| `fact_conversion_events` | 400 days |
| `fact_custom_events` | 180 days |
| `fact_product_interactions` | 180 days |
| `fact_performance_events` | 90 days |
| `fact_error_events` | 90 days |
| `fact_cookie_operations` | 60 days |
| `fact_heap_snapshots` | 30 days |
| `fact_replay_chunks` | 30 days |
| `session_replay_chunks` | 90 days |
| `agg_web_daily` | 3 years |
| `agg_page_daily` | 2 years |
| `agg_product_daily` | 2 years |
| `agg_ecommerce_daily` | 2 years |
| `dim_visitors`, `dim_websites`, `dim_known_users` | Permanent |

---

*Worktual Web Tracking — ClickHouse full schema reference v1.0*
