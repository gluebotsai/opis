-- DEPRECATED — DO NOT RUN. Replaced by payload-only user_id (empty for anonymous); see 23_clear_synthetic_guest_user_id.sql.
-- Backfill anonymous rows to synthetic guest user id: guest_{uuid} (no visitor_ prefix)
-- Run only after explicit approval:
--   python scripts/apply_clickhouse_manual.py clickhouse/ddl/20_guest_user_id_backfill.sql

ALTER TABLE web_tracking.events_staging
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;

ALTER TABLE web_tracking.fact_page_views
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;

ALTER TABLE web_tracking.fact_interaction_events
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;

ALTER TABLE web_tracking.fact_product_interactions
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;

ALTER TABLE web_tracking.fact_conversion_events
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;

ALTER TABLE web_tracking.fact_form_events
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;

ALTER TABLE web_tracking.fact_custom_events
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;

ALTER TABLE web_tracking.fact_replay_chunks
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;

ALTER TABLE web_tracking.dim_sessions
    UPDATE user_id = concat('guest_', replaceOne(visitor_id, 'visitor_', ''))
    WHERE length(coalesce(user_id, '')) = 0 AND length(visitor_id) > 0;
