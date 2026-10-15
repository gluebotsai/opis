-- Phase 1–3 enhancements: auth passwords, SLA due dates
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_due_at
  ON tickets(organisation_id, due_at)
  WHERE status <> 'Resolved';

-- Default password for seeded Jane Smith: Worktual@123
-- Hash generated at runtime by seed script; placeholder updated by server bootstrap.
