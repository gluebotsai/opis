-- Ticketing hub/spoke cutover (ticketing schema only).
-- 1) Push existing customers into cdp.customer_profile + cdp.identity_keys
-- 2) Rename customers -> contact_profile; keep display cache + cdp_id
-- 3) Retarget product links toward inventory.products (text id)
-- 4) Retarget staging view to contact_profile
-- Does NOT drop/alter other-schema table definitions (CDP/inventory) beyond INSERTs.

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Stage: add cdp_id on customers, push person rows into CDP
-- ---------------------------------------------------------------------------
ALTER TABLE ticketing.customers
  ADD COLUMN IF NOT EXISTS cdp_id TEXT;

DO $$
DECLARE
  r RECORD;
  v_cdp TEXT;
  v_first TEXT;
  v_last TEXT;
  v_email TEXT;
  v_phone TEXT;
  parts TEXT[];
BEGIN
  FOR r IN
    SELECT *
    FROM ticketing.customers
    WHERE cdp_id IS NULL OR btrim(cdp_id) = ''
    ORDER BY id
  LOOP
    v_cdp := NULL;
    v_email := NULLIF(lower(btrim(COALESCE(r.email, ''))), '');
    v_phone := NULLIF(regexp_replace(COALESCE(r.phone, ''), '[^0-9+]', '', 'g'), '');

    IF v_email IS NOT NULL THEN
      SELECT ik.cdp_id INTO v_cdp
      FROM cdp.identity_keys ik
      WHERE ik.organization_id = r.organization_id
        AND ik.key_type = 'email'
        AND lower(ik.key_value) = v_email
      LIMIT 1;
    END IF;

    IF v_cdp IS NULL AND v_phone IS NOT NULL AND length(regexp_replace(v_phone, '[^0-9]', '', 'g')) >= 7 THEN
      SELECT ik.cdp_id INTO v_cdp
      FROM cdp.identity_keys ik
      WHERE ik.organization_id = r.organization_id
        AND ik.key_type = 'phone'
        AND (
          regexp_replace(ik.key_value, '[^0-9]', '', 'g') = regexp_replace(v_phone, '[^0-9]', '', 'g')
          OR right(regexp_replace(ik.key_value, '[^0-9]', '', 'g'), 10)
             = right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 10)
        )
      LIMIT 1;
    END IF;

    IF v_cdp IS NULL THEN
      v_cdp := gen_random_uuid()::text;
      parts := regexp_split_to_array(btrim(COALESCE(r.name, '')), '\s+');
      v_first := parts[1];
      IF array_length(parts, 1) > 1 THEN
        v_last := array_to_string(parts[2:array_length(parts, 1)], ' ');
      ELSE
        v_last := NULL;
      END IF;

      PERFORM set_config('app.current_org_id', r.organization_id::text, true);

      INSERT INTO cdp.customer_profile (
        cdp_id, first_name, last_name, organization_id, tenant_id,
        custom_fields, preferences_json, consent_json, traits_json,
        created_at, updated_at
      ) VALUES (
        v_cdp, v_first, v_last, r.organization_id, 'default',
        jsonb_build_object(
          'source', 'ticketing_migration',
          'ticketing_customer_id', r.id,
          'external_id', r.external_id
        ),
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
        COALESCE(r.created_at, NOW()), NOW()
      );
    END IF;

    PERFORM set_config('app.current_org_id', r.organization_id::text, true);

    IF v_email IS NOT NULL THEN
      INSERT INTO cdp.identity_keys (
        identity_id, cdp_id, key_type, key_value, source_system,
        verified, organization_id, custom_fields
      ) VALUES (
        gen_random_uuid()::text, v_cdp, 'email', v_email, 'ticketing',
        false, r.organization_id, '{}'::jsonb
      )
      ON CONFLICT (organization_id, key_type, key_value) DO NOTHING;
    END IF;

    IF v_phone IS NOT NULL AND length(regexp_replace(v_phone, '[^0-9]', '', 'g')) >= 7 THEN
      INSERT INTO cdp.identity_keys (
        identity_id, cdp_id, key_type, key_value, source_system,
        verified, organization_id, custom_fields
      ) VALUES (
        gen_random_uuid()::text, v_cdp, 'phone', v_phone, 'ticketing',
        false, r.organization_id, '{}'::jsonb
      )
      ON CONFLICT (organization_id, key_type, key_value) DO NOTHING;
    END IF;

    UPDATE ticketing.customers
    SET cdp_id = v_cdp
    WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE ticketing.customers
  ALTER COLUMN cdp_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_org_cdp
  ON ticketing.customers (organization_id, cdp_id);

-- ---------------------------------------------------------------------------
-- B. Rename customers -> contact_profile
-- Keep name/email/phone as denormalized display cache (CDP is SoR).
-- ---------------------------------------------------------------------------
ALTER TABLE ticketing.customers RENAME TO contact_profile;

