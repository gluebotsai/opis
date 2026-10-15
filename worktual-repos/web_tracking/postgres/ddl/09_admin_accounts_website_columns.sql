-- =============================================================================
-- Postgres: rename domain_id/domain_name -> website_id/website_url
--           organization_id UUID -> INTEGER
-- =============================================================================
-- Run on: public.admin_accounts @ worktual (10.180.0.126)
-- Run as: DB admin (e.g. nlp) — NOT from application deploy
--
-- After this script:
--   1) Re-run postgres/ddl/admin_accounts_ch_sync.sql (updated column grants)
--   2) Recreate ClickHouse dictionary (clickhouse/ddl/02b_dict_admin_accounts.sql)
--   3) SYSTEM RELOAD DICTIONARY web_tracking.dict_admin_accounts;
--   4) Restart api-node + ingest
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Rename columns (domain_* -> website_*)
-- -----------------------------------------------------------------------------
ALTER TABLE public.admin_accounts
  RENAME COLUMN domain_id TO website_id;

ALTER TABLE public.admin_accounts
  RENAME COLUMN domain_name TO website_url;

-- Unique index follows column rename in PG 11+; rename for clarity if needed:
ALTER INDEX IF EXISTS admin_accounts_domain_id_key
  RENAME TO admin_accounts_website_id_key;

-- -----------------------------------------------------------------------------
-- 2) organization_id: UUID -> INTEGER
--    USING NULL clears old UUID values; set integers in step 3.
-- -----------------------------------------------------------------------------
ALTER TABLE public.admin_accounts
  ALTER COLUMN organization_id TYPE INTEGER
  USING NULL;

-- -----------------------------------------------------------------------------
-- 3) Set your data (EDIT values before run)
-- -----------------------------------------------------------------------------

-- Main site example
UPDATE public.admin_accounts
SET
  website_url     = 'https://beta.worktual.co.uk',
  organization_id = 1,
  status          = 'active',
  is_active       = true,
  updated_at      = NOW()
WHERE website_id = 12345;

-- Add more sites under same org (unique website_id + unique email per row):
--
-- INSERT INTO public.admin_accounts (
--   admin_name, email, password_hash,
--   website_id, website_url, site_type,
--   status, organization_id, is_active, created_at, updated_at
-- ) VALUES (
--   'Worktual Admin', 'site2@company.com', '<bcrypt_hash>',
--   12346, 'https://shop.worktual.co.uk', 'ecommerce',
--   'active', 1, true, NOW(), NOW()
-- );

COMMIT;

-- -----------------------------------------------------------------------------
-- 4) Verify
-- -----------------------------------------------------------------------------
SELECT
  id,
  email,
  website_id,
  website_url,
  organization_id,
  site_type,
  status,
  is_active
FROM public.admin_accounts
ORDER BY organization_id, website_id;
