-- Session replay: compressed rrweb chunks (gzip_b64) per session/page.
-- Parsed from raw_payloads via MV — do not explode into per-event rows (storage efficient).

CREATE TABLE IF NOT EXISTS web_tracking.fact_replay_chunks
(
    chunk_id            UUID,
    website_id           UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    visitor_id          String,
    session_id          String,
    page_view_id        String DEFAULT '',
    chunk_index         UInt32,
    encoding            LowCardinality(String) DEFAULT 'gzip_b64',
    events_data         String,
    event_count         UInt32,
    source              LowCardinality(String) DEFAULT 'rrweb',
    created_at          DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (website_id, session_id, chunk_index)
TTL toDateTime(created_at) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_fact_replay_chunks
TO web_tracking.fact_replay_chunks
AS
SELECT
    toUUID(JSONExtractString(payload, 'chunkId')) AS chunk_id,
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
    visitor_id,
    JSONExtractString(payload, 'sessionId') AS session_id,
    JSONExtractString(payload, 'pageViewId') AS page_view_id,
    toUInt32(JSONExtractUInt(payload, 'chunkIndex')) AS chunk_index,
    coalesce(JSONExtractString(payload, 'encoding'), 'gzip_b64') AS encoding,
    JSONExtractString(payload, 'eventsData') AS events_data,
    toUInt32(JSONExtractUInt(payload, 'eventCount')) AS event_count,
    coalesce(JSONExtractString(payload, 'source'), 'rrweb') AS source,
    received_at AS created_at
FROM web_tracking.raw_payloads
WHERE payload_type = 'replay_chunk_v1'
  AND length(JSONExtractString(payload, 'eventsData')) > 0;
