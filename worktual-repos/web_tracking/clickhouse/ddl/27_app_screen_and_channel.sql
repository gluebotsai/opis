-- App tracking: channel + screen_view → fact_page_views.
-- Run in maintenance window after review. Does not backfill historical facts.
-- Web-safe: missing payload.channel → 'web'; page_view logic unchanged; mv_dim_sessions = 05 + channel + mobile platform/device only.
-- Deploy with etl/ingest/staging_sync.py (channel column) in the same release.
-- See docs/APP_TRACKING_CH_MV_REVIEW_FOR_AGENT.md

ALTER TABLE web_tracking.events_staging
    ADD COLUMN IF NOT EXISTS channel LowCardinality(String) DEFAULT 'web';

ALTER TABLE web_tracking.fact_page_views
    ADD COLUMN IF NOT EXISTS channel LowCardinality(String) DEFAULT 'web';

ALTER TABLE web_tracking.dim_sessions
    ADD COLUMN IF NOT EXISTS channel LowCardinality(String) DEFAULT 'web';

-- Parse events: copy top-level channel from events_v3 payload (web | android | ios)
DROP VIEW IF EXISTS web_tracking.mv_parse_events;

CREATE MATERIALIZED VIEW web_tracking.mv_parse_events
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
    ) AS user_id,
    coalesce(nullIf(JSONExtractString(payload, 'channel'), ''), 'web') AS channel
FROM web_tracking.raw_payloads
ARRAY JOIN JSONExtractArrayRaw(payload, 'events') AS event
WHERE length(JSONExtractArrayRaw(payload, 'events')) > 0;

-- Page views (web page_view + mobile screen_view)
DROP VIEW IF EXISTS web_tracking.mv_fact_page_views;

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
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'screens'), page_view_id, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'path'), ''),
        nullIf(JSONExtractString(props_json, 'pagePath'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'session'), 'landingPath'), ''),
        '/'
    ) AS page_path,
    coalesce(
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'pages'), page_view_id, 'title'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(profiles_json, 'screens'), page_view_id, 'title'), ''),
        nullIf(JSONExtractString(props_json, 'title'), ''),
        nullIf(JSONExtractString(props_json, 'pageTitle'), ''),
        nullIf(JSONExtractString(props_json, 'pageName'), ''),
        nullIf(JSONExtractString(props_json, 'screen'), ''),
        ''
    ) AS page_title,
    coalesce(JSONExtractString(props_json, 'referrer'), '') AS referrer,
    toUInt32(coalesce(JSONExtractUInt(props_json, 'timeOnPage'), 0)) AS time_on_page_sec,
    toFloat32(coalesce(JSONExtractFloat(props_json, 'maxDepth'), JSONExtractFloat(props_json, 'maxScrollDepth'), 0)) AS max_scroll_depth,
    sdk_version,
    coalesce(
        JSONExtractString(JSONExtractRaw(profiles_json, 'browser'), 'device'),
        JSONExtractString(JSONExtractRaw(profiles_json, 'device'), 'model'),
        ''
    ) AS device,
    country,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_source'), JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'campaign'), 'lastTouch'), 'utm_source'), '') AS utm_source,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_medium'), '') AS utm_medium,
    coalesce(JSONExtractString(JSONExtractRaw(profiles_json, 'campaign'), 'utm_campaign'), '') AS utm_campaign,
    props_json AS extra_data,
    event_ts AS created_at,
    channel
FROM web_tracking.events_staging
WHERE event_name IN ('page_view', 'screen_view') AND page_view_id != '';

-- Session dimension: production 05 + channel + mobile platform/device (web Campaign/UTM/wt_* preserved)
DROP VIEW IF EXISTS web_tracking.mv_dim_sessions;

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
    coalesce(
        nullIf(JSONExtractString(payload, 'os'), ''),
        JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'os'),
        JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'device', 'os'),
        ''
    ) AS platform,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'browser'), '') AS browser,
    coalesce(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'browserVersion'), '') AS browser_version,
    coalesce(
        JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'browser', 'device'),
        JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'device', 'model'),
        ''
    ) AS device,
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
    now64(3) AS updated_at,
    coalesce(nullIf(JSONExtractString(payload, 'channel'), ''), 'web') AS channel
FROM web_tracking.raw_payloads;
