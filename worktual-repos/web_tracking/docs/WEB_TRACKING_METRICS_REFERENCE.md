# Web Tracking Metrics — ClickHouse Field Reference

**Database:** `web_tracking`  
**Scope:** Metrics used for CDP / visitor profiles and web behaviour segmentation.  
**Source:** Read-only review of `clickhouse/ddl/` and `api-node/src/repositories/clickhouse/` (no schema changes).

All timestamps are **UTC** (`DateTime64`). Filter by `website_id` (+ `organization_id` when needed). Use `FINAL` on `ReplacingMergeTree` tables (`dim_visitors`, `dim_sessions`).

**Rolling window for `web_*` metrics:** `_l15` = last **15 calendar days** inclusive (`created_at >= today() - 14 AND created_at < today() + 1`), unless your CDP defines otherwise.

---

## Visitor lifetime metrics

| Metric | Description | How to calculate | Required tables | Required fields | Schema gaps / notes |
|--------|-------------|------------------|-----------------|-----------------|---------------------|
| **total_sessions** | Total number of distinct browsing sessions for the visitor on this website. | `uniqExact(session_id)` grouped by `visitor_id`, `website_id`. | `dim_sessions` | `session_id`, `visitor_id`, `website_id` | `dim_visitors.total_sessions` exists but is **not maintained** by the pipeline (always `0` in MV). **Do not read it directly** — aggregate from `dim_sessions`. |
| **avg_session_duration** | Average length of a session in seconds. | `avg(duration_seconds)` per visitor, **or** `avg(dateDiff('second', min(event_ts), max(event_ts)))` from page views + interactions grouped by `session_id`. | `dim_sessions` **or** `fact_page_views`, `fact_interaction_events` | `duration_seconds`, `session_id`, `visitor_id`, `website_id`, `created_at` | `dim_sessions.duration_seconds` is derived from **event timestamps inside each ingest batch**, not full cross-batch session activity. Dashboard API recomputes duration from `fact_page_views` + `fact_interaction_events` for accuracy. |
| **bounce_rate** | Percentage of sessions with only one page view (bounce). | `round(countIf(is_bounce = 1 AND pageview_count > 0) / countIf(pageview_count > 0) * 100, 2)` per visitor (or site). | `dim_sessions` | `is_bounce`, `pageview_count`, `session_id`, `visitor_id`, `website_id` | Bounce is set when `pageview_count <= 1` per ingest batch in MV. Visitor session API may recompute bounce from `fact_page_views` counts — definitions can differ slightly. |
| **last_entry_page** | Path of the landing page in the visitor's most recent session. | `argMax(entry_page, started_at)` **or** for latest session: `argMin(page_path, created_at)` from page views in that session. | `dim_sessions` **or** `fact_page_views` | `entry_page`, `started_at`, `session_id`, `page_path`, `created_at`, `visitor_id`, `website_id` | `dim_sessions.entry_page` comes from `profiles.session.landingPath` at ingest time. Prefer `fact_page_views.argMin(page_path, created_at)` for fact-based accuracy. |
| **last_exit_page** | Path of the last page viewed in the visitor's most recent session. | `argMax(page_path, created_at)` on `fact_page_views` for the latest `session_id`. | `fact_page_views` | `page_path`, `created_at`, `session_id`, `visitor_id`, `website_id` | `dim_sessions.exit_page` column exists but is **always empty** (`''`) in the MV — **cannot use `dim_sessions.exit_page`**. Must derive from `fact_page_views`. |
| **top_pages_viewed** | Ranked list of pages the visitor viewed most often (e.g. top 5). | `SELECT page_path, count() AS views FROM fact_page_views WHERE visitor_id = ? GROUP BY page_path ORDER BY views DESC LIMIT N`. | `fact_page_views` | `page_path`, `visitor_id`, `website_id`, `created_at` | No dedicated array/map column — **derived aggregate**, not stored on `dim_visitors`. |
| **products_viewed** | Products the visitor engaged with (views/clicks). | `SELECT product_id, product_name, count() … FROM fact_product_interactions WHERE visitor_id = ? GROUP BY product_id, product_name`. Filter views: `section = 'product_page_view'` OR `JSONExtractString(extra_data, 'source') IN ('product_view', 'page_view_fallback')`. | `fact_product_interactions` | `product_id`, `product_name`, `section`, `extra_data`, `visitor_id`, `website_id`, `created_at` | No visitor-level array column — **derived**. View vs click split depends on `section` / `extra_data.source` matching SDK event names. |
| **product_categories_viewed** | Product categories the visitor viewed. | `SELECT DISTINCT product_category FROM fact_product_interactions WHERE visitor_id = ? AND product_category != ''`. | `fact_product_interactions` | `product_category`, `visitor_id`, `website_id`, `created_at` | **Derived** distinct list; empty when SDK does not send category. |
| **conversions_count** | Number of conversion / goal events for the visitor. | `count()` on `fact_conversion_events` per `visitor_id`. | `fact_conversion_events` | `visitor_id`, `website_id`, `conversion_id`, `created_at` | — |
| **total_conversion_value** | Sum of monetary (or scored) conversion value. | `sum(value)` on `fact_conversion_events` per `visitor_id`. | `fact_conversion_events` | `value`, `currency`, `visitor_id`, `website_id`, `created_at` | Use `currency` if multi-currency; no normalised FX column. |
| **last_utm_source** | UTM source on the visitor's most recent attributed session. | `argMax(utm_source, started_at)` from `dim_sessions` for the visitor. | `dim_sessions` | `utm_source`, `started_at`, `session_id`, `visitor_id`, `website_id` | Populated from `profiles.campaign.utm_source` at ingest. Fallback: `fact_page_views.utm_source` or `raw_payloads.payload` → `profiles.campaign`. |
| **last_utm_campaign** | UTM campaign on the most recent session. | `argMax(utm_campaign, started_at)`. | `dim_sessions` | `utm_campaign`, `started_at`, `visitor_id`, `website_id` | Same attribution caveats as `last_utm_source`. |
| **last_device** | Device class from the most recent session (desktop / mobile / tablet). | `argMax(device, started_at)` from `dim_sessions`. | `dim_sessions` | `device`, `started_at`, `visitor_id`, `website_id` | From `profiles.browser.device` at ingest. Fallback: `fact_page_views.device`. |
| **last_country** | Country from the most recent session or event. | `argMax(country, started_at)` from `dim_sessions` **or** `argMax(country, created_at)` from `fact_page_views`. | `dim_sessions` **or** `dim_visitors`, `fact_page_views` | `country`, `started_at` / `created_at`, `visitor_id`, `website_id` | `dim_visitors.country` is last geo from staging at visitor row update. |
| **rage_clicks_count** | Count of rage-click frustration events. | `countIf(event_type = 'rage_click')` on `fact_interaction_events` per visitor. | `fact_interaction_events` | `event_type`, `visitor_id`, `website_id`, `created_at` | Requires SDK to emit `rage_click` events. |
| **days_since_last_visit** | Days between today and the visitor's last activity. | `dateDiff('day', max(last_seen_at), today())` using `dim_visitors.last_seen_at`, **or** `max(created_at)` from `fact_page_views`. | `dim_visitors` **or** `fact_page_views` | `last_seen_at`, `created_at`, `visitor_id`, `website_id` | Prefer `max(created_at)` from facts if `dim_visitors.last_seen_at` is stale. |
| **avg_time_on_page** | Average time spent per page view (seconds). | `avg(time_on_page_sec)` on `fact_page_views` where `time_on_page_sec > 0`, per visitor. | `fact_page_views` | `time_on_page_sec`, `visitor_id`, `website_id`, `created_at` | Depends on SDK sending time-on-page (often from page transition / unload). Zero values should be excluded from avg. |
| **max_scroll_depth** | Maximum scroll depth (0–100) reached by the visitor. | `max(greatest(max_scroll_depth, scroll_depth))` across `fact_page_views.max_scroll_depth` and `fact_interaction_events.scroll_depth` (and optionally `extra_data` JSON milestones). | `fact_page_views`, `fact_interaction_events` | `max_scroll_depth`, `scroll_depth`, `extra_data`, `event_type`, `page_view_id`, `visitor_id`, `website_id` | Join interactions to page views via `page_view_id` for per-page max. Scroll milestone events may also live in `extra_data`. |

