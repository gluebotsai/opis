-- Recreate pipeline MVs after payload-only user_id (no guest_* synthesis).
-- Prefer the shell wrapper (drops views then applies 05/06/07):
--   bash scripts/recreate_pipeline_mvs_payload_user_id.sh
-- Requires explicit approval before running on live ClickHouse.

-- Step 1: run clickhouse/ddl/19_drop_mvs_user_id.sql
-- Step 2: run clickhouse/ddl/05_materialized_views_pipeline.sql
-- Step 3: run clickhouse/ddl/06_recreate_mv_profile_fix.sql
-- Step 4: run clickhouse/ddl/07_replay_chunks.sql (if present)
