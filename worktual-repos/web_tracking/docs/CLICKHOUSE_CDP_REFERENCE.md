# ClickHouse Schema — CDP Team Reference

**Database:** `web_tracking`  
**Purpose:** Web behaviour, identity, sessions, and events for Customer Data Platform (CDP) integration.  
**Audience:** CDP team — table joins, field meanings, and why each column exists.

---

## 1. How data flows

```
Browser SDK  →  Ingest API  →  raw_payloads (bronze)
                                    ↓ materialized views
              dim_domains ── dim_visitors ── dim_sessions
                                    ↓
              fact_page_views ── fact_interaction_events ── fact_form_events
              fact_conversion_events ── fact_product_interactions ── fact_custom_events
              fact_performance_events ── fact_error_events ── fact_replay_chunks
                                    ↓
              agg_web_daily / agg_page_daily / agg_product_daily (pre-aggregated KPIs)
```

**Query rule:** Always filter by tenant scope — `domain_id` (site) and, when populated, `organization_id` (customer account). Use `FINAL` on `ReplacingMergeTree` dimension tables (`dim_visitors`, `dim_sessions`, `dim_domains`).

---

## 2. Identity hierarchy

| Key | Level | Why we use it |
|-----|--------|----------------|
| `organization_id` | Customer account | Groups multiple tracked websites under one CDP tenant. |
| `domain_id` | Tracked website | Unique site ID (planned rename: `website_id`). |
| `domain_name` | Site URL / hostname | Human-readable site label (planned rename: `website_url`). |
| `visitor_id` | Anonymous browser | Stable anonymous ID from SDK — primary CDP anonymous key. |
| `user_id` | Known person | Set after CDP `identify()` — links anonymous → CRM/CDP profile. |
| `anonymous_id` | SDK alias | Secondary anonymous identifier when SDK uses dual IDs. |
| `session_id` | Single visit | Groups events in one browsing session. |
| `page_view_id` | Single page load | Links page-level facts to clicks, forms, conversions. |

**Planned terminology (not yet migrated in DB):** `domain_id` → `website_id`, `domain_name` → `website_url`.

---

## 3. Table relationships

| From | To | Join keys | Relationship |
|------|-----|-----------|--------------|
| `dim_domains` | all tables | `domain_id` | One site → many visitors, sessions, events |
| `dim_visitors` | `dim_sessions` | `domain_id`, `visitor_id` | One visitor → many sessions |
| `dim_sessions` | `fact_page_views` | `domain_id`, `session_id`, `visitor_id` | One session → many page views |
| `fact_page_views` | interaction / form / conversion facts | `domain_id`, `page_view_id`, `session_id` | One page view → many child events |
| `dim_visitors` | `fact_*` (any) | `domain_id`, `visitor_id` | Visitor 360 across all event types |
| `dim_sessions` | `fact_*` (any) | `domain_id`, `session_id` | Session-level attribution (UTM, geo, device) |

**CDP identity stitch:** Join `dim_visitors.user_id` (or `dim_sessions.user_id`) to your CDP person ID when `user_id` is non-empty.

**Canonical visitor counts:** Use `uniqExact(visitor_id)` from **`dim_sessions`** (not page views) — matches dashboard and chat.

---

## 4. Dimension tables

### `dim_domains` — tracked websites

| Column | Type | Description / why |
|--------|------|-------------------|
| `domain_id` | UInt32 | Primary site key — use in every query filter. |
| `organization_id` | UUID | Parent customer account for multi-site CDP tenants. |
| `domain_name` | String | Site hostname or URL label. |
| `site_type` | String | Site category (e.g. blog, ecommerce) for segmentation. |
| `status` | String | `active` / inactive — exclude inactive from CDP sync. |
| `created_at` | DateTime64 | When site was registered. |
| `updated_at` | DateTime64 | Last metadata change (ReplacingMergeTree version). |

---

### `dim_visitors` — visitor profile (one row per visitor per site)

