-- One-time migration: domain_id/domain_name → website_id/website_url, organization_id UUID → UInt32
-- Run on live ClickHouse AFTER backing up. Re-create MVs after column renames.
-- Postgres admin_accounts keeps domain_id/domain_name columns (same values as website_id/website_url).

-- Bronze
ALTER TABLE web_tracking.raw_payloads RENAME COLUMN domain_id TO website_id;
ALTER TABLE web_tracking.raw_payloads RENAME COLUMN domain_name TO website_url;

-- Dimensions
RENAME TABLE web_tracking.dim_domains TO web_tracking.dim_websites;
ALTER TABLE web_tracking.dim_websites RENAME COLUMN domain_id TO website_id;
ALTER TABLE web_tracking.dim_websites RENAME COLUMN domain_name TO website_url;
ALTER TABLE web_tracking.dim_websites MODIFY COLUMN organization_id UInt32 DEFAULT 0;

ALTER TABLE web_tracking.dim_visitors RENAME COLUMN domain_id TO website_id;
ALTER TABLE web_tracking.dim_visitors MODIFY COLUMN organization_id Nullable(UInt32);

ALTER TABLE web_tracking.dim_sessions RENAME COLUMN domain_id TO website_id;
ALTER TABLE web_tracking.dim_sessions MODIFY COLUMN organization_id Nullable(UInt32);

-- Staging
ALTER TABLE web_tracking.events_staging RENAME COLUMN domain_id TO website_id;
ALTER TABLE web_tracking.events_staging RENAME COLUMN domain_name TO website_url;
ALTER TABLE web_tracking.events_staging MODIFY COLUMN organization_id Nullable(UInt32);

-- Facts (rename domain_id → website_id, org UUID → UInt32)
-- Apply per table; organization_id type change requires DROP MVs first on live systems.

-- Replay
ALTER TABLE web_tracking.fact_replay_chunks RENAME COLUMN domain_id TO website_id;
ALTER TABLE web_tracking.fact_replay_chunks MODIFY COLUMN organization_id Nullable(UInt32);

-- After renames, drop old MVs and re-apply:
--   05_materialized_views_pipeline.sql
--   06_recreate_mv_profile_fix.sql
--   07_replay_chunks.sql
--   04_gold_aggs.sql (MV sections)

-- Dictionary: reload after Postgres organization_id is INTEGER
-- SYSTEM RELOAD DICTIONARY web_tracking.dict_admin_accounts;
