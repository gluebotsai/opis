-- Outcome label for one touch (call, email, meeting, message).
-- Free text from the disposition agent. Not a lead status and not an enum.

ALTER TABLE crm.contact_activities
  ADD COLUMN IF NOT EXISTS disposition VARCHAR(48),
  ADD COLUMN IF NOT EXISTS disposition_text_hash VARCHAR(64);
