-- Drop materialized views that must be recreated so organization_id is extracted from payloads.
-- Run once on live after 04b_organization_id_columns.sql, then:
--   1) clickhouse/ddl/05_materialized_views_pipeline.sql
--   2) clickhouse/ddl/06_recreate_mv_profile_fix.sql
--   3) clickhouse/ddl/07_replay_chunks.sql (if replay is enabled)
--   4) clickhouse/ddl/12b_backfill_organization_id.sql (backfill historical NULL rows)
-- Or run: bash scripts/migrate_clickhouse_organization_id.sh
--
-- Why: CREATE MATERIALIZED VIEW IF NOT EXISTS keeps an old definition on live servers
-- that never populated organization_id on events_staging / fact / dim tables.

DROP VIEW IF EXISTS web_tracking.mv_dim_visitors;
DROP VIEW IF EXISTS web_tracking.mv_fact_page_views;
DROP VIEW IF EXISTS web_tracking.mv_fact_interactions;
DROP VIEW IF EXISTS web_tracking.mv_fact_form_events;
DROP VIEW IF EXISTS web_tracking.mv_fact_performance;
DROP VIEW IF EXISTS web_tracking.mv_fact_errors;
DROP VIEW IF EXISTS web_tracking.mv_fact_conversions;
DROP VIEW IF EXISTS web_tracking.mv_fact_custom;
DROP VIEW IF EXISTS web_tracking.mv_fact_product;
DROP VIEW IF EXISTS web_tracking.mv_dim_sessions;
DROP VIEW IF EXISTS web_tracking.mv_dim_websites;
DROP VIEW IF EXISTS web_tracking.mv_fact_replay_chunks;
DROP VIEW IF EXISTS web_tracking.mv_parse_events;
