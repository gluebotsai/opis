-- Move person lifecycle from crm.contact_profiles.lifecycle_stage to cdp.customer_profile.contact_type.

-- 1) Backfill CDP from CRM overlay where present.
UPDATE cdp.customer_profile cp
SET contact_type = cp_overlay.lifecycle_stage,
    updated_at = NOW()
FROM crm.contact_profiles cp_overlay
WHERE cp.cdp_id = cp_overlay.account_contact_id
  AND cp_overlay.lifecycle_stage IS NOT NULL
  AND cp_overlay.lifecycle_stage <> ''
  AND (cp.contact_type IS NULL OR cp.contact_type = '');

-- 2) Default remaining nulls to lead.
UPDATE cdp.customer_profile
SET contact_type = 'lead',
    updated_at = NOW()
WHERE contact_type IS NULL OR contact_type = '';

-- 3) CDP enrich trigger: stop writing lifecycle_stage on overlay; ensure contact_type on profile.
CREATE OR REPLACE FUNCTION crm.enqueue_lead_enrichment_on_cdp_customer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO crm, cdp, public
AS $$
DECLARE
  job_id TEXT;
  profile_id TEXT;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.cdp_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.contact_type IS NULL OR NEW.contact_type = '' THEN
    UPDATE cdp.customer_profile
    SET contact_type = 'lead', updated_at = NOW()
    WHERE cdp_id = NEW.cdp_id;
  END IF;

  profile_id := 'cp' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO crm.contact_profiles (
    id,
    account_contact_id,
    organization_id,
    lead_status,
    lead_source,
    tags,
    crm_status,
    is_pinned,
    created_at,
    updated_at
  ) VALUES (
    profile_id,
    NEW.cdp_id,
    NEW.organization_id,
    'new',
    'cdp_ingest',
    ARRAY[]::text[],
    'active',
    false,
    NOW(),
    NOW()
  )
  ON CONFLICT (account_contact_id) DO NOTHING;

  job_id := 'cej' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO crm.lead_enrichment_jobs (
    id,
    organization_id,
    contact_id,
    company_id,
    status,
    attempts,
    max_attempts,
    next_retry_at,
    last_error,
    result_summary,
    created_at,
    updated_at,
    completed_at
  ) VALUES (
    job_id,
    NEW.organization_id,
    NEW.cdp_id,
    NULL,
    'pending',
    0,
    5,
    NOW(),
    NULL,
    NULL,
    NOW(),
    NOW(),
    NULL
  )
  ON CONFLICT (organization_id, contact_id) DO UPDATE SET
    status = 'pending',
    next_retry_at = NOW(),
    last_error = NULL,
    completed_at = NULL,
    updated_at = NOW()
  WHERE crm.lead_enrichment_jobs.status IS DISTINCT FROM 'running';

  PERFORM pg_notify('crm_lead_enrichment', NEW.organization_id::text);
  RETURN NEW;
END;
$$;

-- 4) Analytics staging view — source contact_type from CDP instead of CRM column.
DROP VIEW IF EXISTS crm_staging.stg_contact_profiles;
CREATE VIEW crm_staging.stg_contact_profiles AS
SELECT cp.id AS contact_profile_id,
    cp.account_contact_id AS contact_id,
    cp.organization_id,
    cp.company_id,
    cp.location_id,
    cp.owner_user_id,
    COALESCE(p.contact_type, 'lead') AS contact_type,
    cp.lead_source,
    cp.lead_status,
    cp.disqualify_reason,
    cp.bant_budget,
    cp.bant_authority,
    cp.bant_need,
    cp.bant_timeline,
    cp.bant_budget IS TRUE
      AND cp.bant_authority IS TRUE
      AND cp.bant_need IS TRUE
      AND cp.bant_timeline IS TRUE AS is_mql_proxy,
    cp.converted_deal_id,
    cp.crm_status,
    cp.created_at,
    cp.updated_at
FROM crm.contact_profiles cp
LEFT JOIN cdp.customer_profile p ON p.cdp_id = cp.account_contact_id;

-- 5) Drop CRM column + indexes.
DROP INDEX IF EXISTS crm.contact_profiles_lifecycle_stage_lead_status_idx;
DROP INDEX IF EXISTS crm.contact_profiles_lifecycle_stage_idx;

ALTER TABLE crm.contact_profiles DROP COLUMN IF EXISTS lifecycle_stage;
