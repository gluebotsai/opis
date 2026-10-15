ALTER TABLE accounts.auth_sessions
  ADD COLUMN IF NOT EXISTS presence_initialized_at TIMESTAMPTZ;
