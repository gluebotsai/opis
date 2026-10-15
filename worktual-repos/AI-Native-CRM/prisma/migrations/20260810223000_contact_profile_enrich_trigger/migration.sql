-- Signal-only: enqueue lead enrichment when a CRM contact profile is created
-- (MyAccount / campaign / Shopify / CRM UI). Never calls HTTP or LLM.

CREATE OR REPLACE FUNCTION enqueue_lead_enrichment_on_contact_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  job_id TEXT;
BEGIN
  IF NEW.organization_id IS NULL OR NEW.account_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  job_id := 'cej' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO lead_enrichment_jobs (
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
    company_id = COALESCE(EXCLUDED.company_id, lead_enrichment_jobs.company_id),
    status = 'pending',
    next_retry_at = NOW(),
    last_error = NULL,
    completed_at = NULL,
    updated_at = NOW()
  WHERE lead_enrichment_jobs.status IS DISTINCT FROM 'running';

  PERFORM pg_notify('crm_lead_enrichment', NEW.organization_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_profiles_enqueue_lead_enrichment ON contact_profiles;

CREATE TRIGGER contact_profiles_enqueue_lead_enrichment
  AFTER INSERT ON contact_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE enqueue_lead_enrichment_on_contact_profile();
