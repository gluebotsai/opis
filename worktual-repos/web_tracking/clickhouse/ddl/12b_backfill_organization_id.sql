-- One-time backfill: set organization_id on rows that are NULL today.
-- Run after 12_recreate_mv_organization_id.sql + 05 + 06 (+ 07) so new inserts also get org id.
-- Safe to re-run: only updates rows where organization_id IS NULL (or dim_websites = 0).
-- NOT applied by scripts/apply_clickhouse_ddl.py — run via migrate_clickhouse_organization_id.sh
--
-- ClickHouse mutations cannot use UPDATE ... FROM subqueries. Uses Join-engine lookup tables instead.

DROP TABLE IF EXISTS web_tracking._org_backfill_payload;
CREATE TABLE web_tracking._org_backfill_payload
(
    payload_id UUID,
    organization_id Nullable(UInt32)
)
ENGINE = Join(ANY, LEFT, payload_id);

INSERT INTO web_tracking._org_backfill_payload
SELECT
    payload_id,
    nullIf(
        coalesce(
            JSONExtractUInt(payload, 'organization_id'),
            JSONExtractUInt(payload, 'organizationId')
        ),
        0
    ) AS organization_id
FROM web_tracking.raw_payloads;

ALTER TABLE web_tracking.events_staging
UPDATE organization_id = joinGet('web_tracking._org_backfill_payload', 'organization_id', payload_id)
WHERE organization_id IS NULL;

DROP TABLE IF EXISTS web_tracking._org_backfill_session;
CREATE TABLE web_tracking._org_backfill_session
(
    session_id String,
    organization_id Nullable(UInt32)
)
ENGINE = Join(ANY, LEFT, session_id);

INSERT INTO web_tracking._org_backfill_session
SELECT
    JSONExtractString(payload, 'sessionId') AS session_id,
    nullIf(
        max(coalesce(
            JSONExtractUInt(payload, 'organization_id'),
            JSONExtractUInt(payload, 'organizationId')
        )),
        0
    ) AS organization_id
FROM web_tracking.raw_payloads
WHERE JSONExtractString(payload, 'sessionId') != ''
GROUP BY session_id;

ALTER TABLE web_tracking.dim_sessions
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.fact_page_views
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.fact_interaction_events
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.fact_form_events
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.fact_conversion_events
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.fact_custom_events
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.fact_product_interactions
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.fact_performance_events
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.fact_error_events
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

DROP TABLE IF EXISTS web_tracking._org_backfill_website;
CREATE TABLE web_tracking._org_backfill_website
(
    website_id UInt32,
    organization_id Nullable(UInt32)
)
ENGINE = Join(ANY, LEFT, website_id);

INSERT INTO web_tracking._org_backfill_website
SELECT
    website_id,
    nullIf(
        max(coalesce(
            JSONExtractUInt(payload, 'organization_id'),
            JSONExtractUInt(payload, 'organizationId')
        )),
        0
    ) AS organization_id
FROM web_tracking.raw_payloads
GROUP BY website_id;

ALTER TABLE web_tracking.dim_visitors
UPDATE organization_id = joinGet('web_tracking._org_backfill_website', 'organization_id', website_id)
WHERE organization_id IS NULL;

ALTER TABLE web_tracking.dim_websites
UPDATE organization_id = coalesce(
    joinGet('web_tracking._org_backfill_website', 'organization_id', website_id),
    toUInt32(0)
)
WHERE organization_id = 0;

ALTER TABLE web_tracking.fact_replay_chunks
UPDATE organization_id = joinGet('web_tracking._org_backfill_session', 'organization_id', session_id)
WHERE organization_id IS NULL;

DROP TABLE IF EXISTS web_tracking._org_backfill_payload;
DROP TABLE IF EXISTS web_tracking._org_backfill_session;
DROP TABLE IF EXISTS web_tracking._org_backfill_website;
