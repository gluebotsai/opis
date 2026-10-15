-- HTML snapshot session replay chunks (session_replay_chunk events from events_v3).
-- Parsed from events_staging — separate from rrweb fact_replay_chunks.

CREATE TABLE IF NOT EXISTS web_tracking.session_replay_chunks
(
    event_id            String,
    website_id          UInt32,
    organization_id     Nullable(UInt32),
    user_id             String DEFAULT '',
    visitor_id          String,
    session_id          String,
    page_view_id        String DEFAULT '',
    chunk_index         UInt32,
    is_snapshot         UInt8 DEFAULT 0,
    href                String DEFAULT '',
    viewport_width      UInt16 DEFAULT 0,
    viewport_height     UInt16 DEFAULT 0,
    event_timestamp     DateTime64(3, 'UTC'),
    records             String DEFAULT '[]',
    raw_event_data      String DEFAULT '{}',
    received_at         DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (website_id, session_id, chunk_index)
TTL toDateTime(received_at) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_session_replay_chunks
TO web_tracking.session_replay_chunks
AS
SELECT
    event_id,
    website_id,
    organization_id,
    user_id,
    visitor_id,
    session_id,
    page_view_id,
    toUInt32(JSONExtractUInt(props_json, 'chunkIndex')) AS chunk_index,
    toUInt8(
        JSONExtractBool(props_json, 'isSnapshot')
        OR lower(JSONExtractString(props_json, 'isSnapshot')) IN ('true', '1')
        OR positionCaseInsensitive(coalesce(JSONExtractRaw(props_json, 'records'), ''), '"type":"snapshot"') > 0
        OR positionCaseInsensitive(coalesce(JSONExtractRaw(props_json, 'records'), ''), '"type": "snapshot"') > 0
    ) AS is_snapshot,
    coalesce(JSONExtractString(props_json, 'href'), '') AS href,
    toUInt16(JSONExtractUInt(JSONExtractRaw(props_json, 'viewport'), 'width')) AS viewport_width,
    toUInt16(JSONExtractUInt(JSONExtractRaw(props_json, 'viewport'), 'height')) AS viewport_height,
    event_ts AS event_timestamp,
    coalesce(JSONExtractRaw(props_json, 'records'), '[]') AS records,
    props_json AS raw_event_data,
    received_at
FROM web_tracking.events_staging
WHERE event_name = 'session_replay_chunk';
