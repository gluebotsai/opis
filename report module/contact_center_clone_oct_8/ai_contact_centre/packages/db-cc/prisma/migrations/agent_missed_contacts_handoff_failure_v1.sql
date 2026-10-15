-- Allow org-level missed/abandoned rows when handoff fails before any agent offer.

ALTER TABLE ccass.agent_missed_contacts
  ALTER COLUMN agent_id DROP NOT NULL,
  ALTER COLUMN assigned_user_id DROP NOT NULL;

ALTER TABLE ccass.agent_missed_contacts
  DROP CONSTRAINT IF EXISTS agent_missed_contacts_reason_check;

ALTER TABLE ccass.agent_missed_contacts
  ADD CONSTRAINT agent_missed_contacts_reason_check
  CHECK (
    reason IN (
      'offer_timeout',
      'manual_reject',
      'no_agent_available',
      'routing_exhausted'
    )
  );

CREATE INDEX IF NOT EXISTS idx_agent_missed_contacts_org_missed_at
  ON ccass.agent_missed_contacts (organization_id, missed_at DESC);
