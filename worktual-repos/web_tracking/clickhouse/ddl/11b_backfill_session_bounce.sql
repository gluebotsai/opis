# One-time backfill for agg_session_activity (run after 11_session_bounce_metrics.sql).
# Safe to re-run: AggregatingMergeTree merges duplicate keys.
# Prefer events_staging (matches MV source). Use 11c_fix_session_activity_mv_source.sql on
# live clusters that had fact_*-sourced MVs (broken cascade + double-count risk).
# NOT applied by scripts/apply_clickhouse_ddl.py — run manually on ClickHouse.

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

-- Optional: sync corrected metrics into dim_sessions (ReplacingMergeTree keeps latest updated_at).
-- Uncomment and run after backfill above if legacy queries still read dim_sessions.is_bounce.

-- INSERT INTO web_tracking.dim_sessions
-- SELECT
--     s.session_id,
--     s.visitor_id,
--     s.website_id,
--     s.organization_id,
--     s.user_id,
--     s.started_at,
--     s.ended_at,
--     b.duration_seconds,
--     s.entry_page,
--     s.exit_page,
--     s.entry_url,
--     s.exit_url,
--     b.pageview_count,
--     b.is_bounce,
--     s.referrer,
--     s.referrer_domain,
--     s.utm_source,
--     s.utm_medium,
--     s.utm_campaign,
--     s.utm_term,
--     s.utm_content,
--     s.wt_organization_id,
--     s.wt_campaign_id,
--     s.wt_contact_id,
--     s.user_agent,
--     s.language,
--     s.platform,
--     s.browser,
--     s.browser_version,
--     s.device,
--     s.screen_width,
--     s.screen_height,
--     s.country,
--     s.city,
--     s.region,
--     s.latitude,
--     s.longitude,
--     s.ip_hash,
--     s.geo_data,
--     s.sdk_version,
--     s.created_at,
--     now64(3) AS updated_at
-- FROM web_tracking.dim_sessions AS s FINAL
-- INNER JOIN web_tracking.v_session_bounce AS b
--     ON b.website_id = s.website_id AND b.session_id = s.session_id;
