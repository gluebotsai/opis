-- Speed up contact list/search and reduce lock duration on hot paths.

CREATE INDEX IF NOT EXISTS idx_identity_keys_org_cdp_type
  ON cdp.identity_keys (organization_id, cdp_id, key_type);

CREATE INDEX IF NOT EXISTS idx_identity_keys_org_type_value_lower
  ON cdp.identity_keys (organization_id, key_type, lower(key_value));

CREATE INDEX IF NOT EXISTS idx_customer_profile_org_updated
  ON cdp.customer_profile (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_org_contact_updated
  ON ccass.conversations (organization_id, contact_id, updated_at DESC)
  WHERE contact_id IS NOT NULL;
