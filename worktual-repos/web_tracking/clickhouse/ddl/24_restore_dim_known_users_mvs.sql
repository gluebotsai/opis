-- Restore dim_known_users pipeline (zero truncate — existing rows kept).
--
-- Problem: mv_dim_known_users was dropped (19_drop_mvs_user_id.sql) and not recreated,
-- so dim_known_users stopped updating while events_staging still receives identity events.
--
-- Strategy (two MVs → same ReplacingMergeTree table):
--   1) mv_dim_known_users_incremental — fires on each INSERT into events_staging (low latency).
--   2) mv_dim_known_users — REFRESH EVERY 1 MINUTE, full aggregate from staging (correct
--      first_identified_at / argMax traits; repairs any incremental gaps).
--
-- Events watched (SDK / ingest): identify, login, register, signup
-- Requires: non-empty user_id (column or props.userId or props.traits.userId)
--
-- Apply on live (after review):
--   python3 scripts/apply_clickhouse_manual.py clickhouse/ddl/24_restore_dim_known_users_mvs.sql --host <ch-host>
--
-- Verify:
--   SELECT name, engine FROM system.tables
--   WHERE database = 'web_tracking' AND name LIKE '%known%';
--   SYSTEM REFRESH VIEW web_tracking.mv_dim_known_users;

DROP VIEW IF EXISTS web_tracking.mv_dim_known_users;
DROP VIEW IF EXISTS web_tracking.mv_dim_known_users_incremental;

-- ---------------------------------------------------------------------------
-- Incremental: one row per identity event (latest wins on FINAL via updated_at)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW web_tracking.mv_dim_known_users_incremental
TO web_tracking.dim_known_users
AS
SELECT
    website_id,
    organization_id,
    user_id,
    visitor_id,
    email,
    phone,
    first_name,
    last_name,
    method,
    event_name AS last_event_type,
    traits_json,
    event_ts AS first_identified_at,
    event_ts AS last_identified_at,
    event_ts AS updated_at
FROM
(
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
            nullIf(JSONExtractString(props_json, 'first_name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'first_name'), ''),
            nullIf(JSONExtractString(props_json, 'name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'name'), ''),
            ''
        ) AS first_name,
        coalesce(
            nullIf(JSONExtractString(props_json, 'lastName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'lastName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), 'lastName'), ''),
            nullIf(JSONExtractString(props_json, 'last_name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'last_name'), ''),
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
);

-- ---------------------------------------------------------------------------
-- Refreshable: aggregate all identity history (min first / max last / argMax traits)
-- ---------------------------------------------------------------------------
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
FROM
(
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
            nullIf(JSONExtractString(props_json, 'first_name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'first_name'), ''),
            nullIf(JSONExtractString(props_json, 'name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'name'), ''),
            ''
        ) AS first_name,
        coalesce(
            nullIf(JSONExtractString(props_json, 'lastName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'lastName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), 'lastName'), ''),
            nullIf(JSONExtractString(props_json, 'last_name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'last_name'), ''),
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

-- ---------------------------------------------------------------------------
-- One-time catch-up: merge full staging aggregate into dim (no TRUNCATE)
-- ---------------------------------------------------------------------------
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
FROM
(
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
            nullIf(JSONExtractString(props_json, 'first_name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'first_name'), ''),
            nullIf(JSONExtractString(props_json, 'name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'name'), ''),
            ''
        ) AS first_name,
        coalesce(
            nullIf(JSONExtractString(props_json, 'lastName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'lastName'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(JSONExtractRaw(profiles_json, 'visitor'), 'traits'), 'lastName'), ''),
            nullIf(JSONExtractString(props_json, 'last_name'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(props_json, 'traits'), 'last_name'), ''),
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
