-- Add payment_failure to conversion + custom-event MV filters (checkout funnel).
-- Apply after review:
--   python3 scripts/apply_clickhouse_manual.py clickhouse/ddl/25_payment_failure_conversion_mv.sql --host <ch-host>

DROP VIEW IF EXISTS web_tracking.mv_fact_conversions;

CREATE MATERIALIZED VIEW web_tracking.mv_fact_conversions
TO web_tracking.fact_conversion_events
AS
SELECT
    event_id AS conversion_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    event_name AS conversion_type,
    coalesce(
        nullIf(JSONExtractString(props_json, 'productId'), ''),
        nullIf(JSONExtractString(arrayElement(JSONExtractArrayRaw(props_json, 'products'), 1), 'productId'), ''),
        nullIf(JSONExtractString(props_json, 'orderId'), ''),
        ''
    ) AS product_id,
    toDecimal64(coalesce(JSONExtractFloat(props_json, 'revenue'), JSONExtractFloat(props_json, 'cartValue'), JSONExtractFloat(props_json, 'value'), JSONExtractFloat(props_json, 'productPrice'), 0), 2) AS value,
    coalesce(JSONExtractString(props_json, 'currency'), 'USD') AS currency,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    country,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_source'), '') AS utm_source,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_campaign'), '') AS utm_campaign,
    props_json AS props,
    event_ts AS created_at
FROM web_tracking.events_staging
WHERE event_name IN (
    'purchase',
    'refund',
    'register',
    'signup',
    'login',
    'begin_checkout',
    'payment_failure'
);

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
           'add_to_wishlist', 'remove_from_wishlist', 'begin_checkout', 'payment_failure',
           'purchase', 'refund', 'register', 'signup', 'login'
       )
       AND NOT startsWith(event_name, 'form_')
       AND NOT startsWith(event_name, 'performance_')
   );