| Column | Type | Description / why |
|--------|------|-------------------|
| `visitor_id` | String | Anonymous visitor key — **main CDP anonymous identifier**. |
| `domain_id` | UInt32 | Which site this visitor belongs to. |
| `organization_id` | UUID | Tenant scope for CDP exports. |
| `user_id` | String | Known user ID after identify — **CDP ↔ CRM link**. |
| `anonymous_id` | String | Alternate anonymous ID from SDK. |
| `first_seen_at` | DateTime64 | First activity timestamp — acquisition date. |
| `last_seen_at` | DateTime64 | Most recent activity — recency for CDP segments. |
| `total_sessions` | UInt32 | Lifetime session count — new vs returning logic. |
| `total_pageviews` | UInt32 | Lifetime page view count — engagement depth. |
| `country` | String | Last known country (ISO) — geo segments. |
| `created_at` | DateTime64 | Row created. |
| `updated_at` | DateTime64 | Row version (use `FINAL` for latest). |

---

### `dim_sessions` — session profile (one row per session)

| Column | Type | Description / why |
|--------|------|-------------------|
| `session_id` | String | Unique visit ID — groups all events in one session. |
| `visitor_id` | String | Owner of this session. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `user_id` | String | Known user if identified during session. |
| `started_at` | DateTime64 | Session start — time filtering, funnels. |
| `ended_at` | DateTime64 | Session end — duration calculation. |
| `duration_seconds` | UInt32 | Visit length — engagement KPI. |
| `entry_page` | String | First page path — landing page analysis. |
| `exit_page` | String | Last page path — drop-off analysis. |
| `entry_url` | String | Full landing URL. |
| `exit_url` | String | Full exit URL. |
| `pageview_count` | UInt32 | Pages in session — depth metric. |
| `is_bounce` | UInt8 | 1 = bounce session — bounce rate KPI. |
| `referrer` | String | Full referrer URL — traffic source. |
| `referrer_domain` | String | Referrer hostname — source grouping. |
| `utm_source` | String | Campaign source — attribution. |
| `utm_medium` | String | Campaign medium — attribution. |
| `utm_campaign` | String | Campaign name — attribution. |
| `utm_term` | String | Paid keyword. |
| `utm_content` | String | Ad/content variant. |
| `user_agent` | String | Raw UA string — device parsing fallback. |
| `language` | String | Browser language — locale segments. |
| `platform` | String | OS platform. |
| `browser` | String | Browser name. |
| `browser_version` | String | Browser version. |
| `device` | String | Device class (desktop / mobile / tablet). |
| `screen_width` | UInt16 | Screen width — responsive analytics. |
| `screen_height` | UInt16 | Screen height. |
| `country` | String | Geo country from IP. |
| `city` | String | Geo city. |
| `region` | String | Geo region/state. |
| `latitude` | Float64 | Geo lat (approximate). |
| `longitude` | Float64 | Geo lon (approximate). |
| `ip_hash` | String | Hashed IP — fraud/dedup without storing raw IP. |
| `geo_data` | String | Raw geo JSON from lookup — extended geo fields. |
| `sdk_version` | String | Tracking SDK version — data quality checks. |
| `created_at` | DateTime64 | Row created. |
| `updated_at` | DateTime64 | Row version (use `FINAL`). |

---

## 5. Fact tables (events)

Shared keys on most fact tables:

| Column | Why |
|--------|-----|
| `domain_id` | Tenant/site isolation — **always filter**. |
| `organization_id` | CDP account scope. |
| `visitor_id` | Link event to visitor profile. |
| `session_id` | Link event to session attribution (UTM, geo). |
| `page_view_id` | Link event to specific page load. |
| `created_at` | Event timestamp (UTC) — time windows, ordering. |
| `device` / `country` | Denormalized for fast CDP segment queries without joining session. |

---

### `fact_page_views` — page loads

| Column | Type | Description / why |
|--------|------|-------------------|
| `page_view_id` | String | Unique page load ID — parent for interactions. |
| `session_id` | String | Session context. |
| `visitor_id` | String | Visitor context. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `page_path` | String | URL path — top pages, content analytics. |
| `page_title` | String | Document title — reporting labels. |
| `referrer` | String | Referrer at page level. |
| `time_on_page_sec` | UInt32 | Time on page — engagement. |
| `max_scroll_depth` | Float32 | Max scroll % (0–100) — content consumption. |
| `sdk_version` | String | SDK version at event time. |
| `device` | String | Device class. |
| `country` | String | Country at event time. |
| `utm_source` | String | UTM at page level (fallback if session UTM empty). |
| `utm_medium` | String | UTM medium. |
| `utm_campaign` | String | UTM campaign. |
| `extra_data` | String | JSON overflow — custom SDK fields for CDP mapping. |
| `created_at` | DateTime64 | Page view time. |

