-- Name-only people are contacts, not leads. Empty CDP contact_type defaults to
-- 'contact'. Lead enrichment jobs are only created for contact_type = lead.
-- Existing leads are not rewritten (no demote / no backfill).

CREATE OR REPLACE FUNCTION crm.enqueue_lead_enrichment_on_cdp_customer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO crm, cdp, public
AS $$
DECLARE
  job_id TEXT;
  profile_id TEXT;
  v_type TEXT;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.cdp_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_type := lower(btrim(coalesce(NEW.contact_type, '')));
  IF v_type = '' THEN
    UPDATE cdp.customer_profile
    SET contact_type = 'contact', updated_at = NOW()
    WHERE cdp_id = NEW.cdp_id;
    v_type := 'contact';
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

  IF v_type IS DISTINCT FROM 'lead' THEN
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION crm.enqueue_lead_enrichment_on_contact_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO crm, cdp, public
AS $$
DECLARE
  job_id TEXT;
  v_type TEXT;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.account_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lower(coalesce(p.contact_type, 'contact'))
    INTO v_type
    FROM cdp.customer_profile p
   WHERE p.cdp_id::text = NEW.account_contact_id::text
   LIMIT 1;

  IF v_type IS DISTINCT FROM 'lead' THEN
    RETURN NEW;
  END IF;

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
    NEW.account_contact_id,
    NEW.company_id,
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
    company_id = COALESCE(EXCLUDED.company_id, crm.lead_enrichment_jobs.company_id),
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

DROP VIEW IF EXISTS crm_staging.stg_contact_profiles;
CREATE VIEW crm_staging.stg_contact_profiles AS
SELECT cp.id AS contact_profile_id,
    cp.account_contact_id AS contact_id,
    cp.organization_id,
    cp.company_id,
    cp.location_id,
    cp.owner_user_id,
    COALESCE(p.contact_type, 'contact') AS contact_type,
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
