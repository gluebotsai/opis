-- Fix session bounce pipeline: MVs must read events_staging, NOT fact_* tables.
--
-- ClickHouse does not cascade MVs. Inserts into fact_page_views (via mv_fact_page_views)
-- do NOT trigger mv_agg_session_activity_pageviews when it reads FROM fact_page_views.
-- Both fact MVs and agg MVs must attach to the same source: events_staging.
--
-- Run once on live (rebuilds derived agg table):
--   python scripts/apply_clickhouse_manual.py clickhouse/ddl/11c_fix_session_activity_mv_source.sql
--
-- Safe to re-run: TRUNCATE + backfill restores agg_session_activity from staging history.

DROP VIEW IF EXISTS web_tracking.mv_agg_session_activity_pageviews;
DROP VIEW IF EXISTS web_tracking.mv_agg_session_activity_interactions;

TRUNCATE TABLE web_tracking.agg_session_activity;

CREATE MATERIALIZED VIEW web_tracking.mv_agg_session_activity_pageviews
TO web_tracking.agg_session_activity
AS
SELECT
    website_id,
    session_id,
    countState() AS pageviews_state,
    minState(event_ts) AS activity_min_state,
    maxState(event_ts) AS activity_max_state
FROM web_tracking.events_staging
WHERE event_name = 'page_view' AND page_view_id != ''
GROUP BY website_id, session_id;

CREATE MATERIALIZED VIEW web_tracking.mv_agg_session_activity_interactions
TO web_tracking.agg_session_activity
AS
SELECT
    website_id,
    session_id,
    countStateIf(0) AS pageviews_state,
    minState(event_ts) AS activity_min_state,
    maxState(event_ts) AS activity_max_state
FROM web_tracking.events_staging
WHERE event_name IN ('click', 'move', 'scroll', 'scroll_depth', 'rage_click', 'dead_click', 'hover')
GROUP BY website_id, session_id;

INSERT INTO web_tracking.agg_session_activity
SELECT
    website_id,
    session_id,
    countState() AS pageviews_state,
    minState(event_ts) AS activity_min_state,
    maxState(event_ts) AS activity_max_state
FROM web_tracking.events_staging
WHERE event_name = 'page_view' AND page_view_id != ''
GROUP BY website_id, session_id;

INSERT INTO web_tracking.agg_session_activity
SELECT
    website_id,
    session_id,
    countStateIf(0) AS pageviews_state,
    minState(event_ts) AS activity_min_state,
    maxState(event_ts) AS activity_max_state
FROM web_tracking.events_staging
WHERE event_name IN ('click', 'move', 'scroll', 'scroll_depth', 'rage_click', 'dead_click', 'hover')
GROUP BY website_id, session_id;
