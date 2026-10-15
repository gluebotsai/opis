-- CRM person keys follow cdp.customer_profile.cdp_id (text).
-- Do not ALTER cdp/accounts. Existing numeric ids become digit strings.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'crm'
      AND c.column_name IN ('contact_id', 'account_contact_id')
      AND c.data_type = 'bigint'
  LOOP
    EXECUTE format(
      'ALTER TABLE crm.%I ALTER COLUMN %I TYPE text USING %I::text',
      r.table_name,
      r.column_name,
      r.column_name
    );
  END LOOP;
END $$;

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

  profile_id := 'cp' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO crm.contact_profiles (
    id,
    account_contact_id,
    organization_id,
    lifecycle_stage,
    lead_status,
    lead_source,
    tags,
    crm_status,
    is_pinned,
    created_at,
    updated_at
  ) VALUES (
    profile_id,
    NEW.cdp_id::text,
    NEW.organization_id,
    'lead',
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
    NEW.cdp_id::text,
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
