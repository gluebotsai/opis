CREATE TABLE IF NOT EXISTS web_tracking.raw_payloads
(
    payload_id          UUID,
    website_id           UInt32,
    website_url         String,
    visitor_id          String,
    payload_type        LowCardinality(String),
    source_ip           String,
    user_agent          String,
    received_at         DateTime64(3, 'UTC'),
    payload             String,
    processing_status   LowCardinality(String) DEFAULT 'accepted',
    ingested_at         DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMM(received_at)
ORDER BY (website_id, payload_id)
TTL toDateTime(received_at) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;
