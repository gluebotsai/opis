-- Drop and recreate MVs that resolve page paths from profiles.pages[pid].
-- Run once after upgrading 05_materialized_views_pipeline.sql, then backfill derived tables.

DROP VIEW IF EXISTS web_tracking.mv_fact_page_views;
DROP VIEW IF EXISTS web_tracking.mv_fact_interactions;
DROP VIEW IF EXISTS web_tracking.mv_fact_form_events;
DROP VIEW IF EXISTS web_tracking.mv_fact_performance;
DROP VIEW IF EXISTS web_tracking.mv_fact_errors;
DROP VIEW IF EXISTS web_tracking.mv_dim_sessions;

-- Page views
CREATE MATERIALIZED VIEW web_tracking.mv_fact_page_views
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

CREATE MATERIALIZED VIEW web_tracking.mv_fact_interactions
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

CREATE MATERIALIZED VIEW web_tracking.mv_fact_form_events
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

CREATE MATERIALIZED VIEW web_tracking.mv_fact_performance
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

CREATE MATERIALIZED VIEW web_tracking.mv_fact_errors
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

CREATE MATERIALIZED VIEW web_tracking.mv_dim_sessions
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
    toUInt32(0) AS pageview_count,
    toUInt8(0) AS is_bounce,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'session', 'referrer'), '') AS referrer,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'session', 'referrerDomain'), '') AS referrer_domain,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'campaign', 'utm_source'), '') AS utm_source,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'campaign', 'utm_medium'), '') AS utm_medium,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'campaign', 'utm_campaign'), '') AS utm_campaign,
    '' AS utm_term,
    '' AS utm_content,
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
