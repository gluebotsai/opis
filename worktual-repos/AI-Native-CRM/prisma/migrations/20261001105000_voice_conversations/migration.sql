CREATE TABLE IF NOT EXISTS crm.voice_conversations (
  id text PRIMARY KEY,
  organization_id bigint NOT NULL,
  user_id bigint NOT NULL,
  ext varchar(32) NOT NULL,
  direction varchar(16) NOT NULL,
  status varchar(16) NOT NULL,
  remote_number varchar(32) NOT NULL,
  remote_name text,
  caller_id varchar(32),
  contact_id text,
  sip_call_id text NOT NULL,
  started_at timestamptz NOT NULL,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  end_reason varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_conversations_org_sip_call_uidx
  ON crm.voice_conversations (organization_id, sip_call_id);

CREATE INDEX IF NOT EXISTS voice_conversations_org_user_started_idx
  ON crm.voice_conversations (organization_id, user_id, started_at);

CREATE INDEX IF NOT EXISTS voice_conversations_org_contact_started_idx
  ON crm.voice_conversations (organization_id, contact_id, started_at);
