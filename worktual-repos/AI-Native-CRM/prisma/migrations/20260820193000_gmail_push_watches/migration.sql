-- Gmail users.watch state for Pub/Sub push notifications (crm-owned).
CREATE TABLE IF NOT EXISTS crm.gmail_push_watches (
  id TEXT PRIMARY KEY,
  organization_id BIGINT,
  user_id BIGINT,
  account_email TEXT NOT NULL,
  watch_kind TEXT NOT NULL DEFAULT 'user',
  history_id TEXT,
  expiration TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS gmail_push_watches_account_email_key
  ON crm.gmail_push_watches (lower(account_email));

CREATE INDEX IF NOT EXISTS gmail_push_watches_expiration_idx
  ON crm.gmail_push_watches (expiration);
