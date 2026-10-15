-- Deduplicate page views: one row per (website_id, session_id, page_view_id / pid).
-- Protects metrics when older SDK builds emit duplicate page_view events on the same page.
-- Run manually: python scripts/apply_clickhouse_manual.py clickhouse/ddl/16_fact_page_views_dedupe.sql

DROP VIEW IF EXISTS web_tracking.mv_fact_page_views;

CREATE TABLE IF NOT EXISTS web_tracking.fact_page_views_deduped
(
    page_view_id        String,
    session_id          String,
    visitor_id          String,
    website_id          UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    page_path           String,
    page_title          String DEFAULT '',
    referrer            String DEFAULT '',
    time_on_page_sec    UInt32 DEFAULT 0,
    max_scroll_depth    Float32 DEFAULT 0,
    sdk_version         LowCardinality(String) DEFAULT '',
    device              LowCardinality(String) DEFAULT '',
    country             LowCardinality(String) DEFAULT '',
    utm_source          LowCardinality(String) DEFAULT '',
    utm_medium          LowCardinality(String) DEFAULT '',
    utm_campaign        String DEFAULT '',
    extra_data          String DEFAULT '',
    created_at          DateTime64(3, 'UTC'),
    dedupe_version      Int64 DEFAULT 0
)
ENGINE = ReplacingMergeTree(dedupe_version)
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, session_id, page_view_id)
TTL toDateTime(created_at) + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;

INSERT INTO web_tracking.fact_page_views_deduped
WITH deduped AS (
    SELECT
        page_view_id,
        session_id,
        visitor_id,
        website_id,
        organization_id,
        argMax(user_id, created_at) AS user_id,
        argMin(page_path, created_at) AS page_path,
        argMin(page_title, created_at) AS page_title,
        argMin(referrer, created_at) AS referrer,
        argMin(time_on_page_sec, created_at) AS time_on_page_sec,
        max(max_scroll_depth) AS max_scroll_depth,
        argMin(sdk_version, created_at) AS sdk_version,
        argMin(device, created_at) AS device,
        argMin(country, created_at) AS country,
        argMin(utm_source, created_at) AS utm_source,
        argMin(utm_medium, created_at) AS utm_medium,
        argMin(utm_campaign, created_at) AS utm_campaign,
        argMin(extra_data, created_at) AS extra_data,
        min(created_at) AS first_seen_at
    FROM web_tracking.fact_page_views
    GROUP BY
        page_view_id,
        session_id,
        visitor_id,
        website_id,
        organization_id
)
SELECT
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    page_path,
    page_title,
    referrer,
    time_on_page_sec,
    max_scroll_depth,
    sdk_version,
    device,
    country,
    utm_source,
    utm_medium,
    utm_campaign,
    extra_data,
    first_seen_at AS created_at,
    -toInt64(toUnixTimestamp64Milli(first_seen_at)) AS dedupe_version
FROM deduped;

RENAME TABLE
    web_tracking.fact_page_views TO web_tracking.fact_page_views_legacy_dupes,
    web_tracking.fact_page_views_deduped TO web_tracking.fact_page_views;

CREATE MATERIALIZED VIEW web_tracking.mv_fact_page_views
TO web_tracking.fact_page_views
AS
SELECT
    page_view_id AS page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'pagePath'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'session'), 'landingPath'), ''),
        '/'
    ) AS page_path,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'title'), ''),
        nullIf(JSONExtractString(props_json, 'title'), ''),
        nullIf(JSONExtractString(props_json, 'pageTitle'), ''),
        nullIf(JSONExtractString(props_json, 'pageName'), ''),
        ''
    ) AS page_title,
    coalesce(JSONExtractString(props_json, 'referrer'), '') AS referrer,
    toUInt32(coalesce(JSONExtractUInt(props_json, 'timeOnPage'), 0)) AS time_on_page_sec,
    toFloat32(coalesce(JSONExtractFloat(props_json, 'maxDepth'), JSONExtractFloat(props_json, 'maxScrollDepth'), 0)) AS max_scroll_depth,
    sdk_version,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    country,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_source'), JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'campaign'), 'lastTouch'), 'utm_source'), '') AS utm_source,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_medium'), '') AS utm_medium,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_campaign'), '') AS utm_campaign,
    props_json AS extra_data,
    event_ts AS created_at,
    -toInt64(toUnixTimestamp64Milli(event_ts)) AS dedupe_version
FROM web_tracking.events_staging
WHERE event_name = 'page_view' AND page_view_id != '';
