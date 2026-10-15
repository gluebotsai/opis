-- Add user_id to event pipeline tables (events_v3 envelope userId + profiles.visitor.userId).
-- Safe to re-run: IF NOT EXISTS on column add.
-- fact_page_views_deduped: applied only when table exists (see migrate_clickhouse_user_id.sh).

ALTER TABLE web_tracking.events_staging ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_page_views ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_interaction_events ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_form_events ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_conversion_events ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_custom_events ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_product_interactions ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_performance_events ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_error_events ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_cookie_operations ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_heap_snapshots ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.fact_replay_chunks ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
ALTER TABLE web_tracking.session_replay_chunks ADD COLUMN IF NOT EXISTS user_id String DEFAULT '';
