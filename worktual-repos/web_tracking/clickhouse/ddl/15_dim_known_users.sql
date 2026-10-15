-- Known-user identity: visitor_id ↔ user_id (flat TABLE, not a view).
-- first_identified_at = earliest identify/login/register; last_identified_at = latest.
-- Refreshed from events_staging every minute (see mv_dim_known_users).

CREATE TABLE IF NOT EXISTS web_tracking.dim_known_users
(
    website_id          UInt32,
    organization_id     Nullable(UInt32),
    user_id             String,
    visitor_id          String,
    email               String DEFAULT '',
    phone               String DEFAULT '',
    first_name          String DEFAULT '',
    last_name           String DEFAULT '',
    method              LowCardinality(String) DEFAULT '',
    last_event_type     LowCardinality(String) DEFAULT '',
    traits_json         String DEFAULT '',
    first_identified_at DateTime64(3, 'UTC'),
    last_identified_at  DateTime64(3, 'UTC'),
    updated_at          DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (website_id, user_id, visitor_id)
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS web_tracking.mv_dim_known_users
REFRESH EVERY 1 MINUTE
TO web_tracking.dim_known_users
AS
SELECT
    website_id,
    argMax(organization_id, event_ts) AS organization_id,
    user_id,
    visitor_id,
    argMax(email, event_ts) AS email,
    argMax(phone, event_ts) AS phone,
    argMax(first_name, event_ts) AS first_name,
    argMax(last_name, event_ts) AS last_name,
    argMax(method, event_ts) AS method,
    argMax(event_name, event_ts) AS last_event_type,
    argMax(traits_json, event_ts) AS traits_json,
    min(event_ts) AS first_identified_at,
    max(event_ts) AS last_identified_at,
    max(event_ts) AS updated_at
FROM (
    SELECT
        website_id,
        organization_id,
        visitor_id,
        event_ts,
        event_name,
        coalesce(
            nullIf(user_id, ''),
            nullIf(JSONExtractString(props_json, 'userId'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'userId'), ''),
            ''
        ) AS user_id,
        coalesce(
            nullIf(JSONExtractString(props_json, 'email'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'email'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), 'email'), ''),
            ''
        ) AS email,
        coalesce(
            nullIf(JSONExtractString(props_json, 'phone'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'phone'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), 'phone'), ''),
            ''
        ) AS phone,
        coalesce(
            nullIf(JSONExtractString(props_json, 'firstName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'firstName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), 'firstName'), ''),
            nullIf(JSONExtractString(props_json, 'name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'name'), ''),
            ''
        ) AS first_name,
        coalesce(
            nullIf(JSONExtractString(props_json, 'lastName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'lastName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), 'lastName'), ''),
            ''
        ) AS last_name,
        coalesce(
            nullIf(JSONExtractString(props_json, 'method'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), 'method'), ''),
            ''
        ) AS method,
        coalesce(
            nullIf(JSONExtractRaw(props_json, 'traits'), ''),
            nullIf(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), ''),
            props_json
        ) AS traits_json
    FROM web_tracking.events_staging
    WHERE event_name IN ('identify', 'login', 'register', 'signup')
      AND coalesce(
            nullIf(user_id, ''),
            nullIf(JSONExtractString(props_json, 'userId'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'userId'), ''),
            ''
          ) != ''

)
GROUP BY website_id, user_id, visitor_id;
