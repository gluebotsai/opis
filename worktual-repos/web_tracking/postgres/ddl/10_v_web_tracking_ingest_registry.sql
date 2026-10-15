-- My Accounts → flat website registry for ClickHouse dict_admin_accounts.
-- Run on worktual_bigint @ 10.180.0.126 (DB team or superuser).
--
-- Source: accounts.subscriptions / accounts.active_products → visitorAllowanceBySlot JSON
-- Not public.admin_accounts (legacy dev table — does not exist on My Accounts QA).
--
-- After this file:
--   psql ... -f postgres/ddl/admin_accounts_ch_sync.sql
--   DROP DICTIONARY IF EXISTS web_tracking.dict_admin_accounts;
--   python scripts/apply_clickhouse_ddl.py --dictionary-only
--   python scripts/verify_dict_admin_accounts.py

-- CREATE USER ch_sync WITH PASSWORD 'Click1234';
-- GRANT USAGE ON SCHEMA public TO ch_sync;

CREATE OR REPLACE VIEW public.v_web_tracking_ingest_registry AS
WITH org_ids AS (
    SELECT organization_id
    FROM accounts.subscriptions
    WHERE product_id = 'web-tracking'
      AND status <> 'cancelled'
    UNION
    SELECT pgl.organization_id
    FROM accounts.active_products ap
    JOIN accounts.product_go_live pgl
      ON pgl.lead_id = ap.lead_id
     AND pgl.product_id = ap.product_id
     AND pgl.branch_id = ap.branch_id
    WHERE ap.product_id = 'web-tracking'
),
chosen AS (
    SELECT
        o.organization_id,
        COALESCE(
            (
                SELECT s.entitlement_config
                FROM accounts.subscriptions s
                WHERE s.organization_id = o.organization_id
                  AND s.product_id = 'web-tracking'
                  AND s.status <> 'cancelled'
                ORDER BY s.id DESC
                LIMIT 1
            ),
            (
                SELECT ap.config
                FROM accounts.active_products ap
                JOIN accounts.product_go_live pgl
                  ON pgl.lead_id = ap.lead_id
                 AND pgl.product_id = ap.product_id
                 AND pgl.branch_id = ap.branch_id
                WHERE pgl.organization_id = o.organization_id
                  AND ap.product_id = 'web-tracking'
                LIMIT 1
            )
        ) AS config
    FROM org_ids o
),
slots AS (
    SELECT
        c.organization_id,
        slot.key AS website_id,
        slot.value->>'url' AS website_url
    FROM chosen c
    CROSS JOIN LATERAL jsonb_each(
        CASE
            WHEN jsonb_typeof(c.config->'visitorAllowanceBySlot') = 'object'
            THEN c.config->'visitorAllowanceBySlot'
            ELSE '{}'::jsonb
        END
    ) AS slot(key, value)
    WHERE c.config IS NOT NULL
      AND slot.key ~ '^[0-9]+$'
)
SELECT
    slots.website_id::integer         AS website_id,
    TRIM(slots.website_url)           AS website_url,
    'ecommerce'::text                 AS site_type,
    'active'::text                    AS status,
    slots.organization_id::bigint     AS organization_id,
    true                              AS is_active
FROM slots
WHERE COALESCE(TRIM(slots.website_url), '') <> '';

-- Verify (admin):
-- SELECT * FROM public.v_web_tracking_ingest_registry WHERE website_id = 1001;
