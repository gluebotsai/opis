-- Cross-product grants (optional roles). Safe if roles already exist or CREATEROLE is missing.
-- Application currently uses a single DB user with FORCE RLS + session GUCs.

DO $$
BEGIN
  BEGIN
    CREATE ROLE wt_readonly NOLOGIN;
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipping wt_readonly role creation (insufficient privilege)';
      RETURN;
  END;

  GRANT USAGE ON SCHEMA platform, accounts, crm, cvm, ticketing, ccass, cdp, campaign TO wt_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA platform TO wt_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA accounts TO wt_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA crm TO wt_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA cvm TO wt_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA ticketing TO wt_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA ccass TO wt_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA cdp TO wt_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA campaign TO wt_readonly;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping wt_readonly grants (insufficient privilege)';
  WHEN undefined_object THEN
    RAISE NOTICE 'Skipping wt_readonly grants (role missing)';
END $$;
