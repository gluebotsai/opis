-- DEPRECATED — DO NOT RUN. Replaced by payload-only user_id; see 23_clear_synthetic_guest_user_id.sql.
-- Rename synthetic guest ids: guest+visitor_{uuid} → guest_{uuid}
-- Run after explicit approval:
--   python scripts/apply_clickhouse_manual.py clickhouse/ddl/22_guest_user_id_format.sql

ALTER TABLE web_tracking.events_staging
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_page_views
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_interaction_events
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_product_interactions
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_conversion_events
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_form_events
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_custom_events
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_replay_chunks
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.dim_sessions
    UPDATE user_id = replaceOne(user_id, 'guest+visitor_', 'guest_')
    WHERE startsWith(user_id, 'guest+visitor_');

-- Rows that were backfilled as guest+{full visitor_id} (legacy 20 script)
ALTER TABLE web_tracking.events_staging
    UPDATE user_id = concat('guest_', replaceOne(user_id, 'guest+', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_page_views
    UPDATE user_id = concat('guest_', replaceOne(replaceOne(user_id, 'guest+', ''), 'visitor_', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_interaction_events
    UPDATE user_id = concat('guest_', replaceOne(replaceOne(user_id, 'guest+', ''), 'visitor_', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_product_interactions
    UPDATE user_id = concat('guest_', replaceOne(replaceOne(user_id, 'guest+', ''), 'visitor_', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_conversion_events
    UPDATE user_id = concat('guest_', replaceOne(replaceOne(user_id, 'guest+', ''), 'visitor_', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_form_events
    UPDATE user_id = concat('guest_', replaceOne(replaceOne(user_id, 'guest+', ''), 'visitor_', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_custom_events
    UPDATE user_id = concat('guest_', replaceOne(replaceOne(user_id, 'guest+', ''), 'visitor_', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.fact_replay_chunks
    UPDATE user_id = concat('guest_', replaceOne(replaceOne(user_id, 'guest+', ''), 'visitor_', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');

ALTER TABLE web_tracking.dim_sessions
    UPDATE user_id = concat('guest_', replaceOne(replaceOne(user_id, 'guest+', ''), 'visitor_', ''))
    WHERE startsWith(user_id, 'guest+') AND NOT startsWith(user_id, 'guest+visitor_');
