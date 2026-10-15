-- Session id of the follow-up auto-bot call published for a due callback.

ALTER TABLE ccass.voice_call_outcomes
  ADD COLUMN IF NOT EXISTS triggered_session_id VARCHAR(128);
