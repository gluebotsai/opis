-- Customer name, email, and campaign instruction saved with a call outcome.

ALTER TABLE ccass.voice_call_outcomes
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(200);

ALTER TABLE ccass.voice_call_outcomes
  ADD COLUMN IF NOT EXISTS email VARCHAR(320);

ALTER TABLE ccass.voice_call_outcomes
  ADD COLUMN IF NOT EXISTS instruction TEXT;
