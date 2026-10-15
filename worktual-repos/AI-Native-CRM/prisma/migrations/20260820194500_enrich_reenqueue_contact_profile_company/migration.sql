-- Re-enqueue enrichment when CRM company link changes on contact_profiles.

CREATE OR REPLACE FUNCTION crm.reenqueue_lead_enrichment_on_contact_profile_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO crm, cdp, public
AS $$
BEGIN
  IF NEW.organization_id IS NULL OR NEW.account_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id
  THEN
    RETURN NEW;
  END IF;

  PERFORM crm.reenqueue_lead_enrichment_for_contact(
    NEW.organization_id,
    NEW.account_contact_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_profiles_reenqueue_lead_enrichment_company ON crm.contact_profiles;
CREATE TRIGGER contact_profiles_reenqueue_lead_enrichment_company
  AFTER INSERT OR UPDATE OF company_id ON crm.contact_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE crm.reenqueue_lead_enrichment_on_contact_profile_company();
