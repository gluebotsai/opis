BEGIN;

SET search_path TO ticketing;

ALTER TABLE ticketing.tickets
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_org_idempotency_key
  ON ticketing.tickets (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';

COMMIT;
