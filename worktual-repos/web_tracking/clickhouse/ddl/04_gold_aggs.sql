CREATE TABLE IF NOT EXISTS web_tracking.agg_web_daily
(
    website_id               UInt32,
    event_date              Date,
    visitors_state          AggregateFunction(uniqExact, String),
    sessions_state          AggregateFunction(uniqExact, String),
    pageviews_state         AggregateFunction(count),
    clicks_state            AggregateFunction(count),
    rage_clicks_state       AggregateFunction(count),
    dead_clicks_state       AggregateFunction(count),
    conversions_state       AggregateFunction(count),
    conversion_value_state  AggregateFunction(sum, Decimal(12, 2)),
    session_duration_state  AggregateFunction(avg, Float64),
    scroll_depth_state      AggregateFunction(avg, Float32),
    bounce_cnt_state        AggregateFunction(sum, UInt64),
    session_cnt_state       AggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (website_id, event_date)
TTL event_date + INTERVAL 3 YEAR DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.agg_page_daily
(
    website_id               UInt32,
    page_path               String,
    event_date              Date,
    views_state             AggregateFunction(count),
    visitors_state          AggregateFunction(uniqExact, String),
    time_on_page_state      AggregateFunction(avg, Float64),
    scroll_depth_state      AggregateFunction(avg, Float32),
    rage_clicks_state       AggregateFunction(count),
    dead_clicks_state       AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (website_id, page_path, event_date)
TTL event_date + INTERVAL 2 YEAR DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.agg_product_daily
(
    website_id               UInt32,
    product_id              String,
    event_date              Date,
    clicks_state            AggregateFunction(count),
    visitors_state          AggregateFunction(uniqExact, String),
    conversions_state       AggregateFunction(count),
    price_state             AggregateFunction(avg, Decimal(12, 2))
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (website_id, product_id, event_date)
TTL event_date + INTERVAL 2 YEAR DELETE
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_web_daily_pageviews
TO web_tracking.agg_web_daily
AS
SELECT
    website_id,
    toDate(created_at) AS event_date,
    uniqExactState(visitor_id) AS visitors_state,
    uniqExactState(session_id) AS sessions_state,
    countState() AS pageviews_state,
    countStateIf(0) AS clicks_state,
    countStateIf(0) AS rage_clicks_state,
    countStateIf(0) AS dead_clicks_state,
    countStateIf(0) AS conversions_state,
    sumState(toDecimal64(0, 2)) AS conversion_value_state,
    avgState(toFloat64(0)) AS session_duration_state,
    avgState(max_scroll_depth) AS scroll_depth_state,
    sumState(toUInt64(0)) AS bounce_cnt_state,
    sumState(toUInt64(0)) AS session_cnt_state
FROM web_tracking.fact_page_views
GROUP BY website_id, event_date;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_web_daily_interactions
TO web_tracking.agg_web_daily
AS
SELECT
    website_id,
    toDate(created_at) AS event_date,
    uniqExactState(visitor_id) AS visitors_state,
    uniqExactState(session_id) AS sessions_state,
    countStateIf(0) AS pageviews_state,
    countStateIf(event_type = 'click') AS clicks_state,
    countStateIf(event_type = 'rage_click') AS rage_clicks_state,
    countStateIf(event_type = 'dead_click') AS dead_clicks_state,
    countStateIf(0) AS conversions_state,
    sumState(toDecimal64(0, 2)) AS conversion_value_state,
    avgState(toFloat64(0)) AS session_duration_state,
    avgState(toFloat32(0)) AS scroll_depth_state,
    sumState(toUInt64(0)) AS bounce_cnt_state,
    sumState(toUInt64(0)) AS session_cnt_state
FROM web_tracking.fact_interaction_events
GROUP BY website_id, event_date;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_web_daily_conversions
TO web_tracking.agg_web_daily
AS
SELECT
    website_id,
    toDate(created_at) AS event_date,
    uniqExactState(visitor_id) AS visitors_state,
    uniqExactState(session_id) AS sessions_state,
    countStateIf(0) AS pageviews_state,
    countStateIf(0) AS clicks_state,
    countStateIf(0) AS rage_clicks_state,
    countStateIf(0) AS dead_clicks_state,
    countState() AS conversions_state,
    sumState(value) AS conversion_value_state,
    avgState(toFloat64(0)) AS session_duration_state,
    avgState(toFloat32(0)) AS scroll_depth_state,
    sumState(toUInt64(0)) AS bounce_cnt_state,
    sumState(toUInt64(0)) AS session_cnt_state
FROM web_tracking.fact_conversion_events
GROUP BY website_id, event_date;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_web_daily_sessions
TO web_tracking.agg_web_daily
AS
SELECT
    website_id,
    toDate(started_at) AS event_date,
    uniqExactState(visitor_id) AS visitors_state,
    uniqExactState(session_id) AS sessions_state,
    countStateIf(0) AS pageviews_state,
    countStateIf(0) AS clicks_state,
    countStateIf(0) AS rage_clicks_state,
    countStateIf(0) AS dead_clicks_state,
    countStateIf(0) AS conversions_state,
    sumState(toDecimal64(0, 2)) AS conversion_value_state,
    avgState(toFloat64(duration_seconds)) AS session_duration_state,
    avgState(toFloat32(0)) AS scroll_depth_state,
    sumState(toUInt64(0)) AS bounce_cnt_state,
    sumState(toUInt64(0)) AS session_cnt_state
FROM web_tracking.dim_sessions
GROUP BY website_id, event_date;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_page_daily
TO web_tracking.agg_page_daily
AS
SELECT
    website_id,
    page_path,
    toDate(created_at) AS event_date,
    countState() AS views_state,
    uniqExactState(visitor_id) AS visitors_state,
    avgState(toFloat64(time_on_page_sec)) AS time_on_page_state,
    avgState(max_scroll_depth) AS scroll_depth_state,
    countStateIf(0) AS rage_clicks_state,
    countStateIf(0) AS dead_clicks_state
FROM web_tracking.fact_page_views
GROUP BY website_id, page_path, event_date;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_product_daily
TO web_tracking.agg_product_daily
AS
SELECT
    website_id,
    product_id,
    toDate(created_at) AS event_date,
    countState() AS clicks_state,
    uniqExactState(visitor_id) AS visitors_state,
    countStateIf(0) AS conversions_state,
    avgState(product_price) AS price_state
FROM web_tracking.fact_product_interactions
GROUP BY website_id, product_id, event_date;
