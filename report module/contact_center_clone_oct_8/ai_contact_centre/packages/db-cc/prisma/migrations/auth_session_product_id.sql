-- Optional product on a shared login row. No default, so other products are not labeled contact-center.
ALTER TABLE accounts.auth_sessions
  ADD COLUMN IF NOT EXISTS product_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_email_product
  ON accounts.auth_sessions (email, product_id);
