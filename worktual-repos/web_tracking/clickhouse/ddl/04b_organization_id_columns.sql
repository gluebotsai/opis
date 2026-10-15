-- Add organization_id to tables created before this column existed on live servers.
-- Safe to re-run: IF NOT EXISTS on column add.

ALTER TABLE web_tracking.events_staging
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.fact_page_views
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.fact_interaction_events
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.fact_form_events
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.fact_conversion_events
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.fact_custom_events
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.fact_product_interactions
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.fact_performance_events
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.fact_error_events
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.dim_visitors
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.dim_sessions
    ADD COLUMN IF NOT EXISTS organization_id Nullable(UInt32);

ALTER TABLE web_tracking.dim_websites
    ADD COLUMN IF NOT EXISTS organization_id UInt32 DEFAULT 0;
