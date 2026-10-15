-- One-time backfill: set user_id on pipeline rows from raw_payloads / events_staging.
-- Run after 19_drop_mvs_user_id.sql + MV recreate (05, 06, 07, 14, 15/17) so new inserts also get user_id.
-- Safe to re-run: only updates rows where user_id = '' (or empty).
-- NOT applied by scripts/apply_clickhouse_ddl.py — run via migrate_clickhouse_user_id.sh
--
-- Best-effort for TTL-truncated facts where raw_payloads / staging no longer exist.

DROP TABLE IF EXISTS web_tracking._user_backfill_payload;
CREATE TABLE web_tracking._user_backfill_payload
(
    payload_id UUID,
    user_id String
)
ENGINE = Join(ANY, LEFT, payload_id);

INSERT INTO web_tracking._user_backfill_payload
SELECT
    payload_id,
    coalesce(
        nullIf(JSONExtractString(payload, 'userId'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'visitor', 'userId'), ''),
        ''
    ) AS user_id
FROM web_tracking.raw_payloads
WHERE coalesce(
    nullIf(JSONExtractString(payload, 'userId'), ''),
    nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'visitor', 'userId'), ''),
    ''
) != '';

ALTER TABLE web_tracking.events_staging
UPDATE user_id = joinGet('web_tracking._user_backfill_payload', 'user_id', payload_id)
WHERE user_id = '';

DROP TABLE IF EXISTS web_tracking._user_backfill_session;
CREATE TABLE web_tracking._user_backfill_session
(
    session_id String,
    user_id String
)
ENGINE = Join(ANY, LEFT, session_id);

INSERT INTO web_tracking._user_backfill_session
SELECT
    JSONExtractString(payload, 'sessionId') AS session_id,
    argMax(
        coalesce(
            nullIf(JSONExtractString(payload, 'userId'), ''),
            nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'visitor', 'userId'), ''),
            ''
        ),
        received_at
    ) AS user_id
FROM web_tracking.raw_payloads
WHERE JSONExtractString(payload, 'sessionId') != ''
  AND coalesce(
        nullIf(JSONExtractString(payload, 'userId'), ''),
        nullIf(JSONExtractString(JSONExtractRaw(payload, 'profiles'), 'visitor', 'userId'), ''),
        ''
      ) != ''
GROUP BY session_id;

ALTER TABLE web_tracking.dim_sessions
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_page_views
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_interaction_events
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_form_events
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_conversion_events
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_custom_events
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_product_interactions
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_performance_events
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_error_events
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_cookie_operations
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.fact_replay_chunks
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

ALTER TABLE web_tracking.session_replay_chunks
UPDATE user_id = joinGet('web_tracking._user_backfill_session', 'user_id', session_id)
WHERE user_id = '';

DROP TABLE IF EXISTS web_tracking._user_backfill_event;
CREATE TABLE web_tracking._user_backfill_event
(
    event_id String,
    user_id String
)
ENGINE = Join(ANY, LEFT, event_id);

INSERT INTO web_tracking._user_backfill_event
SELECT
    event_id,
    argMax(user_id, event_ts) AS user_id
FROM (
    SELECT event_id, user_id, event_ts
    FROM web_tracking.events_staging
    WHERE length(user_id) > 0
) AS staging_with_user
GROUP BY event_id;

ALTER TABLE web_tracking.session_replay_chunks
UPDATE user_id = joinGet('web_tracking._user_backfill_event', 'user_id', event_id)
WHERE user_id = '';

DROP TABLE IF EXISTS web_tracking._user_backfill_visitor;
CREATE TABLE web_tracking._user_backfill_visitor
(
    website_id UInt32,
    visitor_id String,
    user_id String
)
ENGINE = Join(ANY, LEFT, website_id, visitor_id);

INSERT INTO web_tracking._user_backfill_visitor
SELECT
    website_id,
    visitor_id,
    argMax(user_id, event_ts) AS user_id
FROM (
    SELECT website_id, visitor_id, user_id, event_ts
    FROM web_tracking.events_staging
    WHERE length(user_id) > 0
) AS staging_with_user
GROUP BY website_id, visitor_id;

ALTER TABLE web_tracking.dim_visitors
UPDATE user_id = joinGet('web_tracking._user_backfill_visitor', 'user_id', website_id, visitor_id)
WHERE user_id = '';

DROP TABLE IF EXISTS web_tracking._user_backfill_payload;
DROP TABLE IF EXISTS web_tracking._user_backfill_session;
DROP TABLE IF EXISTS web_tracking._user_backfill_event;
DROP TABLE IF EXISTS web_tracking._user_backfill_visitor;
