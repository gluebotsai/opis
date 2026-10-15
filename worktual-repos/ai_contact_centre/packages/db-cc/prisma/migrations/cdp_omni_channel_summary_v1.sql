-- Omni-channel summary is stored on cdp.customer_profile.custom_fields
-- (omniChannelSummary, omniChannelSummaryUpdatedAt). Legacy cdp.contacts is not used.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'cdp' AND table_name = 'customer_profile'
  ) THEN
    ALTER TABLE cdp.customer_profile
      ALTER COLUMN custom_fields SET DEFAULT '{}'::jsonb;
  END IF;
END $$;
