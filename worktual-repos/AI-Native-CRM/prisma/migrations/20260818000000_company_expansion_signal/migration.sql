-- Expansion & Revenue Matcher Agent.
-- Upsell/cross-sell signal overlay on companies, based only on their own
-- closed-won deal history. The agent only ever writes these four columns
-- (+ notifications) — it never creates a deal/quote and never contacts the
-- company itself. expansion_draft is a human-review-only outreach draft for
-- the account owner to copy/send (or discard) when they act on it.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS expansion_signal VARCHAR(16),
  ADD COLUMN IF NOT EXISTS expansion_reason TEXT,
  ADD COLUMN IF NOT EXISTS expansion_draft TEXT,
  ADD COLUMN IF NOT EXISTS expansion_last_run_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS companies_org_expansion_signal_idx
  ON companies (organization_id, expansion_signal);
