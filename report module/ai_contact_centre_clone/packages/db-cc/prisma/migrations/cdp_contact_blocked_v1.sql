-- Contact profile block flag. When true, inbound and outbound calls
-- will be blocked later; this migration only persists the boolean.

ALTER TABLE cdp.customer_profile
  ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN cdp.customer_profile.blocked IS
  'When true, inbound and outbound voice for this contact should be blocked.';
