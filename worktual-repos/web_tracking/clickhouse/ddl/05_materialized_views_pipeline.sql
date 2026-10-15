-- Bronze → staging → silver facts + dimensions
-- Parses events_v3 / events_v2 JSON payloads from raw_payloads.payload
--
-- v3 SDK stores page path/title in profiles.pages[pid], not always in event props.
-- Resolve page metadata with profile lookup first, then props, then session landing path.

CREATE TABLE IF NOT EXISTS web_tracking.events_staging
(
    payload_id          UUID,
    website_id           UInt32,
    website_url         String,
    visitor_id          String,
    session_id          String,
    event_id            String,
    event_name          LowCardinality(String),
    event_ts            DateTime64(3, 'UTC'),
    page_view_id        String DEFAULT '',
    props_json          String DEFAULT '',
    profiles_json       String DEFAULT '',
    payload_type        LowCardinality(String) DEFAULT 'events_v3',
    received_at         DateTime64(3, 'UTC'),
    country             LowCardinality(String) DEFAULT '',
    sdk_version         LowCardinality(String) DEFAULT '',
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (website_id, event_ts, event_id)
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_parse_events
TO web_tracking.events_staging
AS
SELECT
    payload_id,
    website_id,
    website_url,
    visitor_id,
    JSONExtractString(payload, 'sessionId') AS session_id,
    JSONExtractString(event, 'eventId') AS event_id,
    multiIf(
        JSONExtractString(event, 'name') = 'scroll_milestone', 'scroll_depth',
        JSONExtractString(event, 'name') = 'performance_vitals', 'performance_navigation',
        JSONExtractString(event, 'name')
    ) AS event_name,
    toDateTime64(
        coalesce(
            JSONExtractUInt(event, 'ts'),
            JSONExtractUInt(event, 'timestamp')
        ) / 1000,
        3,
        'UTC'
    ) AS event_ts,
    coalesce(JSONExtractString(event, 'pid'), JSONExtractString(event, 'pageViewId'), '') AS page_view_id,
    coalesce(JSONExtractRaw(event, 'props'), JSONExtractRaw(event, 'properties'), '{}') AS props_json,
    coalesce(JSONExtractRaw(payload, 'profiles'), '{}') AS profiles_json,
    payload_type,
    received_at,
    JSONExtractString(JSONExtractRaw(payload, '_geo'), 'country') AS country,
    JSONExtractString(payload, 'sdkVersion') AS sdk_version,
    nullIf(
        coalesce(
            JSONExtractUInt(payload, 'organization_id'),
            JSONExtractUInt(payload, 'organizationId')
        ),
        0
    ) AS organization_id,
    coalesce(
        nullIf(JSONExtractString(payload, 'userId'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'visitor', 'userId'), ''),
        ''
    ) AS user_id
FROM web_tracking.raw_payloads
ARRAY JOIN JSONExtractArrayRaw(payload, 'events') AS event
WHERE length(JSONExtractArrayRaw(payload, 'events')) > 0;

-- Page views
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_page_views
TO web_tracking.fact_page_views
AS
SELECT
    page_view_id AS page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'pagePath'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'session'), 'landingPath'), ''),
        '/'
    ) AS page_path,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'title'), ''),
        nullIf(JSONExtractString(props_json, 'title'), ''),
        nullIf(JSONExtractString(props_json, 'pageTitle'), ''),
        nullIf(JSONExtractString(props_json, 'pageName'), ''),
        ''
    ) AS page_title,
    coalesce(JSONExtractString(props_json, 'referrer'), '') AS referrer,
    toUInt32(coalesce(JSONExtractUInt(props_json, 'timeOnPage'), 0)) AS time_on_page_sec,
    toFloat32(coalesce(JSONExtractFloat(props_json, 'maxDepth'), JSONExtractFloat(props_json, 'maxScrollDepth'), 0)) AS max_scroll_depth,
    sdk_version,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    country,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_source'), JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'campaign'), 'lastTouch'), 'utm_source'), '') AS utm_source,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_medium'), '') AS utm_medium,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_campaign'), '') AS utm_campaign,
    props_json AS extra_data,
    event_ts AS created_at
