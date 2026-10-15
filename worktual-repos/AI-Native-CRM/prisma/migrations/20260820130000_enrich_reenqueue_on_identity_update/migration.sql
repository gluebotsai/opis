-- Re-enqueue lead enrichment when CDP identity arrives in staggered writes
-- (name INSERT → email/phone/company UPDATE). CRM-owned function; crm.* DML only.

CREATE OR REPLACE FUNCTION crm.reenqueue_lead_enrichment_for_contact(
  p_organization_id bigint,
  p_contact_id text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO crm, cdp, public
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_contact_id IS NULL OR btrim(p_contact_id) = '' THEN
    RETURN;
  END IF;

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
    'cej' || replace(gen_random_uuid()::text, '-', ''),
    p_organization_id,
    p_contact_id,
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
    status = CASE
      WHEN crm.lead_enrichment_jobs.status = 'running' THEN crm.lead_enrichment_jobs.status
      ELSE 'pending'
    END,
    next_retry_at = NOW(),
    last_error = NULL,
    completed_at = NULL,
    updated_at = NOW()
  WHERE crm.lead_enrichment_jobs.status IS DISTINCT FROM 'running';

  PERFORM pg_notify('crm_lead_enrichment', p_organization_id::text);
END;
$$;

CREATE OR REPLACE FUNCTION crm.reenqueue_lead_enrichment_on_customer_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO crm, cdp, public
AS $$
BEGIN
  IF NEW.organization_id IS NULL OR NEW.cdp_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND btrim(coalesce(OLD.company, '')) IS DISTINCT FROM btrim(coalesce(NEW.company, ''))
  THEN
    PERFORM crm.reenqueue_lead_enrichment_for_contact(
      NEW.organization_id,
      NEW.cdp_id::text
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm.reenqueue_lead_enrichment_on_identity_key_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO crm, cdp, public
AS $$
DECLARE
  v_cdp_id text;
  v_org_id bigint;
BEGIN
  v_cdp_id := coalesce(NEW.cdp_id, OLD.cdp_id)::text;
  IF v_cdp_id IS NULL OR btrim(v_cdp_id) = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF coalesce(NEW.key_type, OLD.key_type) NOT IN (
    'email', 'phone', 'email_secondary', 'phone_secondary'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.key_value IS NOT DISTINCT FROM OLD.key_value
  THEN
    RETURN NEW;
  END IF;

  IF btrim(coalesce(NEW.key_value, '')) = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT p.organization_id
    INTO v_org_id
    FROM cdp.customer_profile p
   WHERE p.cdp_id::text = v_cdp_id
   LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    PERFORM crm.reenqueue_lead_enrichment_for_contact(v_org_id, v_cdp_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS cdp_customer_profile_reenqueue_lead_enrichment ON cdp.customer_profile;
CREATE TRIGGER cdp_customer_profile_reenqueue_lead_enrichment
  AFTER UPDATE OF company ON cdp.customer_profile
  FOR EACH ROW
  EXECUTE PROCEDURE crm.reenqueue_lead_enrichment_on_customer_profile_update();

DROP TRIGGER IF EXISTS cdp_identity_keys_reenqueue_lead_enrichment ON cdp.identity_keys;
CREATE TRIGGER cdp_identity_keys_reenqueue_lead_enrichment
  AFTER INSERT OR UPDATE OF key_value ON cdp.identity_keys
  FOR EACH ROW
  EXECUTE PROCEDURE crm.reenqueue_lead_enrichment_on_identity_key_change();
