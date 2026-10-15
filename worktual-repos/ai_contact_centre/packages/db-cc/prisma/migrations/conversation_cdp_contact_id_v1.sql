-- Link webchat/CDP contacts to conversations via text cdp_contact_id.

ALTER TABLE ccass.conversations
  ADD COLUMN IF NOT EXISTS cdp_contact_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_org_cdp_contact
  ON ccass.conversations (organization_id, cdp_contact_id)
  WHERE cdp_contact_id IS NOT NULL;

UPDATE ccass.conversations c
SET cdp_contact_id = ik.cdp_id,
    updated_at = NOW()
FROM cdp.identity_keys ik
WHERE c.organization_id = ik.organization_id
  AND c.visitor_id = ik.key_value
  AND ik.key_type = 'webchat_visitor'
  AND c.cdp_contact_id IS NULL
  AND c.contact_id IS NULL;
