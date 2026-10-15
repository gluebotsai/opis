-- Cleanup after hub org+agents cutover: drop bootstrap-recreated leftovers
-- and ensure FKs point at accounts.organizations. Never inserts into accounts.*.

BEGIN;

-- Empty legacy tables recreated by old CREATE TABLE IF NOT EXISTS bootstrap
DROP TABLE IF EXISTS ticketing.customer_products CASCADE;
DROP TABLE IF EXISTS ticketing.contact_products CASCADE;
DROP TABLE IF EXISTS ticketing.account_products CASCADE;
DROP TABLE IF EXISTS ticketing.products CASCADE;
DROP TABLE IF EXISTS ticketing.users CASCADE;
DROP TABLE IF EXISTS ticketing.customers CASCADE;

-- Duplicate empty B2B table (real table is ticketing_accounts)
DROP TABLE IF EXISTS ticketing.accounts CASCADE;

-- Drop leftover spoke orgs (live data already on accounts.organizations / org_settings)
DROP TABLE IF EXISTS ticketing.organizations CASCADE;

-- Ensure tickets.organization_id → accounts.organizations
ALTER TABLE ticketing.tickets
  DROP CONSTRAINT IF EXISTS tickets_organization_id_fkey;
ALTER TABLE ticketing.tickets
  ADD CONSTRAINT tickets_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES accounts.organizations(id) ON DELETE CASCADE;

-- Remappoint any remaining organization_id FKs still missing / wrong
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND NOT a.attisdropped
    WHERE c.contype = 'f'
      AND a.attname = 'organization_id'
      AND c.conrelid::regclass::text LIKE 'ticketing.%'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%accounts.organizations%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES accounts.organizations(id) ON DELETE CASCADE',
      r.tbl,
      r.conname
    );
  END LOOP;
END $$;

-- Tables with organization_id but no FK at all
DO $$
DECLARE
  r RECORD;
  conname text;
BEGIN
  FOR r IN
    SELECT c.oid AS relid, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'ticketing' AND c.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint x
        JOIN pg_attribute aa ON aa.attrelid = x.conrelid AND aa.attnum = ANY (x.conkey) AND NOT aa.attisdropped
        WHERE x.conrelid = c.oid AND x.contype = 'f' AND aa.attname = 'organization_id'
      )
  LOOP
    conname := r.relname || '_organization_id_fkey';
    BEGIN
      EXECUTE format(
        'ALTER TABLE ticketing.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES accounts.organizations(id) ON DELETE CASCADE',
        r.relname,
        conname
      );
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    WHEN others THEN
      RAISE NOTICE 'skip FK on %.%: %', r.nspname, r.relname, SQLERRM;
    END;
  END LOOP;
END $$;

COMMIT;
