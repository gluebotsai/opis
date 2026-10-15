"""Sync events_staging from raw_payloads (same logic as mv_parse_events). Idempotent."""

from __future__ import annotations

from typing import Any

# Keep identical to clickhouse/ddl/27_app_screen_and_channel.sql → mv_parse_events
SYNC_STAGING_FOR_PAYLOAD_SQL = """
INSERT INTO events_staging
(
    payload_id, website_id, website_url, visitor_id, session_id, event_id, event_name,
    event_ts, page_view_id, props_json, profiles_json, payload_type, received_at,
    country, sdk_version, organization_id, user_id, channel
)
SELECT
    r.payload_id,
    r.website_id,
    r.website_url,
    r.visitor_id,
    JSONExtractString(r.payload, 'sessionId') AS session_id,
    JSONExtractString(event, 'eventId') AS event_id,
    multiIf(
        JSONExtractString(event, 'name') = 'scroll_milestone', 'scroll_depth',
        JSONExtractString(event, 'name') = 'performance_vitals', 'performance_navigation',
        JSONExtractString(event, 'name')
    ) AS event_name,
    toDateTime64(
        coalesce(JSONExtractUInt(event, 'ts'), JSONExtractUInt(event, 'timestamp')) / 1000,
        3, 'UTC'
    ) AS event_ts,
    coalesce(JSONExtractString(event, 'pid'), JSONExtractString(event, 'pageViewId'), '') AS page_view_id,
    coalesce(JSONExtractRaw(event, 'props'), JSONExtractRaw(event, 'properties'), '{}') AS props_json,
    coalesce(JSONExtractRaw(r.payload, 'profiles'), '{}') AS profiles_json,
    r.payload_type,
    r.received_at,
    JSONExtractString(JSONExtractRaw(r.payload, '_geo'), 'country') AS country,
    JSONExtractString(r.payload, 'sdkVersion') AS sdk_version,
    toUInt32(nullIf(
        coalesce(JSONExtractUInt(r.payload, 'organization_id'), JSONExtractUInt(r.payload, 'organizationId')),
        0
    )) AS organization_id,
    coalesce(
        nullIf(JSONExtractString(r.payload, 'userId'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(r.payload, 'profiles'), 'visitor', 'userId'), ''),
        ''
    ) AS user_id,
    coalesce(nullIf(JSONExtractString(r.payload, 'channel'), ''), 'web') AS channel
FROM raw_payloads AS r
ARRAY JOIN JSONExtractArrayRaw(r.payload, 'events') AS event
WHERE r.payload_id = {payload_id:UUID}
  AND length(JSONExtractArrayRaw(r.payload, 'events')) > 0
  AND NOT EXISTS (
      SELECT 1 FROM events_staging AS s
      WHERE s.payload_id = r.payload_id
        AND s.event_id = JSONExtractString(event, 'eventId')
  )
"""


def sync_staging_for_payload(client: Any, payload_id: str) -> None:
    """Write parsed events for one raw row; triggers downstream MVs on events_staging."""
    client.command(SYNC_STAGING_FOR_PAYLOAD_SQL, parameters={"payload_id": payload_id})
