CREATE TABLE IF NOT EXISTS web_tracking.dim_websites
(
    website_id       UInt32,
    organization_id UInt32 DEFAULT 0,
    website_url     String,
    site_type       LowCardinality(String) DEFAULT 'blog',
    status          LowCardinality(String) DEFAULT 'active',
    created_at      DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at      DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (website_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.dim_visitors
(
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    anonymous_id        String DEFAULT '',
    first_seen_at       DateTime64(3, 'UTC'),
    last_seen_at        DateTime64(3, 'UTC'),
    total_sessions      UInt32 DEFAULT 0,
    total_pageviews     UInt32 DEFAULT 0,
    country             LowCardinality(String) DEFAULT '',
    created_at          DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at          DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (website_id, visitor_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.dim_sessions
(
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    started_at          DateTime64(3, 'UTC'),
    ended_at            Nullable(DateTime64(3, 'UTC')),
    duration_seconds    UInt32 DEFAULT 0,
    entry_page          String DEFAULT '',
    exit_page           String DEFAULT '',
    entry_url           String DEFAULT '',
    exit_url            String DEFAULT '',
    pageview_count      UInt32 DEFAULT 0,
    is_bounce           UInt8 DEFAULT 0,
    referrer            String DEFAULT '',
    referrer_domain     String DEFAULT '',
    utm_source          LowCardinality(String) DEFAULT '',
    utm_medium          LowCardinality(String) DEFAULT '',
    utm_campaign        String DEFAULT '',
    utm_term            String DEFAULT '',
    utm_content         String DEFAULT '',
    wt_organization_id  Nullable(UInt64),
    wt_campaign_id      Nullable(UInt64),
    wt_contact_id       Nullable(UInt64),
    user_agent          String DEFAULT '',
    language            LowCardinality(String) DEFAULT '',
    platform            LowCardinality(String) DEFAULT '',
    browser             LowCardinality(String) DEFAULT '',
    browser_version     String DEFAULT '',
    device              LowCardinality(String) DEFAULT '',
    screen_width        UInt16 DEFAULT 0,
    screen_height       UInt16 DEFAULT 0,
    country             LowCardinality(String) DEFAULT '',
    city                String DEFAULT '',
    region              String DEFAULT '',
    latitude            Float64 DEFAULT 0,
    longitude           Float64 DEFAULT 0,
    ip_hash             String DEFAULT '',
    geo_data            String DEFAULT '',
    sdk_version         LowCardinality(String) DEFAULT '',
    created_at          DateTime64(3, 'UTC') DEFAULT now64(3),
    updated_at          DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(started_at)
ORDER BY (website_id, visitor_id, session_id)
TTL toDateTime(started_at) + INTERVAL 400 DAY DELETE
SETTINGS index_granularity = 8192;
