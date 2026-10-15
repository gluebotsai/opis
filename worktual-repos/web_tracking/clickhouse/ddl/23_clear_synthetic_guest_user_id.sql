-- Clear synthetic guest_* / guest+* user_id values; anonymous rows use empty string.
-- Run only after explicit approval:
--   python scripts/apply_clickhouse_manual.py clickhouse/ddl/23_clear_synthetic_guest_user_id.sql
-- Then recreate MVs (scripts/recreate_pipeline_mvs_payload_user_id.sh) and reconcile staging.

ALTER TABLE web_tracking.events_staging
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_page_views
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_interaction_events
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_product_interactions
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_conversion_events
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_form_events
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_custom_events
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_performance_events
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_error_events
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.fact_replay_chunks
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');

ALTER TABLE web_tracking.dim_sessions
    UPDATE user_id = ''
    WHERE startsWith(user_id, 'guest_') OR startsWith(user_id, 'guest+');