---

## Rolling 15-day web metrics (`web_*`)

These are the same KPIs as above but scoped to the **last 15 days** for CDP web-activity segments. There are **no columns named `web_*` in ClickHouse** — compute at query time with a date filter.

| Metric | Description | How to calculate | Required tables | Required fields | Schema gaps / notes |
|--------|-------------|------------------|-----------------|-----------------|---------------------|
| **web_total_sessions** | Distinct sessions in the last 15 days. | `uniqExact(session_id) FROM dim_sessions WHERE started_at >= today()-14 AND started_at < today()+1`. | `dim_sessions` | `session_id`, `started_at`, `visitor_id`, `website_id` | — |
| **web_total_pageviews_l15** | Page views in the last 15 days. | `count() FROM fact_page_views WHERE created_at >= today()-14 AND created_at < today()+1`. | `fact_page_views` | `created_at`, `visitor_id`, `website_id`, `page_view_id` | — |
| **web_clicks** | Standard clicks in the last 15 days. | `countIf(event_type = 'click') FROM fact_interaction_events` with 15-day `created_at` filter. | `fact_interaction_events` | `event_type`, `created_at`, `visitor_id`, `website_id` | — |
| **web_form_submissions** | Form submit events in the last 15 days. | `countIf(event_type = 'form_submit') FROM fact_form_events` with 15-day filter. | `fact_form_events` | `event_type`, `created_at`, `visitor_id`, `website_id`, `form_id` | — |
| **web_avg_session_duration_sec** | Average session duration (seconds) in the last 15 days. | `avg(duration_seconds)` from `dim_sessions` in window, **or** recompute from `fact_page_views` + `fact_interaction_events` min/max timestamps per session (same pattern as dashboard `getOverview`). | `dim_sessions` **or** `fact_page_views`, `fact_interaction_events` | `duration_seconds`, `started_at`, `session_id`, `created_at`, `visitor_id`, `website_id` | Same cross-batch duration caveat as **avg_session_duration**. |
| **web_avg_scroll_depth** | Average scroll depth in the last 15 days. | `avg(max_scroll_depth)` on `fact_page_views` in window (exclude zeros), optionally union with interaction scroll events. | `fact_page_views`, `fact_interaction_events` | `max_scroll_depth`, `scroll_depth`, `created_at`, `visitor_id`, `website_id` | — |
| **web_bounce_rate** | Bounce rate in the last 15 days. | Apply bounce formula on `dim_sessions` with `started_at` in last 15 days: `countIf(is_bounce=1 AND pageview_count>0) / countIf(pageview_count>0) * 100`. | `dim_sessions` | `is_bounce`, `pageview_count`, `started_at`, `session_id`, `visitor_id`, `website_id` | — |

