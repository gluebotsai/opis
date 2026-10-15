-- Automated Forecast & Pipeline Auditor: overlay fields on deals.
-- Never mutates stage/expected_close_date — human-owned; this is judgment-only state.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS forecast_category VARCHAR(32),
  ADD COLUMN IF NOT EXISTS forecast_confidence_percent INTEGER,
  ADD COLUMN IF NOT EXISTS forecast_flagged BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS forecast_reason TEXT,
  ADD COLUMN IF NOT EXISTS forecast_last_run_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS deals_forecast_flagged_idx
  ON deals (organization_id, forecast_flagged)
  WHERE forecast_flagged = true;
