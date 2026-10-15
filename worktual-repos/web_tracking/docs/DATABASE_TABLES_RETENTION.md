# Worktual Web Analytics — Database Reference

**For:** Engineering, analytics, and AI chat teams  
**ClickHouse:** `web_tracking`  
**PostgreSQL:** `web_analytics`  
**Last updated:** 2026-08-18

---

## Live production ClickHouse

| Setting | Value |
|---------|-------|
| Host | `10.180.0.126` |
| Port | `8123` |
| Database | `web_tracking` |
| User | `default` |

The live server also has legacy CDP databases (`bronze`, `silver`, `gold`, `dim`) used by other systems. **This app uses only `web_tracking`** — a parallel schema created from local DDL. Legacy databases are never modified by the web analytics pipeline.

Set `CLICKHOUSE_*` in your local `.env` to point at live when ready (store the password in `.env` only — never commit it).

Schema migration: `python scripts/apply_clickhouse_ddl.py` (create-only; skips destructive `06_recreate_mv_profile_fix.sql`).

---

## Overview

| Store | Role |
|-------|------|
| **PostgreSQL** | Login accounts and registered websites only |
| **ClickHouse** | All tracking data — events, sessions, visitors, daily KPIs |

**Tenant key:** Every analytics query must include `WHERE domain_id = ?`

**Naming convention:**

| Prefix | Meaning |
|--------|---------|
| `dim_` | One row per entity (visitor, session) |
| `fact_` | One row per event (page view, click, error) |
| `agg_` | Pre-calculated daily metrics |
| `mv_` | Internal pipeline (do not query) |

---

# PostgreSQL Tables

---

## `admin_accounts` (single auth + site table)

| | |
|---|---|
| **Retention** | Permanent (no TTL) |
| **Used by** | Dashboard login (API reads Postgres); ingest domain check via ClickHouse dictionary |

**Purpose**

One row = one dashboard admin **and** their tracked website. Holds login credentials plus site config (`domain_id`, `domain_name`, `site_type`, `status`). Optional `organization_id` (UUID) is stamped into ingest payloads for ClickHouse analytics when set.

**Key fields:** `email`, `password_hash`, `domain_id`, `domain_name`, `site_type`, `status`, `organization_id`, `is_active`

**Demo login:** `admin@worktual.co.uk` / `admin123` · domain **12345**

---

# ClickHouse Tables

---

## Bronze Layer

---

### `raw_payloads`

| | |
|---|---|
| **Retention** | 90 days |
| **TTL column** | `received_at` |
| **Queryable** | No — internal only |

**Purpose**

Stores the **exact JSON** the SDK sends on each HTTP POST. One row = one SDK batch (which may contain many events inside an `events[]` array).

This is the **source of truth for ingest**. Materialized views read from here and split events into `events_staging`, then into fact and dimension tables.

**Why keep only 90 days:** Raw JSON is large. Processed facts in `fact_*` tables hold the useful analytics data longer.

**Key fields:** `payload_id` (UUID, dedup key), `domain_id`, `visitor_id`, `payload` (full JSON string), `received_at`

---

## Pipeline Layer

---

### `events_staging`

| | |
|---|---|
| **Retention** | No TTL currently |
| **TTL column** | `received_at` (recommended: 90 days) |
| **Queryable** | No — internal only |

**Purpose**

**Parsed events table.** When a batch lands in `raw_payloads`, the `mv_parse_events` view splits the `events[]` array so **each event becomes one row**.

Also carries shared context from the batch:
- `profiles_json` — browser, pages, session, campaign profiles (v3 SDK)
- `props_json` — event-specific properties (click coordinates, scroll depth, etc.)

All `fact_*` materialized views read from here. This avoids re-parsing JSON in every downstream view.

**Does NOT deduplicate events.** Batch-level dedup happens at ingest via `payload_id`.

**Key fields:** `event_id`, `event_name`, `event_ts`, `session_id`, `visitor_id`, `page_view_id`, `props_json`, `profiles_json`

---

## Dimension Layer

Query these with **`FINAL`** to get deduplicated rows (except `dict_admin_accounts`, which is a dictionary).

---

### `dict_admin_accounts` (dictionary — not a table)

| | |
|---|---|
| **Retention** | In-memory; full reload from PostgreSQL every 15–60 seconds |
| **Queryable** | No (internal — use `dictGet` in ingest only) |
| **Source** | PostgreSQL `public.admin_accounts` (column-level SELECT via `ch_sync`) |

**Purpose**

