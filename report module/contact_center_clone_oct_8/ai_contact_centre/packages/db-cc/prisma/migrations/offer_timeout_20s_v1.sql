-- Standard live-offer ringing timeout: 20 seconds (dev, test, production).

ALTER TABLE ccass.routing_policies
  ALTER COLUMN offer_timeout_seconds SET DEFAULT 20;

UPDATE ccass.routing_policies
SET offer_timeout_seconds = 20
WHERE offer_timeout_seconds IS DISTINCT FROM 20;
