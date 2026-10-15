-- Internal team chat (agent/admin messaging, isolated from customer conversations).

CREATE TABLE IF NOT EXISTS ccass.internal_chat_rooms (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  room_type VARCHAR(8) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(32),
  avatar_storage_key VARCHAR(512),
  created_by_user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internal_chat_rooms_type_check CHECK (room_type IN ('group', 'dm'))
);

CREATE INDEX IF NOT EXISTS idx_internal_chat_rooms_org_updated
  ON ccass.internal_chat_rooms (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_chat_rooms_org_type
  ON ccass.internal_chat_rooms (organization_id, room_type);

CREATE TABLE IF NOT EXISTS ccass.internal_chat_room_members (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  room_id BIGINT NOT NULL REFERENCES ccass.internal_chat_rooms (id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'member',
  favourite BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  CONSTRAINT internal_chat_room_members_role_check CHECK (role IN ('admin', 'member')),
  CONSTRAINT internal_chat_room_members_unique UNIQUE (organization_id, room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_internal_chat_room_members_user
  ON ccass.internal_chat_room_members (organization_id, user_id, left_at);

CREATE INDEX IF NOT EXISTS idx_internal_chat_room_members_room
  ON ccass.internal_chat_room_members (organization_id, room_id, left_at);

CREATE TABLE IF NOT EXISTS ccass.internal_chat_dm_pairs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_low_id BIGINT NOT NULL,
  user_high_id BIGINT NOT NULL,
  room_id BIGINT NOT NULL REFERENCES ccass.internal_chat_rooms (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internal_chat_dm_pairs_unique UNIQUE (organization_id, user_low_id, user_high_id)
);

CREATE TABLE IF NOT EXISTS ccass.internal_chat_messages (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  room_id BIGINT NOT NULL REFERENCES ccass.internal_chat_rooms (id) ON DELETE CASCADE,
  sender_user_id BIGINT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  message_type VARCHAR(16) NOT NULL DEFAULT 'text',
  voice_duration_ms INT,
  voice_storage_key VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT internal_chat_messages_type_check CHECK (message_type IN ('text', 'voice', 'attachment_bundle'))
);

CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_room_created
  ON ccass.internal_chat_messages (organization_id, room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ccass.internal_chat_message_attachments (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL REFERENCES ccass.internal_chat_messages (id) ON DELETE CASCADE,
  storage_key VARCHAR(512) NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  content_type VARCHAR(255) NOT NULL,
  byte_size BIGINT NOT NULL DEFAULT 0,
  checksum_sha256 VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_chat_message_attachments_message
  ON ccass.internal_chat_message_attachments (organization_id, message_id);