Cached copy of registered domains for ingest validation. When DB team updates `admin_accounts` in Postgres, ClickHouse picks up changes on the next dictionary reload (not row-level CDC).

**Key fields:** `domain_id` (PK), `domain_name`, `status`, `is_active`, `organization_id`, `site_type`

Setup: [`postgres/ddl/README.md`](../postgres/ddl/README.md)

---

### `dim_visitors`

| | |
|---|---|
| **Retention** | Permanent (no TTL) |
| **Queryable** | Yes — `dim_visitors FINAL` |
| **Used by** | Visitors page, visitor detail, AI chat |

**Purpose**

**One row per unique visitor per website.** A visitor is an anonymous browser identified by `visitor_id` from the SDK (stored in localStorage/cookies).

Tracks lifetime stats: how many sessions and pageviews this person has had, when they were first and last seen, and their country.

**Example use:** "Show me all visitors who visited more than 3 times" or "List visitors from GB."

**Key fields:** `visitor_id`, `domain_id`, `first_seen_at`, `last_seen_at`, `total_sessions`, `total_pageviews`, `country`

---

### `dim_sessions`

| | |
|---|---|
| **Retention** | 400 days |
| **TTL column** | `started_at` |
| **Queryable** | Yes — `dim_sessions FINAL` |
| **Used by** | Dashboard overview, sessions page, visitor detail, AI chat |

**Purpose**

**One row per browsing session.** A session starts when a visitor opens the site and ends after inactivity timeout (SDK-managed).

This is the main table for **session-level analytics**: bounce rate, average session duration, traffic sources (UTM, referrer), device/browser breakdown, entry and exit pages.

**Example use:** "What is the bounce rate this week?" or "Which UTM campaign drove the most sessions?"

**Key fields:** `session_id`, `visitor_id`, `started_at`, `duration_seconds`, `pageview_count`, `is_bounce`, `entry_page`, `exit_page`, `utm_source`, `utm_medium`, `utm_campaign`, `referrer`, `browser`, `device`, `country`

---

### `dim_domains`

| | |
|---|---|
| **Retention** | Permanent (no TTL) |
| **Queryable** | No |

**Purpose**

ClickHouse copy of site metadata synced from ingest payloads. The **authoritative** site registry is PostgreSQL `admin_accounts` (via `dict_admin_accounts` dictionary for ingest).

**`organization_id`:** When set on `admin_accounts`, ingest adds `organizationId` to the raw JSON payload; materialized views copy it into fact/dimension rows. If unset, ClickHouse stores `NULL` (or zero UUID on `dim_domains`).

---

## Fact Layer

Query on `created_at` for time filters. Always filter `domain_id`.

---

### `fact_page_views`

| | |
|---|---|
| **Retention** | 180 days |
| **TTL column** | `created_at` |
| **Queryable** | Yes |
| **Used by** | Dashboard, top pages, visitor journey, AI chat |

**Purpose**

**One row per page load.** Every time a visitor opens or navigates to a page, the SDK sends a `page_view` event and it lands here.

Core table for **content analytics**: which pages are popular, time on page, scroll depth per page, traffic by page path.

**Example use:** "Top 10 pages this month" or "Average scroll depth on /pricing."

**Key fields:** `page_view_id`, `page_path`, `page_title`, `time_on_page_sec`, `max_scroll_depth`, `referrer`, `utm_source`

---

### `fact_interaction_events`

| | |
|---|---|
| **Retention** | 90 days |
| **TTL column** | `created_at` |
| **Queryable** | Yes |
| **Used by** | Behavior page, heatmaps, visitor detail, AI chat |

**Purpose**

**One row per user interaction on the page:** clicks, mouse movements, scroll milestones, rage clicks (repeated fast clicks), dead clicks (clicks on non-interactive elements).

This is the **heatmap data source**. Stores pixel coordinates (`x_coord`, `y_coord`), viewport size, and DOM element info.

**Example use:** "Show click heatmap on /home" or "How many rage clicks happened today?"

**Key fields:** `event_id`, `event_type` (click/move/scroll/rage_click/dead_click), `x_coord`, `y_coord`, `viewport_w`, `viewport_h`, `element`, `page_path`

---

### `fact_form_events`

| | |
|---|---|
| **Retention** | 180 days |
| **TTL column** | `created_at` |
| **Queryable** | Yes |
| **Used by** | Forms analytics, AI chat |

**Purpose**

**One row per form interaction:** form viewed, field focused, field changed, validation error, submit attempted, submit success, form abandoned.

Used for **form funnel analysis** — where users drop off in multi-step forms or contact forms.

**Example use:** "How many contact form submissions this week?" or "Which field causes the most validation errors?"

