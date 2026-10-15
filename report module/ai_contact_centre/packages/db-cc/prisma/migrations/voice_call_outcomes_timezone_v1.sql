-- Store the customer timezone with a campaign call outcome.

ALTER TABLE ccass.voice_call_outcomes
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);

ALTER TABLE ccass.voice_call_outcomes
  DROP CONSTRAINT IF EXISTS voice_call_outcomes_callback_check;

ALTER TABLE ccass.voice_call_outcomes
  ADD CONSTRAINT voice_call_outcomes_callback_check CHECK (
    (
      outcome = 'Callback'
      AND callback_at IS NOT NULL
      AND NULLIF(btrim(timezone), '') IS NOT NULL
    )
    OR (outcome <> 'Callback' AND callback_at IS NULL)
  );
