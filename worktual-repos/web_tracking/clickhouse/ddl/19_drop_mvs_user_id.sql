-- Drop materialized views that must be recreated to populate user_id from events_v3 payloads.
-- Run once on live after 19a_user_id_columns.sql, then recreate MVs (see migrate_clickhouse_user_id.sh).

DROP VIEW IF EXISTS web_tracking.mv_dim_known_users;
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
DROP VIEW IF EXISTS web_tracking.mv_session_replay_chunks;
DROP VIEW IF EXISTS web_tracking.mv_parse_events;