**Key fields:** `event_type`, `form_id`, `form_name`, `field_name`, `page_path`

---

### `fact_conversion_events`

| | |
|---|---|
| **Retention** | 400 days |
| **TTL column** | `created_at` |
| **Queryable** | Yes |
| **Used by** | Dashboard conversions, visitor detail, AI chat |

**Purpose**

**One row per conversion goal completed:** purchase, signup, demo request, or any custom goal the SDK tracks.

Kept longer (400 days) because conversion data is valuable for ROI and campaign reporting.

**Example use:** "Total conversions this month" or "Conversion value by product."

**Key fields:** `conversion_type`, `product_id`, `value`, `currency`, `session_id`, `visitor_id`

---

### `fact_product_interactions`

| | |
|---|---|
| **Retention** | 180 days |
| **TTL column** | `created_at` |
| **Queryable** | Yes |
| **Used by** | Product analytics (ecommerce sites), AI chat |

**Purpose**

**One row per e-commerce product interaction:** product page view, product click, add to cart, product impression in a listing.

Used on **ecommerce domains** (`site_type = ecommerce`) for product performance reporting.

**Example use:** "Most viewed products" or "Product click-to-conversion rate."

**Key fields:** `product_id`, `product_name`, `product_price`, `product_category`, `section`, `page_path`

---

### `fact_custom_events`

| | |
|---|---|
| **Retention** | 180 days |
| **TTL column** | `created_at` |
| **Queryable** | Yes |
| **Used by** | Custom events report, session replay, AI chat |

**Purpose**

**One row per custom SDK event** sent via `WorktualAnalytics.track('event_name', {...})`. Also stores session replay chunk references.

Used when the standard event types (page view, click, form) are not enough and the customer tracks business-specific actions.

**Example use:** "How many times was 'demo_requested' tracked?" or "List custom events for this visitor."

**Key fields:** `event_name`, `event_data` (JSON string), `session_id`, `visitor_id`

---

### `fact_performance_events`

| | |
|---|---|
| **Retention** | 90 days |
| **TTL column** | `created_at` |
| **Queryable** | Yes |
| **Used by** | Performance page, AI chat |

**Purpose**

**One row per web performance measurement:** Core Web Vitals (LCP, FCP, CLS, INP) and navigation timing metrics.

Used to monitor **site speed and user experience quality** per page.

**Example use:** "What is the P95 LCP for /home?" or "Pages with poor CLS rating."

**Key fields:** `metric_name`, `metric_value`, `rating` (good/needs-improvement/poor), `page_path`

---

### `fact_error_events`

| | |
|---|---|
| **Retention** | 90 days |
| **TTL column** | `created_at` |
| **Queryable** | Yes |
| **Used by** | Errors page, AI chat |

**Purpose**

**One row per JavaScript error** captured in the visitor's browser. Includes error message, stack trace, page path, and browser info.

Used for **front-end quality monitoring** — finding broken scripts or UI issues affecting real users.

**Example use:** "Top 10 JS errors this week" or "Errors on /checkout page."

**Key fields:** `error_type`, `message`, `stack`, `page_path`, `browser`

---

### `fact_cookie_operations`

| | |
|---|---|
| **Retention** | 60 days |
| **TTL column** | `created_at` |
| **Queryable** | No — not wired to dashboard |

**Purpose**

Debug table for cookie consent and cookie read/write/delete operations. Reserved for future privacy/compliance features. Not currently exposed in the dashboard.

---

### `fact_heap_snapshots`

| | |
|---|---|
| **Retention** | 30 days |
| **TTL column** | `created_at` |
| **Queryable** | No — not wired to dashboard |

**Purpose**

Debug table for browser memory usage snapshots. Short retention because data is large and only useful for performance debugging.

---

## Gold Layer (Daily Aggregates)

Use `countMerge()`, `uniqExactMerge()`, `avgMerge()` on `*_state` columns.

---

### `agg_web_daily`

| | |
|---|---|
| **Retention** | 3 years |
| **TTL column** | `event_date` |
| **Queryable** | Yes |
| **Used by** | Long-term trends, AI chat |

**Purpose**

**One row per site per day** with pre-calculated KPIs: unique visitors, sessions, pageviews, clicks, conversions, bounce rate, average session duration, average scroll depth.

Best table for **long date-range trends** because fact tables may have shorter TTL. Kept for 3 years.

**Example use:** "Daily visitor trend for last 12 months" or "Compare pageviews week over week."

---

### `agg_page_daily`