---

### `fact_interaction_events` — clicks, scroll, mouse

| Column | Type | Description / why |
|--------|------|-------------------|
| `event_id` | String | Unique interaction ID. |
| `event_type` | String | `click`, `scroll`, `mousemove`, `rage_click`, `dead_click`, etc. |
| `page_view_id` | String | Page where interaction happened. |
| `session_id` | String | Session link. |
| `visitor_id` | String | Visitor link. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `x_coord` | Int32 | Click X — heatmaps. |
| `y_coord` | Int32 | Click Y — heatmaps. |
| `element` | String | CSS selector of target element. |
| `element_type` | String | HTML tag (button, a, input). |
| `element_text` | String | Visible label text — UX analytics. |
| `href` | String | Link URL if click on anchor. |
| `scroll_depth` | Float32 | Scroll depth at event — behaviour funnels. |
| `velocity` | Int32 | Mouse/scroll velocity — rage-click detection. |
| `click_count` | UInt8 | Clicks in cluster — rage-click signal. |
| `reason` | String | Why event fired (e.g. rage_click threshold). |
| `viewport_w` | UInt16 | Viewport width — heatmap normalization. |
| `viewport_h` | UInt16 | Viewport height. |
| `device` | String | Device class. |
| `country` | String | Country. |
| `page_path` | String | Page path (denormalized). |
| `extra_data` | String | JSON overflow. |
| `created_at` | DateTime64 | Event time. |

---

### `fact_form_events` — form funnel

| Column | Type | Description / why |
|--------|------|-------------------|
| `event_id` | String | Unique form event ID. |
| `page_view_id` | String | Page containing the form. |
| `session_id` | String | Session link. |
| `visitor_id` | String | Visitor link. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `event_type` | String | `form_start`, `field_focus`, `field_blur`, `form_submit`, etc. |
| `form_id` | String | Form DOM id — funnel by form. |
| `form_name` | String | Form name attribute. |
| `field_name` | String | Field name — field-level funnel. |
| `field_value` | String | Field value (masked for sensitive fields in SDK). |
| `device` | String | Device class. |
| `country` | String | Country. |
| `page_path` | String | Page path. |
| `extra_data` | String | JSON overflow. |
| `created_at` | DateTime64 | Event time. |

---

### `fact_conversion_events` — goals & revenue

| Column | Type | Description / why |
|--------|------|-------------------|
| `conversion_id` | String | Unique conversion ID. |
| `page_view_id` | String | Page where conversion occurred. |
| `session_id` | String | Session for attribution. |
| `visitor_id` | String | Visitor for CDP conversion profile. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `conversion_type` | String | Goal type (purchase, signup, lead, etc.). |
| `product_id` | String | Product tied to conversion. |
| `value` | Decimal | Monetary or score value — revenue KPIs. |
| `currency` | String | ISO currency code. |
| `device` | String | Device class. |
| `country` | String | Country. |
| `utm_source` | String | Conversion attribution source. |
| `utm_campaign` | String | Conversion attribution campaign. |
| `created_at` | DateTime64 | Conversion time. |

---

### `fact_product_interactions` — product engagement

| Column | Type | Description / why |
|--------|------|-------------------|
| `interaction_id` | String | Unique product event ID. |
| `page_view_id` | String | Page context. |
| `session_id` | String | Session link. |
| `visitor_id` | String | Visitor link. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `product_id` | String | Product identifier — CDP product affinity. |
| `product_name` | String | Display name. |
| `product_category` | String | Category — segment by interest. |
| `product_price` | Decimal | Price at interaction time. |
| `currency` | String | Currency. |
| `product_sku` | String | SKU — ecommerce CDP sync. |
| `product_brand` | String | Brand. |
| `section` | String | Page section (carousel, listing). |
| `scroll_depth` | Float32 | Scroll when product seen. |
| `time_on_page_sec` | UInt32 | Time on product page. |
| `device` | String | Device class. |
| `country` | String | Country. |
| `extra_data` | String | JSON overflow. |
| `created_at` | DateTime64 | Event time. |

