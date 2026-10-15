-- PostgreSQL: read-only grants for ClickHouse dictionary sync (DB team one-time).
-- Run on worktual_bigint @ 10.180.0.126 AFTER postgres/ddl/10_v_web_tracking_ingest_registry.sql
--
-- ClickHouse dict_admin_accounts reloads from public.v_web_tracking_ingest_registry every 15–60s.
-- App ingest validates via dict only — no per-payload Postgres query.
--
-- Required view columns:
--   website_id, website_url, site_type, status, organization_id, is_active

-- CREATE USER ch_sync WITH PASSWORD 'Click1234';
-- GRANT USAGE ON SCHEMA public TO ch_sync;

GRANT SELECT (
    website_id,
    website_url,
    site_type,
    status,
    organization_id,
    is_active
) ON public.v_web_tracking_ingest_registry TO ch_sync;

-- Verify as ch_sync:
-- SELECT website_id, website_url, organization_id, status, is_active
-- FROM public.v_web_tracking_ingest_registry LIMIT 10;
--
-- ClickHouse (after .env CH_DICT_PG_* is set):
--   DROP DICTIONARY IF EXISTS web_tracking.dict_admin_accounts;
--   python scripts/apply_clickhouse_ddl.py --dictionary-only
--   SYSTEM RELOAD DICTIONARY web_tracking.dict_admin_accounts;
--
-- Verify dict loaded:
--   python scripts/verify_dict_admin_accounts.py