FROM web_tracking.events_staging
WHERE event_name = 'page_view' AND page_view_id != '';

-- Interaction events
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_interactions
TO web_tracking.fact_interaction_events
AS
SELECT
    event_id,
    event_name AS event_type,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    toInt32(coalesce(JSONExtractInt(props_json, 'x'), JSONExtractInt(props_json, 'clientX'), 0)) AS x_coord,
    toInt32(coalesce(JSONExtractInt(props_json, 'y'), JSONExtractInt(props_json, 'clientY'), 0)) AS y_coord,
    coalesce(JSONExtractString(props_json, 'element'), JSONExtractString(props_json, 'selector'), '') AS element,
    coalesce(JSONExtractString(props_json, 'elementType'), '') AS element_type,
    coalesce(JSONExtractString(props_json, 'elementText'), JSONExtractString(props_json, 'text'), '') AS element_text,
    coalesce(JSONExtractString(props_json, 'href'), '') AS href,
    toFloat32(coalesce(
        nullIf(JSONExtractFloat(props_json, 'milestone'), 0),
        nullIf(JSONExtractFloat(props_json, 'scrollDepth'), 0),
        nullIf(JSONExtractFloat(props_json, 'maxDepth'), 0),
        0
    )) AS scroll_depth,
    toInt32(coalesce(JSONExtractInt(props_json, 'velocity'), 0)) AS velocity,
    toUInt8(coalesce(JSONExtractUInt(props_json, 'clickCount'), 0)) AS click_count,
    coalesce(JSONExtractString(props_json, 'reason'), '') AS reason,
    toUInt16(coalesce(
        JSONExtractUInt(props_json, 'viewportWidth'),
        JSONExtractUInt(props_json, 'viewportW'),
        0
    )) AS viewport_w,
    toUInt16(coalesce(
        JSONExtractUInt(props_json, 'viewportHeight'),
        JSONExtractUInt(props_json, 'viewportH'),
        0
    )) AS viewport_h,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    country,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'pagePath'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'session'), 'landingPath'), ''),
        '/'
    ) AS page_path,
    props_json AS extra_data,
    event_ts AS created_at
FROM web_tracking.events_staging
WHERE event_name IN ('click', 'move', 'scroll', 'scroll_depth', 'rage_click', 'dead_click', 'hover');

-- Form events
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_form_events
TO web_tracking.fact_form_events
AS
SELECT
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    event_name AS event_type,
    coalesce(JSONExtractString(props_json, 'formId'), '') AS form_id,
    coalesce(JSONExtractString(props_json, 'formName'), '') AS form_name,
    coalesce(JSONExtractString(props_json, 'fieldName'), '') AS field_name,
    coalesce(JSONExtractString(props_json, 'fieldValue'), '') AS field_value,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    country,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'path'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'session'), 'landingPath'), ''),
        '/'
    ) AS page_path,
    props_json AS extra_data,
    event_ts AS created_at
FROM web_tracking.events_staging
WHERE event_name LIKE 'form_%';

-- Performance events
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_performance
TO web_tracking.fact_performance_events
AS
SELECT
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    event_name AS metric_name,
    coalesce(JSONExtractFloat(props_json, 'value'), JSONExtractFloat(props_json, 'ttfb'), JSONExtractFloat(props_json, 'lcp'), 0) AS metric_value,
    coalesce(JSONExtractString(props_json, 'rating'), '') AS rating,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'path'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'session'), 'landingPath'), ''),
        '/'
    ) AS page_path,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    props_json AS extra_data,
    event_ts AS created_at
FROM web_tracking.events_staging
WHERE event_name LIKE 'performance_%';