---

### `fact_custom_events` — business-defined events

| Column | Type | Description / why |
|--------|------|-------------------|
| `event_id` | String | Unique custom event ID. |
| `page_view_id` | String | Page context. |
| `session_id` | String | Session link. |
| `visitor_id` | String | Visitor link. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `event_name` | String | Custom event name — **CDP event mapping key**. |
| `event_data` | String | JSON payload — map to CDP properties. |
| `device` | String | Device class. |
| `country` | String | Country. |
| `created_at` | DateTime64 | Event time. |

---

### `fact_performance_events` — Core Web Vitals

| Column | Type | Description / why |
|--------|------|-------------------|
| `event_id` | String | Unique metric event ID. |
| `page_view_id` | String | Page measured. |
| `session_id` | String | Session link. |
| `visitor_id` | String | Visitor link. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `metric_name` | String | e.g. `LCP`, `FID`, `CLS`, `TTFB`. |
| `metric_value` | Float64 | Measured value. |
| `rating` | String | `good` / `needs-improvement` / `poor`. |
| `page_path` | String | Page path. |
| `device` | String | Device class. |
| `extra_data` | String | JSON overflow. |
| `created_at` | DateTime64 | Measurement time. |

---

### `fact_error_events` — JavaScript errors

| Column | Type | Description / why |
|--------|------|-------------------|
| `event_id` | String | Unique error ID. |
| `page_view_id` | String | Page where error occurred. |
| `session_id` | String | Session link. |
| `visitor_id` | String | Visitor link. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `error_type` | String | Error class (TypeError, etc.). |
| `message` | String | Error message — support diagnostics. |
| `stack` | String | Stack trace. |
| `page_path` | String | Page path. |
| `device` | String | Device class. |
| `browser` | String | Browser. |
| `extra_data` | String | JSON overflow. |
| `created_at` | DateTime64 | Error time. |

---

### `fact_replay_chunks` — session replay (rrweb)

| Column | Type | Description / why |
|--------|------|-------------------|
| `chunk_id` | UUID | Unique replay chunk. |
| `domain_id` | UInt32 | Site scope. |
| `organization_id` | UUID | Tenant scope. |
| `visitor_id` | String | Visitor link. |
| `session_id` | String | Session replay belongs to. |
| `page_view_id` | String | Page within replay. |
| `chunk_index` | UInt32 | Order of chunks in session. |
| `encoding` | String | Compression (`gzip_b64`). |
| `events_data` | String | Compressed rrweb events — replay playback. |
| `event_count` | UInt32 | Events in chunk. |
| `source` | String | Recorder source (`rrweb`). |
| `created_at` | DateTime64 | Chunk time. |

---

### `fact_cookie_operations` — consent / cookie audit

| Column | Type | Description / why |
|--------|------|-------------------|
| `event_id` | String | Unique cookie op ID. |
| `session_id` | String | Session link. |
| `visitor_id` | String | Visitor link. |
| `domain_id` | UInt32 | Site scope. |
| `action` | String | set / delete / consent action. |
| `cookie_name` | String | Cookie name — compliance audit. |
| `cookie_value` | String | Value (may be truncated). |
| `expiry_days` | Int32 | Cookie lifetime. |
| `page_path` | String | Page where action occurred. |
| `created_at` | DateTime64 | Event time. |

---

### `raw_payloads` — raw ingest (bronze)

| Column | Type | Description / why |
|--------|------|-------------------|
| `payload_id` | UUID | Ingest message ID — dedup / replay. |
| `domain_id` | UInt32 | Site scope. |
| `domain_name` | String | Site label at ingest time. |
| `visitor_id` | String | Visitor from SDK. |
| `payload_type` | String | Event category (pageview, click, replay_chunk_v1, …). |
| `source_ip` | String | Ingest client IP (internal use). |
| `user_agent` | String | UA at ingest. |
| `received_at` | DateTime64 | Server receive time. |
| `payload` | String | **Full raw JSON** — CDP custom parsing, audit, reprocessing. |
| `processing_status` | String | accepted on insert (MVs run synchronously). |
| `ingested_at` | DateTime64 | Row version for ReplacingMergeTree. |
| `ingested_at` | DateTime64 | Row version (ReplacingMergeTree). |

