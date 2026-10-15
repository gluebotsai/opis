-- Org ticket status catalog (defaults + custom labels).
-- Mirrors the priorities pattern on sla_policies.

SET search_path TO ticketing;

CREATE TABLE IF NOT EXISTS ticketing.ticket_statuses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES ticketing.organizations(id) ON DELETE CASCADE,
  status           TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  is_system        BOOLEAN NOT NULL DEFAULT false,
  is_terminal      BOOLEAN NOT NULL DEFAULT false,
  sort_order       INTEGER NOT NULL DEFAULT 100,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, status)
);

CREATE INDEX IF NOT EXISTS idx_ticket_statuses_organization_id
  ON ticketing.ticket_statuses(organization_id);

-- Drop legacy CHECK that only allows Open|Pending|On Hold|Resolved|Overdue
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
      AND t.relname = 'tickets'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
      AND (
        pg_get_constraintdef(c.oid) ILIKE '%Open%'
        OR pg_get_constraintdef(c.oid) ILIKE '%Pending%'
      )
  LOOP
    EXECUTE format('ALTER TABLE ticketing.tickets DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

-- Seed system statuses for every org
INSERT INTO ticketing.ticket_statuses
  (organization_id, status, display_name, is_system, is_terminal, sort_order, active)
SELECT o.id, v.status, v.display_name, true, v.is_terminal, v.sort_order, true
FROM ticketing.organizations o
CROSS JOIN (VALUES
  ('Open',      'Open',         false, 1),
  ('Pending',   'In Progress',  false, 2),
  ('Resolved',  'Resolved',     true,  3),
  ('Overdue',   'Overdue',      false, 4)
) AS v(status, display_name, is_terminal, sort_order)
ON CONFLICT (organization_id, status) DO NOTHING;