**Optional pre-aggregation:** Gold table `agg_web_daily` holds daily rollups (`sessions_state`, `pageviews_state`, `clicks_state`, `bounce_cnt_state`, `session_duration_state`, `scroll_depth_state`, etc.) but requires `-Merge` combinators (`uniqExactMerge`, `countMerge`, `avgMerge`, `sumMerge`). The dashboard API currently queries silver facts directly, not `agg_web_daily`.

---

## Quick table index (metrics → primary source)

| Table | Metrics supported |
|-------|-------------------|
| `dim_sessions` | total_sessions, avg_session_duration, bounce_rate, last_entry_page, last_utm_source, last_utm_campaign, last_device, last_country, web_total_sessions, web_bounce_rate, web_avg_session_duration_sec |
| `dim_visitors` | days_since_last_visit (last_seen_at), last_country (fallback) — **not** total_sessions/pageviews columns |
| `fact_page_views` | last_exit_page, top_pages_viewed, avg_time_on_page, max_scroll_depth, web_total_pageviews_l15, web_avg_scroll_depth |
| `fact_interaction_events` | rage_clicks_count, web_clicks, max_scroll_depth (supplement) |
| `fact_form_events` | web_form_submissions |
| `fact_conversion_events` | conversions_count, total_conversion_value |
| `fact_product_interactions` | products_viewed, product_categories_viewed |
| `agg_web_daily` | Optional daily rollup for all web_* KPIs (merge states by `event_date`) |

