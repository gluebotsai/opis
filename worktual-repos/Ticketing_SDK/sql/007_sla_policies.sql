-- SLA policies + ticket resolved timestamp — ticketing schema only.

SET search_path TO ticketing;

-- Global defaults (source of truth for new orgs)
CREATE TABLE IF NOT EXISTS ticketing.sla_policy_defaults (
  priority               TEXT PRIMARY KEY
                           CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  resolution_hours       INTEGER NOT NULL CHECK (resolution_hours > 0),
  first_response_hours   INTEGER NOT NULL CHECK (first_response_hours > 0),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ticketing.sla_policy_defaults (priority, resolution_hours, first_response_hours)
VALUES
  ('urgent',  4,  1),
  ('high',    8,  2),
  ('medium', 24,  4),
  ('low',    72,  8)
ON CONFLICT (priority) DO NOTHING;

-- Per-organisation policies (copied from defaults; editable per tenant)
CREATE TABLE IF NOT EXISTS ticketing.sla_policies (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES ticketing.organizations(id) ON DELETE CASCADE,
  priority               TEXT NOT NULL
                           CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  resolution_hours       INTEGER NOT NULL CHECK (resolution_hours > 0),
  first_response_hours   INTEGER NOT NULL CHECK (first_response_hours > 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, priority)
);

CREATE INDEX IF NOT EXISTS idx_sla_policies_organization_id
  ON ticketing.sla_policies(organization_id);

ALTER TABLE ticketing.tickets
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_resolved_at
  ON ticketing.tickets(organization_id, resolved_at)
  WHERE resolved_at IS NOT NULL;

-- Copy defaults into every organisation (idempotent)
INSERT INTO ticketing.sla_policies (organization_id, priority, resolution_hours, first_response_hours)
SELECT o.id, d.priority, d.resolution_hours, d.first_response_hours
FROM ticketing.organizations o
CROSS JOIN ticketing.sla_policy_defaults d
ON CONFLICT (organization_id, priority) DO NOTHING;

-- Backfill solved time for already-resolved tickets
UPDATE ticketing.tickets
SET resolved_at = COALESCE(resolved_at, updated_at)
WHERE status = 'Resolved' AND resolved_at IS NULL;
