-- Extend sla_policies for admin-custom priority labels + SLA hours.
-- System defaults remain; custom rows share the same table.

SET search_path TO ticketing;

-- Drop legacy CHECK(s) that only allow low|medium|high|urgent
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'ticketing'
      AND t.relname = 'sla_policies'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%priority%'
      AND pg_get_constraintdef(c.oid) ILIKE '%low%'
  LOOP
    EXECUTE format('ALTER TABLE ticketing.sla_policies DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE ticketing.sla_policies ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE ticketing.sla_policies ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ticketing.sla_policies ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE ticketing.sla_policies ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

UPDATE ticketing.sla_policies
SET display_name = CASE priority
      WHEN 'urgent' THEN 'Urgent'
      WHEN 'high' THEN 'High'
      WHEN 'medium' THEN 'Medium'
      WHEN 'low' THEN 'Low'
      ELSE COALESCE(NULLIF(display_name, ''), initcap(priority))
    END,
    is_system = CASE WHEN priority IN ('urgent','high','medium','low') THEN true ELSE is_system END,
    sort_order = CASE priority
      WHEN 'urgent' THEN 1
      WHEN 'high' THEN 2
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 4
      ELSE sort_order
    END,
    updated_at = NOW()
WHERE true;
