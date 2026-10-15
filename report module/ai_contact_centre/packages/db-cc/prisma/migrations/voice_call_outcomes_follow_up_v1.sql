-- Customer number and follow-up status for a campaign call outcome.
-- Callback rows wait as pending. The other outcomes are closed and are not dialed again.

ALTER TABLE ccass.voice_call_outcomes
  ADD COLUMN IF NOT EXISTS mobile VARCHAR(32);

ALTER TABLE ccass.voice_call_outcomes
  ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'closed';

ALTER TABLE ccass.voice_call_outcomes
  DROP CONSTRAINT IF EXISTS voice_call_outcomes_status_check;

ALTER TABLE ccass.voice_call_outcomes
  ADD CONSTRAINT voice_call_outcomes_status_check CHECK (
    (
      outcome = 'Callback'
      AND status IN ('pending', 'triggered')
    )
    OR (
      outcome <> 'Callback'
      AND status = 'closed'
    )
  );

CREATE INDEX IF NOT EXISTS idx_voice_call_outcomes_pending
  ON ccass.voice_call_outcomes (callback_at)
  WHERE status = 'pending';
