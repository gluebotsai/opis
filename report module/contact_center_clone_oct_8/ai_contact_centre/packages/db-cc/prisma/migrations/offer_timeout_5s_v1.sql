-- Reduce default live-offer ringing timeout from 30s to 5s.

ALTER TABLE ccass.routing_policies
  ALTER COLUMN offer_timeout_seconds SET DEFAULT 5;

UPDATE ccass.routing_policies
SET offer_timeout_seconds = 5
WHERE offer_timeout_seconds = 30;
