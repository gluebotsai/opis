-- CDP insert is the source-of-truth contact event (MyAccount / campaign / Shopify).
-- Signal-only: ensure a thin crm.contact_profiles overlay + pending enrich job + NOTIFY.
-- Never calls HTTP or LLM. Approved exception to add TRIGGER/FUNCTION touching cdp.customer_profile.

CREATE OR REPLACE FUNCTION crm.enqueue_lead_enrichment_on_cdp_customer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_id TEXT;
  profile_id TEXT;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.cdp_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Thin CRM overlay so the contact appears in CRM list / detail.
  -- cdp_id is text (UUID-shaped) on Worktual; CRM FKs are uuid.
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
    NEW.cdp_id::uuid,
    NEW.organization_id::uuid,
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
    NEW.organization_id::uuid,
    NEW.cdp_id::uuid,
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

DROP TRIGGER IF EXISTS cdp_customer_profile_enqueue_lead_enrichment ON cdp.customer_profile;

CREATE TRIGGER cdp_customer_profile_enqueue_lead_enrichment
  AFTER INSERT ON cdp.customer_profile
  FOR EACH ROW
  EXECUTE PROCEDURE crm.enqueue_lead_enrichment_on_cdp_customer();
