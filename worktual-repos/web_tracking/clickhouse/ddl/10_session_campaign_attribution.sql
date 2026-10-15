-- Session table: email / campaign attribution from profiles.campaign (lastTouch + flat UTMs).
-- Run on live ClickHouse after backup. Re-run safe: IF NOT EXISTS on columns.
--
--   1) Add columns (below)
--   2) DROP VIEW web_tracking.mv_dim_sessions;
--   3) Re-apply mv_dim_sessions from clickhouse/ddl/05_materialized_views_pipeline.sql
--      (or run scripts/apply_clickhouse_ddl.py after updating 05 — MV must be recreated manually on live)

ALTER TABLE web_tracking.dim_sessions
    ADD COLUMN IF NOT EXISTS wt_organization_id Nullable(UInt64);

ALTER TABLE web_tracking.dim_sessions
    ADD COLUMN IF NOT EXISTS wt_campaign_id Nullable(UInt64);

ALTER TABLE web_tracking.dim_sessions
    ADD COLUMN IF NOT EXISTS wt_contact_id Nullable(UInt64);

-- Live only (after ALTER):
-- DROP VIEW IF EXISTS web_tracking.mv_dim_sessions;
-- Then paste CREATE MATERIALIZED VIEW mv_dim_sessions from 05_materialized_views_pipeline.sql