---

## 6. Aggregate tables (pre-computed KPIs)

Use `-Merge` combinators to read (e.g. `uniqExactMerge(visitors_state)`).

### `agg_web_daily` — site KPIs by day

| Column | Description / why |
|--------|-------------------|
| `domain_id` | Site. |
| `event_date` | Calendar day. |
| `visitors_state` | Unique visitors (AggregatingMergeTree state). |
| `sessions_state` | Unique sessions. |
| `pageviews_state` | Page view count. |
| `clicks_state` | Click count. |
| `rage_clicks_state` | Rage click count — UX frustration signal. |
| `dead_clicks_state` | Dead click count. |
| `conversions_state` | Conversion count. |
| `conversion_value_state` | Sum of conversion value. |
| `session_duration_state` | Avg session duration. |
| `scroll_depth_state` | Avg scroll depth. |
| `bounce_cnt_state` | Bounce session count. |
| `session_cnt_state` | Total sessions. |

### `agg_page_daily` — page KPIs by day

| Column | Description / why |
|--------|-------------------|
| `domain_id` | Site. |
| `page_path` | Page. |
| `event_date` | Day. |
| `views_state` | Page views. |
| `visitors_state` | Unique visitors on page. |
| `time_on_page_state` | Avg time on page. |
| `scroll_depth_state` | Avg scroll depth. |
| `rage_clicks_state` | Rage clicks on page. |
| `dead_clicks_state` | Dead clicks on page. |

### `agg_product_daily` — product KPIs by day

| Column | Description / why |
|--------|-------------------|
| `domain_id` | Site. |
| `product_id` | Product. |
| `event_date` | Day. |
| `clicks_state` | Product interaction count. |
| `visitors_state` | Unique visitors engaging product. |
| `conversions_state` | Conversions tied to product. |
| `price_state` | Avg product price. |

---

## 7. CDP integration — recommended touchpoints

| CDP use case | Primary table(s) | Key fields |
|--------------|------------------|------------|
| Anonymous profile | `dim_visitors` | `visitor_id`, `first_seen_at`, `last_seen_at`, `country`, `total_sessions` |
| Identity resolution | `dim_visitors`, `dim_sessions` | `user_id`, `visitor_id`, `anonymous_id` |
| Session attribution | `dim_sessions` | `utm_*`, `referrer_domain`, `entry_page`, `device`, `country` |
| Event stream sync | `fact_custom_events`, `fact_conversion_events` | `event_name` / `conversion_type`, `event_data`, `created_at` |
| Product affinity | `fact_product_interactions` | `product_id`, `product_category`, `product_brand` |
| Visitor 360 timeline | All `fact_*` | `visitor_id`, `session_id`, `created_at` |
| Raw event replay to CDP | `raw_payloads` | `payload`, `payload_type`, `received_at` |

**Example — visitor timeline for CDP:**
```sql
SELECT visitor_id, session_id, 'page_view' AS event_type, page_path AS detail, created_at
FROM web_tracking.fact_page_views FINAL
WHERE domain_id = {domain_id} AND visitor_id = {visitor_id}
UNION ALL
SELECT visitor_id, session_id, event_name, event_data, created_at
FROM web_tracking.fact_custom_events
WHERE domain_id = {domain_id} AND visitor_id = {visitor_id}
ORDER BY created_at;
```

---

## 8. Notes for CDP team

1. **Time zone:** All `DateTime64` columns are **UTC**. Convert for local reporting in CDP if needed.  
2. **Latest row on dimensions:** Query `dim_visitors FINAL` and `dim_sessions FINAL` for deduplicated profiles.  
3. **TTL:** Fact tables auto-delete after 30–400 days depending on table — plan CDP sync frequency accordingly.  
4. **PII:** `ip_hash` is hashed; raw IP is not stored in facts. Form `field_value` may be masked by SDK.  
5. **Schema migration (planned):** `domain_id` → `website_id`, `domain_name` → `website_url`, new `dim_organizations` — CDP mappings should allow alias fields until migration completes.

---

**Contact:** Web Tracking team for ingest keys, `domain_id` assignment, and CDP `identify()` integration.  
**Source DDL:** `clickhouse/ddl/` in the Web Tracking repository.
