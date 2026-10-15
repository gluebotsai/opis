-- Canonical participant email for transcript diarization (display uses CRM names).
ALTER TABLE crm.meeting_transcript_chunks
  ADD COLUMN IF NOT EXISTS speaker_email VARCHAR(320);

CREATE INDEX IF NOT EXISTS meeting_transcript_chunks_speaker_email_idx
  ON crm.meeting_transcript_chunks (session_id, speaker_email)
  WHERE speaker_email IS NOT NULL;
