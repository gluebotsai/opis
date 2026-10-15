-- OPTIONAL: copy wishlist/checkout rows from staging (last 90 days) not already in facts.
-- Run manually after 14_recreate_mv_fact_product_wishlist.sql if KPIs need historical rows.

INSERT INTO web_tracking.fact_product_interactions
SELECT
    s.event_id AS interaction_id,
    s.page_view_id,
    s.session_id,
    s.visitor_id,
    s.website_id,
    s.organization_id,
    s.user_id,
    coalesce(JSONExtractString(s.props_json, 'productId'), JSONExtractString(s.props_json, 'sku'), 'unknown') AS product_id,
    coalesce(JSONExtractString(s.props_json, 'productName'), JSONExtractString(s.props_json, 'name'), '') AS product_name,
    coalesce(JSONExtractString(s.props_json, 'productCategory'), JSONExtractString(s.props_json, 'category'), '') AS product_category,
    toDecimal64(coalesce(JSONExtractFloat(s.props_json, 'productPrice'), JSONExtractFloat(s.props_json, 'price'), 0), 2) AS product_price,
    coalesce(JSONExtractString(s.props_json, 'currency'), 'USD') AS currency,
    coalesce(JSONExtractString(s.props_json, 'sku'), '') AS product_sku,
    coalesce(JSONExtractString(s.props_json, 'brand'), '') AS product_brand,
    s.event_name AS section,
    toFloat32(0) AS scroll_depth,
    toUInt32(0) AS time_on_page_sec,
    JSONExtractString(JSONExtractRaw(s.profiles_json, 'browser'), 'device') AS device,
    s.country,
    s.props_json AS extra_data,
    s.event_ts AS created_at
FROM web_tracking.events_staging AS s
LEFT JOIN web_tracking.fact_product_interactions AS f
    ON f.interaction_id = s.event_id
WHERE s.event_name IN ('add_to_wishlist', 'remove_from_wishlist', 'begin_checkout')
  AND f.interaction_id = ''
  AND s.received_at > now() - INTERVAL 90 DAY;
