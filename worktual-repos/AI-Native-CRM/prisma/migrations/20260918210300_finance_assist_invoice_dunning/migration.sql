-- Invoice Dunning Agent — staged reminder->warning->pause_notice cadence
-- (crm-owned, HITL draft-only fields; agent never sends).
ALTER TABLE crm.invoices
  ADD COLUMN IF NOT EXISTS dunning_stage VARCHAR(16) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS dunning_stage_sent_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS dunning_draft TEXT;

CREATE INDEX IF NOT EXISTS invoices_organization_id_dunning_stage_idx
  ON crm.invoices (organization_id, dunning_stage);