---

## Known schema limitations (read-only audit)

| Issue | Affected metrics | Detail |
|-------|------------------|--------|
| `dim_sessions.exit_page` / `exit_url` not populated | last_exit_page | MV writes `''`. Use `fact_page_views` only. |
| `dim_visitors.total_sessions` / `total_pageviews` not populated | total_sessions (if read from dim) | MV writes `0`. Aggregate from facts/dim_sessions. |
| `dim_sessions.utm_term` / `utm_content` not populated | — (not in your metric list) | Columns exist but MV sets `''`. |
| No stored list columns for pages/products | top_pages_viewed, products_viewed, product_categories_viewed | Must aggregate from fact tables at query time. |
| No `web_*` profile columns | All `web_*` metrics | Computed with 15-day date filter; not materialised on `dim_visitors`. |
| `agg_page_daily.rage_clicks_state` always zero in MV | Page-level rage (not in list) | Page rage must come from `fact_interaction_events`, not gold page agg. |
| Product view classification | products_viewed | Depends on `section` / `extra_data.source` matching SDK `product_view` naming. |

---

## Example — visitor metric bundle (single query pattern)

Filter: `website_id = {id} AND visitor_id = {vid}`.

```sql
-- Sessions & bounce (lifetime)
SELECT
  uniqExact(session_id) AS total_sessions,
  avg(duration_seconds) AS avg_session_duration,
  if(countIf(pageview_count > 0) = 0, 0,
     round(countIf(is_bounce = 1 AND pageview_count > 0) / countIf(pageview_count > 0) * 100, 2)
  ) AS bounce_rate,
  argMax(entry_page, started_at) AS last_entry_page,
  argMax(utm_source, started_at) AS last_utm_source,
  argMax(utm_campaign, started_at) AS last_utm_campaign,
  argMax(device, started_at) AS last_device,
  argMax(country, started_at) AS last_country
FROM dim_sessions FINAL
WHERE website_id = {website_id:UInt32} AND visitor_id = {visitor_id:String};
```

```sql
-- Page & engagement facts (lifetime)
SELECT
  count() AS total_pageviews,
  avgIf(time_on_page_sec, time_on_page_sec > 0) AS avg_time_on_page,
  max(max_scroll_depth) AS max_scroll_depth
FROM fact_page_views
WHERE website_id = {website_id:UInt32} AND visitor_id = {visitor_id:String};
```

```sql
-- Last exit page (cannot use dim_sessions.exit_page)
SELECT argMax(page_path, created_at) AS last_exit_page
FROM fact_page_views
WHERE website_id = {website_id:UInt32} AND visitor_id = {visitor_id:String}
  AND session_id = (
    SELECT argMax(session_id, created_at)
    FROM fact_page_views
    WHERE website_id = {website_id:UInt32} AND visitor_id = {visitor_id:String}
  );
```

---

**Related docs:** [DATABASE_TABLES_RETENTION.md](./DATABASE_TABLES_RETENTION.md), [CLICKHOUSE_CDP_REFERENCE.md](./CLICKHOUSE_CDP_REFERENCE.md)
