-- Migrate dim_known_users: flat TABLE with correct first/last identify timestamps.
--
-- Before: dim_known_users (ReplacingMergeTree) + mv_dim_known_users (incremental, wrong timestamps)
-- After:  dim_known_users (ReplacingMergeTree TABLE) + mv_dim_known_users (refreshable, every 1 min)
--
-- Run on 10.180.0.126:
--   python3 scripts/apply_clickhouse_manual.py clickhouse/ddl/17_fix_dim_known_users.sql --host 10.180.0.126

DROP VIEW IF EXISTS web_tracking.mv_dim_known_users;

RENAME TABLE web_tracking.dim_known_users TO web_tracking.dim_known_users_legacy_wrong;

CREATE TABLE web_tracking.dim_known_users
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

INSERT INTO web_tracking.dim_known_users
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

CREATE MATERIALIZED VIEW web_tracking.mv_dim_known_users
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

SYSTEM REFRESH VIEW web_tracking.mv_dim_known_users;
