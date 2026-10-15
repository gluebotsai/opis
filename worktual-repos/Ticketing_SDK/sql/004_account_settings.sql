-- Account settings: profile extras, prefs, sessions, login history

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  ADD COLUMN IF NOT EXISTS notify_ticket_assignments BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_ticket_updates BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_security_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_sla_alerts BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_product_updates BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS user_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label     TEXT NOT NULL,
  browser          TEXT,
  os               TEXT,
  location         TEXT NOT NULL DEFAULT 'Local',
  user_agent       TEXT,
  ip_address       TEXT,
  is_current       BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS user_login_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label     TEXT NOT NULL,
  location         TEXT NOT NULL DEFAULT 'Local',
  ip_address       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_login_events_user
  ON user_login_events(user_id, created_at DESC);

-- Seed profile phone for Jane if missing
UPDATE users
SET phone = COALESCE(phone, '+91 98765 43210'),
    password_changed_at = COALESCE(password_changed_at, NOW() - INTERVAL '14 days')
WHERE email = 'jane.smith@worktual.com';
