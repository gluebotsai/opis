-- E-commerce rollups (cart, wishlist, product engagement — not generic visitor KPIs).
-- Apply after 03_silver_facts and 05_materialized_views_pipeline.
-- Existing deployments: recreate mv_fact_product if wishlist events were added to the MV filter.

CREATE TABLE IF NOT EXISTS web_tracking.agg_ecommerce_daily
(
    website_id              UInt32,
    event_date              Date,
    product_views_state     AggregateFunction(count),
    cart_adds_state         AggregateFunction(count),
    cart_removes_state      AggregateFunction(count),
    wishlist_adds_state     AggregateFunction(count),
    wishlist_removes_state  AggregateFunction(count),
    checkout_starts_state   AggregateFunction(count),
    product_visitors_state  AggregateFunction(uniqExact, String),
    purchases_state         AggregateFunction(count),
    purchase_revenue_state  AggregateFunction(sum, Decimal(12, 2)),
    refunds_state           AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (website_id, event_date)
TTL event_date + INTERVAL 2 YEAR DELETE
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_ecommerce_daily_products
TO web_tracking.agg_ecommerce_daily
AS
SELECT
    website_id,
    toDate(created_at) AS event_date,
    countStateIf(section = 'product_view') AS product_views_state,
    countStateIf(section = 'add_to_cart') AS cart_adds_state,
    countStateIf(section = 'remove_from_cart') AS cart_removes_state,
    countStateIf(section = 'add_to_wishlist') AS wishlist_adds_state,
    countStateIf(section = 'remove_from_wishlist') AS wishlist_removes_state,
    countStateIf(section = 'begin_checkout') AS checkout_starts_state,
    uniqExactState(visitor_id) AS product_visitors_state,
    countStateIf(0) AS purchases_state,
    sumState(toDecimal64(0, 2)) AS purchase_revenue_state,
    countStateIf(0) AS refunds_state
FROM web_tracking.fact_product_interactions
GROUP BY website_id, event_date;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_agg_ecommerce_daily_conversions
TO web_tracking.agg_ecommerce_daily
AS
SELECT
    website_id,
    toDate(created_at) AS event_date,
    countStateIf(0) AS product_views_state,
    countStateIf(0) AS cart_adds_state,
    countStateIf(0) AS cart_removes_state,
    countStateIf(0) AS wishlist_adds_state,
    countStateIf(0) AS wishlist_removes_state,
    countStateIf(0) AS checkout_starts_state,
    uniqExactStateIf(visitor_id, conversion_type IN ('purchase', 'refund')) AS product_visitors_state,
    countStateIf(conversion_type = 'purchase') AS purchases_state,
    sumStateIf(value, conversion_type = 'purchase') AS purchase_revenue_state,
    countStateIf(conversion_type = 'refund') AS refunds_state
FROM web_tracking.fact_conversion_events
GROUP BY website_id, event_date;

-- Query-friendly daily ecommerce metrics (cart, wishlist, checkout, revenue — not site-wide visitors).
CREATE VIEW IF NOT EXISTS web_tracking.ecommerce
AS
SELECT
    website_id,
    event_date,
    countMerge(product_views_state) AS product_views,
    countMerge(cart_adds_state) AS cart_adds,
    countMerge(cart_removes_state) AS cart_removes,
    countMerge(wishlist_adds_state) AS wishlist_adds,
    countMerge(wishlist_removes_state) AS wishlist_removes,
    countMerge(checkout_starts_state) AS checkout_starts,
    uniqExactMerge(product_visitors_state) AS product_engaged_visitors,
    countMerge(purchases_state) AS purchases,
    sumMerge(purchase_revenue_state) AS purchase_revenue,
    countMerge(refunds_state) AS refunds
FROM web_tracking.agg_ecommerce_daily
GROUP BY website_id, event_date;
