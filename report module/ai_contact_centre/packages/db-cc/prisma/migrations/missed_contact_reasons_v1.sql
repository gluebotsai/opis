-- Lookup for missed-contact reasons (labels live in DB, not app-only).
-- Collapse agent_missed_contacts.reason to two codes. Does not change
-- conversation lifecycle / routing_exhausted events.

CREATE TABLE IF NOT EXISTS ccass.missed_contact_reasons (
  id SMALLINT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0
);

INSERT INTO ccass.missed_contact_reasons (id, code, name, description, sort_order)
VALUES
  (
    1,
    'no_agent_available',
    'No agents available',
    'No eligible agent was offered the conversation.',
    1
  ),
  (
    2,
    'offer_timeout',
    'Not picked up',
    'An agent was offered and did not accept in time.',
    2
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

UPDATE ccass.agent_missed_contacts
SET reason = CASE
  WHEN agent_id IS NULL THEN 'no_agent_available'
  ELSE 'offer_timeout'
END
WHERE reason NOT IN ('no_agent_available', 'offer_timeout');

ALTER TABLE ccass.agent_missed_contacts
  DROP CONSTRAINT IF EXISTS agent_missed_contacts_reason_check;

ALTER TABLE ccass.agent_missed_contacts
  DROP CONSTRAINT IF EXISTS agent_missed_contacts_reason_fkey;

ALTER TABLE ccass.agent_missed_contacts
  ADD CONSTRAINT agent_missed_contacts_reason_fkey
  FOREIGN KEY (reason) REFERENCES ccass.missed_contact_reasons (code);

COMMENT ON TABLE ccass.missed_contact_reasons IS
  'Global lookup of missed-contact reasons (no agent offered vs offered and not picked up).';