ALTER TABLE ticketing.contact_profile RENAME CONSTRAINT customers_pkey TO contact_profile_pkey;
ALTER TABLE ticketing.contact_profile
  RENAME CONSTRAINT customers_organization_id_fkey TO contact_profile_organization_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_account_id_fkey'
      AND conrelid = 'ticketing.contact_profile'::regclass
  ) THEN
    ALTER TABLE ticketing.contact_profile
      RENAME CONSTRAINT customers_account_id_fkey TO contact_profile_account_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_status_check'
      AND conrelid = 'ticketing.contact_profile'::regclass
  ) THEN
    ALTER TABLE ticketing.contact_profile
      RENAME CONSTRAINT customers_status_check TO contact_profile_status_check;
  END IF;
END $$;

ALTER INDEX IF EXISTS ticketing.idx_customers_organization_id
  RENAME TO idx_contact_profile_organization_id;
ALTER INDEX IF EXISTS ticketing.idx_customers_org_cdp
  RENAME TO idx_contact_profile_org_cdp;
ALTER INDEX IF EXISTS ticketing.idx_customers_org_email_ci
  RENAME TO idx_contact_profile_org_email_ci;
ALTER INDEX IF EXISTS ticketing.idx_customers_org_phone
  RENAME TO idx_contact_profile_org_phone;

COMMENT ON TABLE ticketing.contact_profile IS
  'Support contact ops + portal auth; person SoR is cdp.customer_profile via cdp_id. name/email/phone are display cache.';
COMMENT ON COLUMN ticketing.contact_profile.cdp_id IS
  'FK-style link to cdp.customer_profile.cdp_id (hub person id)';
COMMENT ON COLUMN ticketing.contact_profile.name IS
  'Display cache from CDP; not source of truth';
COMMENT ON COLUMN ticketing.contact_profile.email IS
  'Display cache from CDP identity_keys; not source of truth';
COMMENT ON COLUMN ticketing.contact_profile.phone IS
  'Display cache from CDP identity_keys; not source of truth';

-- ---------------------------------------------------------------------------
-- C. contact_products + account_products -> inventory product ids (text)
-- ---------------------------------------------------------------------------
ALTER TABLE ticketing.customer_products RENAME TO contact_products;
ALTER TABLE ticketing.contact_products
  RENAME COLUMN customer_id TO contact_profile_id;

ALTER TABLE ticketing.contact_products
  DROP CONSTRAINT IF EXISTS customer_products_customer_id_fkey;
ALTER TABLE ticketing.contact_products
  DROP CONSTRAINT IF EXISTS customer_products_product_id_fkey;
ALTER TABLE ticketing.contact_products
  DROP CONSTRAINT IF EXISTS customer_products_pkey;

ALTER TABLE ticketing.contact_products
  ALTER COLUMN product_id TYPE TEXT USING product_id::text;

ALTER TABLE ticketing.contact_products
  ADD CONSTRAINT contact_products_pkey PRIMARY KEY (contact_profile_id, product_id);

ALTER TABLE ticketing.contact_products
  ADD CONSTRAINT contact_products_contact_profile_id_fkey
  FOREIGN KEY (contact_profile_id) REFERENCES ticketing.contact_profile(id) ON DELETE CASCADE;

COMMENT ON COLUMN ticketing.contact_products.product_id IS
  'inventory.products.id (text); entitlement link';

ALTER TABLE ticketing.account_products
  DROP CONSTRAINT IF EXISTS account_products_product_id_fkey;
ALTER TABLE ticketing.account_products
  ALTER COLUMN product_id TYPE TEXT USING product_id::text;

COMMENT ON COLUMN ticketing.account_products.product_id IS
  'inventory.products.id (text)';

-- ---------------------------------------------------------------------------
-- D. Portal FKs -> contact_profile
-- ---------------------------------------------------------------------------
ALTER TABLE ticketing.customer_portal_sessions
  DROP CONSTRAINT IF EXISTS customer_portal_sessions_customer_id_fkey;
ALTER TABLE ticketing.customer_portal_sessions
  ADD CONSTRAINT customer_portal_sessions_contact_profile_id_fkey
  FOREIGN KEY (customer_id) REFERENCES ticketing.contact_profile(id) ON DELETE CASCADE;

ALTER TABLE ticketing.customer_otp_challenges
  DROP CONSTRAINT IF EXISTS customer_otp_challenges_customer_id_fkey;
ALTER TABLE ticketing.customer_otp_challenges
  ADD CONSTRAINT customer_otp_challenges_contact_profile_id_fkey
  FOREIGN KEY (customer_id) REFERENCES ticketing.contact_profile(id) ON DELETE CASCADE;

ALTER TABLE ticketing.customer_password_tokens
  DROP CONSTRAINT IF EXISTS customer_password_tokens_customer_id_fkey;
ALTER TABLE ticketing.customer_password_tokens
  ADD CONSTRAINT customer_password_tokens_contact_profile_id_fkey
  FOREIGN KEY (customer_id) REFERENCES ticketing.contact_profile(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- E. Staging / marts views that referenced ticketing.customers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ticketing_staging.stg_customers AS
SELECT
  id::text AS customer_id,
  organization_id::text AS organization_id,
  account_id::text AS account_id,
  external_id,
  name AS customer_name,
  email AS customer_email,
  status,
  total_tickets,
  created_at,
  updated_at,
  cdp_id
FROM ticketing.contact_profile;

COMMIT;
