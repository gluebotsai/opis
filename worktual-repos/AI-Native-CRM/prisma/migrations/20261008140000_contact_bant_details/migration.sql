-- Customer phrases for Qualification (BANT). Flags stay boolean.
-- CRM overlay only — no cdp/accounts/inventory DDL.

ALTER TABLE crm.contact_profiles
  ADD COLUMN IF NOT EXISTS bant_budget_detail VARCHAR(160),
  ADD COLUMN IF NOT EXISTS bant_authority_detail VARCHAR(160),
  ADD COLUMN IF NOT EXISTS bant_need_detail VARCHAR(160),
  ADD COLUMN IF NOT EXISTS bant_timeline_detail VARCHAR(160);
