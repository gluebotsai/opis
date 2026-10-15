-- Add contact_type to CDP customer profiles.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'cdp' AND table_name = 'customer_profile'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'cdp'
      AND table_name = 'customer_profile'
      AND column_name = 'contact_type'
  ) THEN
    ALTER TABLE cdp.customer_profile
      ADD COLUMN contact_type VARCHAR(200);
  END IF;
END $$;
