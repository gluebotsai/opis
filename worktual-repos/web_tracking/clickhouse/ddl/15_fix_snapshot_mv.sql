-- Fix is_snapshot detection: isSnapshot was stored as string "true" in props_json.
-- Run manually: conda activate web_tracking && python scripts/apply_snapshot_mv_fix.py

DROP VIEW IF EXISTS web_tracking.mv_session_replay_chunks;

CREATE MATERIALIZED VIEW web_tracking.mv_session_replay_chunks
TO web_tracking.session_replay_chunks
AS
SELECT
    event_id,
    website_id,
    organization_id,
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
