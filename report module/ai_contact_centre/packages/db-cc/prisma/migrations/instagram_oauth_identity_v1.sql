-- Preserve Meta's distinct Instagram identifier namespaces and OAuth metadata.
-- My Account owns OAuth fields; CCaaS binds ig_webhook_account_id after the
-- first verified webhook when Meta does not expose it during OAuth.

ALTER TABLE accounts.setup_social_configs
  ADD COLUMN IF NOT EXISTS ig_login_user_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ig_login_scoped_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ig_webhook_account_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS meta_auth_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS meta_app_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS granted_scopes JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'setup_social_configs_meta_auth_type_check'
      AND conrelid = 'accounts.setup_social_configs'::regclass
  ) THEN
    ALTER TABLE accounts.setup_social_configs
      ADD CONSTRAINT setup_social_configs_meta_auth_type_check
      CHECK (
        meta_auth_type IS NULL
        OR meta_auth_type IN ('facebook_page', 'instagram_login')
      );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_setup_social_configs_ig_webhook_account_id
  ON accounts.setup_social_configs (ig_webhook_account_id)
  WHERE provider = 'instagram' AND ig_webhook_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_setup_social_configs_meta_app_auth
  ON accounts.setup_social_configs (provider, meta_app_id, meta_auth_type);
