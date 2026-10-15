-- New CDP people: CRM overlay lead_source copies acquisition_channel.
-- Do not stamp the placeholder cdp_ingest. Existing profiles are left unchanged.

CREATE OR REPLACE FUNCTION crm.enqueue_lead_enrichment_on_cdp_customer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO crm, cdp, public
AS $$
DECLARE
  job_id TEXT;
  profile_id TEXT;
  v_type TEXT;
  v_source TEXT;
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

  v_source := NULLIF(BTRIM(NEW.acquisition_channel), '');
  IF lower(coalesce(v_source, '')) = 'cdp_ingest' THEN
    v_source := NULL;
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
    v_source,
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
