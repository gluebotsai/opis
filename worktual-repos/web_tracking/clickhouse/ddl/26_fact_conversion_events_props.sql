-- Store full event props on conversion rows (purchase products[], checkout cart, etc.).
-- Apply after review:
--   python3 scripts/apply_clickhouse_manual.py clickhouse/ddl/26_fact_conversion_events_props.sql --host <ch-host>

ALTER TABLE web_tracking.fact_conversion_events
ADD COLUMN IF NOT EXISTS props String DEFAULT '' AFTER utm_campaign;

-- Rows that never reached fact_conversion_events (MV missing / old event list).
INSERT INTO web_tracking.fact_conversion_events
(
    conversion_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    conversion_type,
    product_id,
    value,
    currency,
    device,
    country,
    utm_source,
    utm_campaign,
    props,
    created_at
)
SELECT
    s.event_id AS conversion_id,
    s.page_view_id,
    s.session_id,
    s.visitor_id,
    s.website_id,
    s.organization_id,
    s.user_id,
    s.event_name AS conversion_type,
    coalesce(
        nullIf(JSONExtractString(s.props_json, 'productId'), ''),
        nullIf(JSONExtractString(arrayElement(JSONExtractArrayRaw(s.props_json, 'products'), 1), 'productId'), ''),
        nullIf(JSONExtractString(s.props_json, 'orderId'), ''),
        ''
    ) AS product_id,
    toDecimal64(coalesce(JSONExtractFloat(s.props_json, 'revenue'), JSONExtractFloat(s.props_json, 'cartValue'), JSONExtractFloat(s.props_json, 'value'), JSONExtractFloat(s.props_json, 'productPrice'), 0), 2) AS value,
    coalesce(JSONExtractString(s.props_json, 'currency'), 'USD') AS currency,
    JSONExtractString(JSONExtractRaw(s.profiles_json, 'browser'), 'device') AS device,
    s.country,
    coalesce(JSONExtractString(JSONExtractRaw(s.profiles_json, 'campaign'), 'utm_source'), '') AS utm_source,
    coalesce(JSONExtractString(JSONExtractRaw(s.profiles_json, 'campaign'), 'utm_campaign'), '') AS utm_campaign,
    s.props_json AS props,
    s.event_ts AS created_at
FROM web_tracking.events_staging AS s
LEFT JOIN web_tracking.fact_conversion_events AS c
    ON c.conversion_id = s.event_id
WHERE s.event_name IN (
    'purchase',
    'refund',
    'register',
    'signup',
    'login',
    'begin_checkout',
    'payment_failure'
)
  AND c.conversion_id = '';

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

-- Backfill props on existing conversion rows from staging (conversion_id = event_id).
DROP TABLE IF EXISTS web_tracking._conv_props_backfill;
CREATE TABLE web_tracking._conv_props_backfill
(
    event_id String,
    props_json String
)
ENGINE = Join(ANY, LEFT, event_id);

INSERT INTO web_tracking._conv_props_backfill
SELECT
    event_id,
    argMax(props_json, event_ts) AS props_json
FROM web_tracking.events_staging
WHERE event_name IN (
    'purchase',
    'refund',
    'register',
    'signup',
    'login',
    'begin_checkout',
    'payment_failure'
)
GROUP BY event_id;

ALTER TABLE web_tracking.fact_conversion_events
UPDATE props = joinGet('web_tracking._conv_props_backfill', 'props_json', conversion_id)
WHERE props = '';

-- Fix product_id when it was orderId (payment_failure / checkout with products[] only).
ALTER TABLE web_tracking.fact_conversion_events
UPDATE product_id = coalesce(
    nullIf(JSONExtractString(props, 'productId'), ''),
    nullIf(JSONExtractString(arrayElement(JSONExtractArrayRaw(props, 'products'), 1), 'productId'), ''),
    product_id
)
WHERE props != ''
  AND nullIf(JSONExtractString(arrayElement(JSONExtractArrayRaw(props, 'products'), 1), 'productId'), '') != ''
  AND product_id != nullIf(JSONExtractString(arrayElement(JSONExtractArrayRaw(props, 'products'), 1), 'productId'), '');

DROP TABLE IF EXISTS web_tracking._conv_props_backfill;
