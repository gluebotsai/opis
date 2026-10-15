CREATE TABLE IF NOT EXISTS web_tracking.fact_page_views
(
    page_view_id        String,
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    page_path           String,
    page_title          String DEFAULT '',
    referrer            String DEFAULT '',
    time_on_page_sec    UInt32 DEFAULT 0,
    max_scroll_depth    Float32 DEFAULT 0,
    sdk_version         LowCardinality(String) DEFAULT '',
    device              LowCardinality(String) DEFAULT '',
    country             LowCardinality(String) DEFAULT '',
    utm_source          LowCardinality(String) DEFAULT '',
    utm_medium          LowCardinality(String) DEFAULT '',
    utm_campaign        String DEFAULT '',
    extra_data          String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, visitor_id, created_at, page_view_id)
TTL toDateTime(created_at) + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_interaction_events
(
    event_id            String,
    event_type          LowCardinality(String),
    page_view_id        String DEFAULT '',
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    x_coord             Int32 DEFAULT 0,
    y_coord             Int32 DEFAULT 0,
    element             String DEFAULT '',
    element_type        LowCardinality(String) DEFAULT '',
    element_text        String DEFAULT '',
    href                String DEFAULT '',
    scroll_depth        Float32 DEFAULT 0,
    velocity            Int32 DEFAULT 0,
    click_count         UInt8 DEFAULT 0,
    reason              LowCardinality(String) DEFAULT '',
    viewport_w          UInt16 DEFAULT 0,
    viewport_h          UInt16 DEFAULT 0,
    device              LowCardinality(String) DEFAULT '',
    country             LowCardinality(String) DEFAULT '',
    page_path           String DEFAULT '',
    extra_data          String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, event_type, visitor_id, created_at)
TTL toDateTime(created_at) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_form_events
(
    event_id            String,
    page_view_id        String DEFAULT '',
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    event_type          LowCardinality(String),
    form_id             String DEFAULT '',
    form_name           String DEFAULT '',
    field_name          String DEFAULT '',
    field_value         String DEFAULT '',
    device              LowCardinality(String) DEFAULT '',
    country             LowCardinality(String) DEFAULT '',
    page_path           String DEFAULT '',
    extra_data          String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, event_type, visitor_id, created_at)
TTL toDateTime(created_at) + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_conversion_events
(
    conversion_id       String,
    page_view_id        String DEFAULT '',
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    conversion_type     LowCardinality(String),
    product_id          String DEFAULT '',
    value               Decimal(12, 2) DEFAULT 0,
    currency            LowCardinality(String) DEFAULT 'USD',
    device              LowCardinality(String) DEFAULT '',
    country             LowCardinality(String) DEFAULT '',
    utm_source          LowCardinality(String) DEFAULT '',
    utm_campaign        String DEFAULT '',
    props               String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, visitor_id, created_at, conversion_id)
TTL toDateTime(created_at) + INTERVAL 400 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_custom_events
(
    event_id            String,
    page_view_id        String DEFAULT '',
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    event_name          LowCardinality(String),
    event_data          String DEFAULT '',
    device              LowCardinality(String) DEFAULT '',
    country             LowCardinality(String) DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, event_name, visitor_id, created_at)
TTL toDateTime(created_at) + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_product_interactions
(
    interaction_id      String,
    page_view_id        String DEFAULT '',
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    product_id          String,
    product_name        String DEFAULT '',
    product_category    LowCardinality(String) DEFAULT '',
    product_price       Decimal(12, 2) DEFAULT 0,
    currency            LowCardinality(String) DEFAULT 'USD',
    product_sku         String DEFAULT '',
    product_brand       String DEFAULT '',
    section             LowCardinality(String) DEFAULT '',
    scroll_depth        Float32 DEFAULT 0,
    time_on_page_sec    UInt32 DEFAULT 0,
    device              LowCardinality(String) DEFAULT '',
    country             LowCardinality(String) DEFAULT '',
    extra_data          String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, product_id, created_at, interaction_id)
TTL toDateTime(created_at) + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_performance_events
(
    event_id            String,
    page_view_id        String DEFAULT '',
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    metric_name         LowCardinality(String),
    metric_value        Float64,
    rating              LowCardinality(String) DEFAULT '',
    page_path           String DEFAULT '',
    device              LowCardinality(String) DEFAULT '',
    extra_data          String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, metric_name, created_at)
TTL toDateTime(created_at) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_error_events
(
    event_id            String,
    page_view_id        String DEFAULT '',
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    error_type          LowCardinality(String),
    message             String DEFAULT '',
    stack               String DEFAULT '',
    page_path           String DEFAULT '',
    device              LowCardinality(String) DEFAULT '',
    browser             LowCardinality(String) DEFAULT '',
    extra_data          String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, error_type, created_at)
TTL toDateTime(created_at) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_cookie_operations
(
    event_id            String,
    session_id          String,
    visitor_id          String,
    website_id           UInt32,
    user_id             String DEFAULT '',
    action              LowCardinality(String),
    cookie_name         String,
    cookie_value        String DEFAULT '',
    expiry_days         Int32 DEFAULT 0,
    page_path           String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, cookie_name, created_at)
TTL toDateTime(created_at) + INTERVAL 60 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS web_tracking.fact_heap_snapshots
(
    snapshot_id         String,
    visitor_id          String,
    website_id           UInt32,
    user_id             String DEFAULT '',
    page_path           String DEFAULT '',
    used_heap_bytes     UInt64,
    total_heap_bytes    UInt64,
    heap_limit_bytes    UInt64,
    used_percentage     Float32,
    browser             LowCardinality(String) DEFAULT '',
    summary_data        String DEFAULT '',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, visitor_id, created_at)
TTL toDateTime(created_at) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192;