-- Error events
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_errors
TO web_tracking.fact_error_events
AS
SELECT
    event_id,
    page_view_id,
    session_id,
    visitor_id,
    website_id,
    organization_id,
    user_id,
    coalesce(JSONExtractString(props_json, 'errorType'), 'javascript') AS error_type,
    coalesce(JSONExtractString(props_json, 'message'), JSONExtractString(props_json, 'errorMessage'), '') AS message,
    coalesce(JSONExtractString(props_json, 'stack'), '') AS stack,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'path'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'session'), 'landingPath'), ''),
        '/'
    ) AS page_path,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device') AS device,
    JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'browser') AS browser,
    props_json AS extra_data,
    event_ts AS created_at
FROM web_tracking.events_staging
WHERE event_name = 'error';

-- Ecommerce / product interactions
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_product
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

-- Conversion events (purchase, register, login, refund)
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_conversions
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
WHERE event_name IN ('purchase', 'refund', 'register', 'signup', 'login', 'begin_checkout', 'payment_failure');

-- Custom events (identity + unknown names)
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_custom
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

-- Dimension: visitors (from each staging row)
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_dim_visitors
TO web_tracking.dim_visitors
AS
SELECT
    visitor_id,
    website_id,
    organization_id,
    coalesce(
        nullIf(user_id, ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'visitor'), 'userId'), ''),
        ''
    ) AS user_id,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'visitor'), 'anonymousId'), '') AS anonymous_id,
    event_ts AS first_seen_at,
    event_ts AS last_seen_at,
    toUInt32(0) AS total_sessions,
    toUInt32(0) AS total_pageviews,
    country,
    now64(3) AS created_at,
    now64(3) AS updated_at
FROM web_tracking.events_staging;

