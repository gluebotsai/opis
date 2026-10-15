-- Drop unused raw_payloads pipeline stub columns.
-- These were never populated: ingest always wrote NULL / 0 / '' and no worker updates them.
-- Processing is synchronous via materialized views on INSERT (no async retry queue).
--
-- Apply on existing servers AFTER deploying ingest code that no longer inserts these columns:
--   clickhouse-client ... --multiquery < clickhouse/ddl/13_drop_raw_payloads_pipeline_stubs.sql

ALTER TABLE web_tracking.raw_payloads DROP COLUMN IF EXISTS processed_at;
ALTER TABLE web_tracking.raw_payloads DROP COLUMN IF EXISTS retry_count;
ALTER TABLE web_tracking.raw_payloads DROP COLUMN IF EXISTS error_message;
