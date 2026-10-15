-- Cross-channel contact identity: link channel identifiers to CDP contacts.

CREATE TABLE IF NOT EXISTS cdp.contact_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  identity_type VARCHAR(32) NOT NULL
    CHECK (identity_type IN ('email', 'phone', 'webchat_visitor', 'whatsapp_phone')),
  identity_value VARCHAR(320) NOT NULL,
  source_channel VARCHAR(32),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cdp_contact_identities_org_type_value_key
    UNIQUE (organization_id, identity_type, identity_value)
);

CREATE INDEX IF NOT EXISTS idx_cdp_contact_identities_contact
  ON cdp.contact_identities (organization_id, contact_id);

-- Legacy cdp.contacts may be absent on newer CDP schemas; apply email relaxations only when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'cdp' AND table_name = 'contacts'
  ) THEN
    ALTER TABLE cdp.contacts
      ALTER COLUMN primary_email DROP NOT NULL;

    ALTER TABLE cdp.contacts
      DROP CONSTRAINT IF EXISTS cdp_contacts_org_email_uq;

    CREATE UNIQUE INDEX IF NOT EXISTS cdp_contacts_org_email_uq
      ON cdp.contacts (organization_id, lower(primary_email))
      WHERE primary_email IS NOT NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_cdp_interactions_org_contact_activity
  ON cdp.interactions (organization_id, contact_id, last_activity_at DESC)
  WHERE contact_id IS NOT NULL;
