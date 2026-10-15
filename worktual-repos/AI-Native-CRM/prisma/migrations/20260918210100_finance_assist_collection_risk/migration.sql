-- Company Collection Risk Agent overlay (crm-owned, HITL flag-only fields).
ALTER TABLE crm.companies
  ADD COLUMN IF NOT EXISTS collection_risk_level VARCHAR(16),
  ADD COLUMN IF NOT EXISTS collection_risk_reason TEXT,
  ADD COLUMN IF NOT EXISTS collection_risk_last_run_at TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS companies_organization_id_collection_risk_level_idx
  ON crm.companies (organization_id, collection_risk_level);
