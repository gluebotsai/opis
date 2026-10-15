CREATE TABLE IF NOT EXISTS crm.call_transcript_sessions (
  id text PRIMARY KEY,
  organization_id bigint NOT NULL,
  user_id bigint NOT NULL,
  ext varchar(32) NOT NULL,
  contact_id text NOT NULL,
  contact_name text,
  remote_digits varchar(32) NOT NULL,
  direction varchar(16) NOT NULL,
  gateway_session_id text,
  status varchar(16) NOT NULL,
  activity_id text,
  end_reason varchar(32),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_transcript_sessions_match_idx
  ON crm.call_transcript_sessions (organization_id, status, ext, remote_digits);

CREATE INDEX IF NOT EXISTS call_transcript_sessions_user_status_idx
  ON crm.call_transcript_sessions (user_id, status);

CREATE TABLE IF NOT EXISTS crm.call_transcript_chunks (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES crm.call_transcript_sessions(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  speaker text,
  is_bot boolean NOT NULL DEFAULT false,
  text text NOT NULL,
  emotion text,
  transcript_tm text,
  raw jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS call_transcript_chunks_session_seq_uidx
  ON crm.call_transcript_chunks (session_id, seq);

CREATE INDEX IF NOT EXISTS call_transcript_chunks_session_tm_idx
  ON crm.call_transcript_chunks (session_id, transcript_tm);
