-- Session bounce metrics (Option C hybrid)
-- Correct pageview_count, duration_seconds, is_bounce per session from fact tables.
-- Replaces batch-scoped dim_sessions.is_bounce (mv_dim_sessions counted events per POST only).
--
-- Live migration (run in order):
--   1) Apply this file
--   2) Run 11b_backfill_session_bounce.sql (historical agg states)
--   3) DROP VIEW web_tracking.mv_dim_sessions;
--   4) Re-create mv_dim_sessions from 05_materialized_views_pipeline.sql (is_bounce=0)
--   5) Optional: run dim_sessions metric sync at bottom of 11b

CREATE TABLE IF NOT EXISTS web_tracking.agg_session_activity
(
    website_id          UInt32,
    session_id          String,
    pageviews_state     AggregateFunction(count),
    activity_min_state  AggregateFunction(min, DateTime64(3, 'UTC')),
    activity_max_state  AggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
ORDER BY (website_id, session_id)
SETTINGS index_granularity = 8192;

-- Source MUST be events_staging (same hop as mv_fact_page_views). ClickHouse does not
-- cascade MVs — fact_page_views inserts do not trigger downstream MVs on that table.
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_session_activity_pageviews
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

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_session_activity_interactions
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

-- Canonical session bounce metrics (query this or join dim_sessions to it).
CREATE VIEW IF NOT EXISTS web_tracking.v_session_bounce AS
SELECT
    website_id,
    session_id,
    countMerge(pageviews_state) AS pageview_count,
    toUInt32(greatest(
        0,
        dateDiff(
            'second',
            minMerge(activity_min_state),
            maxMerge(activity_max_state)
        )
    )) AS duration_seconds,
    toUInt8(
        countMerge(pageviews_state) = 1
        AND greatest(
            0,
            dateDiff(
                'second',
                minMerge(activity_min_state),
                maxMerge(activity_max_state)
            )
        ) < 10
    ) AS is_bounce,
    minMerge(activity_min_state) AS session_started_at
FROM web_tracking.agg_session_activity
GROUP BY website_id, session_id
HAVING pageview_count > 0;
