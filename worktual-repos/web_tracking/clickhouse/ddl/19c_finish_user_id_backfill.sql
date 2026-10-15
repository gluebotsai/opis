-- Finish user_id backfill after 19b stopped at _user_backfill_event INSERT (ClickHouse 26 aggregation).
-- Safe if 19b already ran payload + session + fact UPDATEs: only event/visitor replay chunks + dim_visitors.

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

DROP TABLE IF EXISTS web_tracking._user_backfill_event;
DROP TABLE IF EXISTS web_tracking._user_backfill_visitor;
