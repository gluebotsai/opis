-- Per-org SIP realm (REGISTER/INVITE host). Backfill {id}.call.worktual.com;
-- new rows get the same value from a BEFORE INSERT trigger when omitted.

ALTER TABLE accounts.organizations
  ADD COLUMN IF NOT EXISTS sip_domain_name VARCHAR(255);

UPDATE accounts.organizations
SET sip_domain_name = id::text || '.call.worktual.com'
WHERE sip_domain_name IS NULL OR btrim(sip_domain_name) = '';

ALTER TABLE accounts.organizations
  ALTER COLUMN sip_domain_name SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_sip_domain_name_key
  ON accounts.organizations (sip_domain_name);

CREATE OR REPLACE FUNCTION accounts.set_organization_sip_domain_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sip_domain_name IS NULL OR btrim(NEW.sip_domain_name) = '' THEN
    NEW.sip_domain_name := NEW.id::text || '.call.worktual.com';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_sip_domain_name_bi ON accounts.organizations;

CREATE TRIGGER organizations_sip_domain_name_bi
BEFORE INSERT ON accounts.organizations
FOR EACH ROW
EXECUTE FUNCTION accounts.set_organization_sip_domain_name();

COMMENT ON COLUMN accounts.organizations.sip_domain_name IS
  'SIP realm/host for this org, e.g. 1000.call.worktual.com';
