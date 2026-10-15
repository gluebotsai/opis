-- DEPRECATED for guest synthesis — prefer 23_clear + payload-only MVs. May still help fix session-stamped user_id conflation.
-- Repair fact.user_id after session-level backfill (19b) stamped one login user_id on all
-- rows sharing session_id. Source of truth: events_staging (per payload).
--
-- Run only after explicit approval, after reconcile/staging_sync so staging is current:
--   python scripts/apply_clickhouse_manual.py clickhouse/ddl/21_restore_fact_user_id_from_staging.sql

DROP TABLE IF EXISTS web_tracking._pv_user_from_staging;
CREATE TABLE web_tracking._pv_user_from_staging
(
    page_view_id String,
    website_id UInt32,
    user_id String
)
ENGINE = Join(ANY, LEFT, page_view_id, website_id);

INSERT INTO web_tracking._pv_user_from_staging
SELECT
    page_view_id,
    website_id,
    user_id
FROM (
    SELECT
        page_view_id,
        website_id,
        argMax(user_id, event_ts) AS user_id
    FROM web_tracking.events_staging
    WHERE event_name = 'page_view'
      AND page_view_id != ''
    GROUP BY page_view_id, website_id
)
WHERE length(coalesce(user_id, '')) > 0;

ALTER TABLE web_tracking.fact_page_views
UPDATE user_id = joinGet(
    'web_tracking._pv_user_from_staging',
    'user_id',
    page_view_id,
    website_id
)
WHERE page_view_id != ''
  AND length(coalesce(joinGet(
      'web_tracking._pv_user_from_staging',
      'user_id',
      page_view_id,
      website_id
  ), '')) > 0;

DROP TABLE IF EXISTS web_tracking._ie_user_from_staging;
CREATE TABLE web_tracking._ie_user_from_staging
(
    event_id String,
    website_id UInt32,
    user_id String
)
ENGINE = Join(ANY, LEFT, event_id, website_id);

INSERT INTO web_tracking._ie_user_from_staging
SELECT
    event_id,
    website_id,
    user_id
FROM (
    SELECT
        event_id,
        website_id,
        argMax(user_id, event_ts) AS user_id
    FROM web_tracking.events_staging
    WHERE event_id != ''
      AND event_name != 'page_view'
    GROUP BY event_id, website_id
)
WHERE length(coalesce(user_id, '')) > 0;

ALTER TABLE web_tracking.fact_interaction_events
UPDATE user_id = joinGet(
    'web_tracking._ie_user_from_staging',
    'user_id',
    event_id,
    website_id
)
WHERE event_id != ''
  AND length(coalesce(joinGet(
      'web_tracking._ie_user_from_staging',
      'user_id',
      event_id,
      website_id
  ), '')) > 0;

DROP TABLE IF EXISTS web_tracking._pv_user_from_staging;
DROP TABLE IF EXISTS web_tracking._ie_user_from_staging;
