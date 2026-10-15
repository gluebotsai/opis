-- One-time browser codes for Accounts → Contact Center dashboard deep-link
-- after Setup People set-password. Codes are hashed; plaintext is never stored.

CREATE TABLE IF NOT EXISTS ccass.onboarding_dashboard_codes (
  id BIGSERIAL PRIMARY KEY,
  code_hash VARCHAR(64) NOT NULL UNIQUE,
  setup_user_id BIGINT NOT NULL REFERENCES accounts.setup_users (id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL REFERENCES accounts.organizations (id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_dashboard_codes_expires_at
  ON ccass.onboarding_dashboard_codes (expires_at);

CREATE INDEX IF NOT EXISTS idx_onboarding_dashboard_codes_user_open
  ON ccass.onboarding_dashboard_codes (setup_user_id)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE ccass.onboarding_dashboard_codes IS
  'Single-use hashed codes minted for Accounts post-password dashboard redirect.';
