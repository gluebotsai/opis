-- Revenue Gap Forecast Agent — optional admin-set targets + cached forecast
-- (crm-owned, read-only agent output).
ALTER TABLE crm.org_finance_settings
  ADD COLUMN IF NOT EXISTS revenue_target_monthly DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS revenue_target_quarterly DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS revenue_forecast_last_run JSONB,
  ADD COLUMN IF NOT EXISTS revenue_forecast_last_run_at TIMESTAMPTZ(6);