-- Dimension: sessions (one row per payload batch — ReplacingMergeTree keeps latest)
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_dim_sessions
TO web_tracking.dim_sessions
AS
SELECT
    JSONExtractString(payload, 'sessionId') AS session_id,
    visitor_id,
    website_id,
    nullIf(
        coalesce(
            JSONExtractUInt(payload, 'organization_id'),
            JSONExtractUInt(payload, 'organizationId')
        ),
        0
    ) AS organization_id,
    coalesce(
        nullIf(JSONExtractString(payload, 'userId'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'visitor', 'userId'), ''),
        ''
    ) AS user_id,
    toDateTime64(
        arrayMin(arrayMap(
            e -> coalesce(JSONExtractUInt(e, 'ts'), JSONExtractUInt(e, 'timestamp')) / 1000,
            JSONExtractArrayRaw(payload, 'events')
        )),
        3,
        'UTC'
    ) AS started_at,
    toDateTime64(
        arrayMax(arrayMap(
            e -> coalesce(JSONExtractUInt(e, 'ts'), JSONExtractUInt(e, 'timestamp')) / 1000,
            JSONExtractArrayRaw(payload, 'events')
        )),
        3,
        'UTC'
    ) AS ended_at,
    toUInt32(greatest(0, dateDiff(
        'second',
        toDateTime64(arrayMin(arrayMap(
            e -> coalesce(JSONExtractUInt(e, 'ts'), JSONExtractUInt(e, 'timestamp')) / 1000,
            JSONExtractArrayRaw(payload, 'events')
        )), 3, 'UTC'),
        toDateTime64(arrayMax(arrayMap(
            e -> coalesce(JSONExtractUInt(e, 'ts'), JSONExtractUInt(e, 'timestamp')) / 1000,
            JSONExtractArrayRaw(payload, 'events')
        )), 3, 'UTC')
    ))) AS duration_seconds,
    coalesce(nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'session', 'landingPath'), ''), '/') AS entry_page,
    '' AS exit_page,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'session', 'landingUrl'), '') AS entry_url,
    '' AS exit_url,
    -- Bounce/pageview metrics: use v_session_bounce (agg_session_activity). Batch counts here were wrong (~100% bounce).
    toUInt32(0) AS pageview_count,
    toUInt8(0) AS is_bounce,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'session', 'referrer'), '') AS referrer,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'session', 'referrerDomain'), '') AS referrer_domain,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'campaign', 'utm_source'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'utm_source'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'firstTouch', 'utm_source'), ''),
        ''
    ) AS utm_source,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'campaign', 'utm_medium'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'utm_medium'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'firstTouch', 'utm_medium'), ''),
        ''
    ) AS utm_medium,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'campaign', 'utm_campaign'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'utm_campaign'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'firstTouch', 'utm_campaign'), ''),
        ''
    ) AS utm_campaign,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'campaign', 'utm_term'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'utm_term'), ''),
        ''
    ) AS utm_term,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'campaign', 'utm_content'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'utm_content'), ''),
        ''
    ) AS utm_content,
    nullIf(
        coalesce(
            JSONExtractUInt(JSONExtractRaw(payload, 'profiles'), 'campaign', 'wt_organization_id'),
            JSONExtractUInt(JSONExtractRaw(payload, 'profiles'), 'campaign', 'wt_org_id'),
            JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'wt_organization_id'),
            JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'wt_org_id'),
            JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'firstTouch', 'wt_organization_id'),
            JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'firstTouch', 'wt_org_id'),
            toUInt64(0)
        ),
        0
    ) AS wt_organization_id,
    nullIf(
        coalesce(
            JSONExtractUInt(JSONExtractRaw(payload, 'profiles'), 'campaign', 'wt_campaign_id'),
            JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'wt_campaign_id'),
            JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'firstTouch', 'wt_campaign_id'),
            toUInt64(0)
        ),
        0
    ) AS wt_campaign_id,
    nullIf(
        coalesce(
            JSONExtractUInt(JSONExtractRaw(payload, 'profiles'), 'campaign', 'wt_contact_id'),
            JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'lastTouch', 'wt_contact_id'),
            JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'campaign'), 'firstTouch', 'wt_contact_id'),
            toUInt64(0)
        ),
        0
    ) AS wt_contact_id,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'userAgent'), user_agent) AS user_agent,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'language'), '') AS language,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'os'), '') AS platform,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'browser'), '') AS browser,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'browserVersion'), '') AS browser_version,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'device'), '') AS device,
    toUInt16(coalesce(JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'browser'), 'screen', 'width'), 0)) AS screen_width,
    toUInt16(coalesce(JSONExtractUInt(JSONExtractRaw(JSONExtractRaw(payload, 'profiles'), 'browser'), 'screen', 'height'), 0)) AS screen_height,
    JSONExtractString(JSONExtractRaw(payload, '_geo'), 'country') AS country,
    coalesce(JSONExtractString(JSONExtractRaw(payload, '_geo'), 'city'), '') AS city,
    coalesce(JSONExtractString(JSONExtractRaw(payload, '_geo'), 'region'), '') AS region,
    toFloat64(coalesce(JSONExtractFloat(JSONExtractRaw(payload, '_geo'), 'latitude'), 0)) AS latitude,
    toFloat64(coalesce(JSONExtractFloat(JSONExtractRaw(payload, '_geo'), 'longitude'), 0)) AS longitude,
    '' AS ip_hash,
    coalesce(JSONExtractRaw(payload, '_geo'), '') AS geo_data,
    coalesce(JSONExtractString(payload, 'sdkVersion'), '') AS sdk_version,
    now64(3) AS created_at,
    now64(3) AS updated_at
FROM web_tracking.raw_payloads;

-- Sync dim_websites from ingest payloads
CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_dim_websites
TO web_tracking.dim_websites
AS
SELECT
    website_id,
    coalesce(
        nullIf(
            coalesce(
                JSONExtractUInt(payload, 'organization_id'),
                JSONExtractUInt(payload, 'organizationId')
            ),
            0
        ),
        toUInt32(0)
    ) AS organization_id,
    website_url,
    'blog' AS site_type,
    'active' AS status,
    now64(3) AS created_at,
    now64(3) AS updated_at
FROM web_tracking.raw_payloads;
