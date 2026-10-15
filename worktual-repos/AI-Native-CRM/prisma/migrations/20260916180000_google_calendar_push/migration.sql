-- Google Calendar HTTPS push watches + host-owned Meet captures (crm-owned).
CREATE TABLE IF NOT EXISTS crm.google_calendar_watches (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  channel_id TEXT NOT NULL,
  resource_id TEXT,
  channel_token TEXT NOT NULL,
  sync_token TEXT,
  expiration TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_watches_user_id_key
  ON crm.google_calendar_watches (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_watches_channel_id_key
  ON crm.google_calendar_watches (channel_id);
CREATE INDEX IF NOT EXISTS google_calendar_watches_expiration_idx
  ON crm.google_calendar_watches (expiration);

CREATE TABLE IF NOT EXISTS crm.calendar_meet_captures (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  google_event_id TEXT NOT NULL,
  meet_url TEXT,
  meet_code TEXT,
  summary TEXT,
  start_at TIMESTAMPTZ(6),
  end_at TIMESTAMPTZ(6),
  status TEXT NOT NULL DEFAULT 'pending',
  contact_id TEXT,
  activity_id TEXT,
  meeting_service_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_meet_captures_user_event_key
  ON crm.calendar_meet_captures (user_id, google_event_id);
CREATE INDEX IF NOT EXISTS calendar_meet_captures_org_meet_code_idx
  ON crm.calendar_meet_captures (organization_id, meet_code);
CREATE INDEX IF NOT EXISTS calendar_meet_captures_meeting_service_id_idx
  ON crm.calendar_meet_captures (meeting_service_id);