| | |
|---|---|
| **Retention** | 2 years |
| **TTL column** | `event_date` |
| **Queryable** | Yes |
| **Used by** | Page trend reports, AI chat |

**Purpose**

**One row per page path per day:** views, unique visitors, average time on page, scroll depth, rage/dead clicks.

Faster than querying `fact_page_views` for daily page-level trends over long periods.

---

### `agg_product_daily`

| | |
|---|---|
| **Retention** | 2 years |
| **TTL column** | `event_date` |
| **Queryable** | Yes |
| **Used by** | Product trend reports, AI chat |

**Purpose**

**One row per product per day:** clicks, unique visitors, conversions, average price.

E-commerce daily product performance without scanning raw product interaction events.

---

# Pipeline Tables (Do Not Query)

These run automatically. Listed here so the team knows they exist.

| View | Reads from | Writes to | What it does |
|------|-----------|-----------|--------------|
| `mv_parse_events` | `raw_payloads` | `events_staging` | Splits JSON events array into individual rows |
| `mv_fact_page_views` | `events_staging` | `fact_page_views` | Filters page_view events into fact table |
| `mv_fact_interactions` | `events_staging` | `fact_interaction_events` | Filters click/scroll events |
| `mv_fact_form_events` | `events_staging` | `fact_form_events` | Filters form events |
| `mv_fact_performance` | `events_staging` | `fact_performance_events` | Filters web vitals |
| `mv_fact_errors` | `events_staging` | `fact_error_events` | Filters JS errors |
| `mv_fact_product` | `events_staging` | `fact_product_interactions` | Filters product events |
| `mv_fact_conversions` | `events_staging` | `fact_conversion_events` | Filters conversion events |
| `mv_fact_custom` | `events_staging` | `fact_custom_events` | Filters custom track() events |
| `mv_dim_visitors` | `events_staging` | `dim_visitors` | Updates visitor profiles |
| `mv_dim_sessions` | `raw_payloads` | `dim_sessions` | Builds session rows from batch |
| `mv_dim_domains` | `raw_payloads` | `dim_domains` | Syncs domain metadata |
| `mv_agg_*` | fact/dim tables | `agg_*` | Rolls up daily KPIs |

---

# Quick Reference

## Retention at a glance

| Retention | Tables |
|-----------|--------|
| 30 days | `fact_heap_snapshots` |
| 60 days | `fact_cookie_operations` |
| 90 days | `raw_payloads`, `fact_interaction_events`, `fact_performance_events`, `fact_error_events` |
| 180 days | `fact_page_views`, `fact_form_events`, `fact_custom_events`, `fact_product_interactions` |
| 400 days | `dim_sessions`, `fact_conversion_events` |
| 2 years | `agg_page_daily`, `agg_product_daily` |
| 3 years | `agg_web_daily` |
| Permanent | PostgreSQL tables, `dim_visitors`, `dim_domains` |

## Who queries what

| Team / Service | Tables |
|----------------|--------|
| **Dashboard API** | `dim_* FINAL`, `fact_*`, `agg_*` |
| **AI Chat LLM** | Same as dashboard (see `AI_CHAT/app/schema/registry.py`) |
| **Ingest API** | PostgreSQL only (domain check) |
| **Pipeline MVs** | `raw_payloads`, `events_staging` (automatic) |

## Time filter cheat sheet

| Question type | Table | Filter column |
|---------------|-------|---------------|
| Sessions this week | `dim_sessions FINAL` | `started_at` |
| Page views today | `fact_page_views` | `created_at` |
| Clicks on a page | `fact_interaction_events` | `created_at` |
| Daily trend last year | `agg_web_daily` | `event_date` |
| Visitor lifetime | `dim_visitors FINAL` | `first_seen_at` / `last_seen_at` |

## Data flow

```
SDK → Ingest → raw_payloads → events_staging → fact_* / dim_*
                                              → dim_sessions
                                              → agg_* (daily rollups)
                                                      ↓
                                            Dashboard + AI Chat
```

---

# DDL Files

| File | Contents |
|------|----------|
| `clickhouse/ddl/01_bronze.sql` | `raw_payloads` |
| `clickhouse/ddl/02_auth_and_dim.sql` | Dimensions |
| `clickhouse/ddl/03_silver_facts.sql` | All fact tables |
| `clickhouse/ddl/04_gold_aggs.sql` | Daily aggregates |
| `clickhouse/ddl/05_materialized_views_pipeline.sql` | Staging + MVs |
| `api-node/prisma/schema.prisma` | PostgreSQL auth |

Apply: `python scripts/apply_clickhouse_ddl.py`
