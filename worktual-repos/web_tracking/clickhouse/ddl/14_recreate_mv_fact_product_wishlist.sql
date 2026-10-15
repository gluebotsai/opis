-- Recreate product-interaction MV so add_to_wishlist / remove_from_wishlist / begin_checkout
-- flow into fact_product_interactions (Product Analytics KPIs).
--
-- WHEN TO RUN: Ingest payloads show wishlist events but dashboard wishlist KPIs stay 0.
-- CAUSE: mv_fact_product was created before wishlist was added to the WHERE filter
--        (CREATE IF NOT EXISTS does not alter an existing MV).
--
-- Run manually on QA/prod (NOT via apply_clickhouse_ddl.py — contains DROP VIEW):
--   clickhouse-client --multiquery < clickhouse/ddl/14_recreate_mv_fact_product_wishlist.sql
--
-- Safe: only drops/recreates MVs; fact tables are unchanged. New events route correctly
-- after step 1. Optional step 2 backfills recent staging rows.

-- 1) Recreate product MV (includes wishlist + begin_checkout)
DROP VIEW IF EXISTS web_tracking.mv_fact_product;

CREATE MATERIALIZED VIEW web_tracking.mv_fact_product
TO web_tracking.fact_product_interactions
AS
SELECT
    event_id AS interaction_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    coalesce(JSONExtractString(props_json, 'productId'), JSONExtractString(props_json, 'sku'), 'unknown') AS product_id,
    coalesce(JSONExtractString(props_json, 'productName'), JSONExtractString(props_json, 'name'), '') AS product_name,
    coalesce(JSONExtractString(props_json, 'productCategory'), JSONExtractString(props_json, 'category'), '') AS product_category,
    toDecimal64(coalesce(JSONExtractFloat(props_json, 'productPrice'), JSONExtractFloat(props_json, 'price'), 0), 2) AS product_price,
    coalesce(JSONExtractString(props_json, 'currency'), 'USD') AS currency,
    coalesce(JSONExtractString(props_json, 'sku'), '') AS product_sku,
    coalesce(JSONExtractString(props_json, 'brand'), '') AS product_brand,
    event_name AS section,
    toFloat32(0) AS scroll_depth,
    toUInt32(0) AS time_on_page_sec,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    country,
    props_json AS extra_data,
    event_ts AS created_at
FROM web_tracking.events_staging
WHERE event_name IN (
    'product_view',
    'add_to_cart',
    'remove_from_cart',
    'add_to_wishlist',
    'remove_from_wishlist',
    'begin_checkout'
);

-- 2) Recreate custom-events MV so wishlist is excluded (avoid duplicate routing)
DROP VIEW IF EXISTS web_tracking.mv_fact_custom;

CREATE MATERIALIZED VIEW web_tracking.mv_fact_custom
TO web_tracking.fact_custom_events
AS
SELECT
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    event_name,
    props_json AS event_data,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    country,
    event_ts AS created_at
FROM web_tracking.events_staging
WHERE event_name IN ('identify', 'alias', 'group', 'logout', 'user_properties', 'user_active', 'user_idle', 'page_visible', 'page_hidden', 'heartbeat')
   OR (
       event_name NOT IN (
           'page_view', 'click', 'move', 'scroll', 'scroll_depth', 'rage_click', 'dead_click', 'hover',
           'form_view', 'form_start', 'form_focus', 'form_blur', 'form_change', 'form_validation',
           'form_submit', 'form_success', 'form_failure', 'form_abandon',
           'performance_lcp', 'performance_cls', 'performance_inp', 'performance_fcp',
           'performance_navigation', 'performance_resource', 'performance_long_task', 'performance_memory',
           'error', 'product_view', 'add_to_cart', 'remove_from_cart',
           'add_to_wishlist', 'remove_from_wishlist', 'begin_checkout',
           'purchase', 'refund', 'register', 'signup', 'login'
       )
       AND NOT startsWith(event_name, 'form_')
       AND NOT startsWith(event_name, 'performance_')
   );

-- Optional wishlist backfill: run separately (not part of user_id migration):
--   clickhouse/ddl/14b_optional_product_wishlist_backfill.sql
