-- Dashboard analytics persistence: incidents, forecast runs, workforce plans.

CREATE TABLE IF NOT EXISTS ccass.dashboard_analytics_incidents (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  incident_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  severity VARCHAR(16) NOT NULL DEFAULT 'medium',
  version INT NOT NULL DEFAULT 1,
  scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_facts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  baseline_facts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  headline TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  source VARCHAR(32) NOT NULL DEFAULT 'rules',
  schema_version INT NOT NULL DEFAULT 1,
  prompt_version VARCHAR(64),
  model_name VARCHAR(128),
  input_hash VARCHAR(128),
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dashboard_analytics_incidents_status_check CHECK (
    status IN ('candidate', 'active', 'cooling', 'resolved')
  ),
  CONSTRAINT dashboard_analytics_incidents_severity_check CHECK (
    severity IN ('low', 'medium', 'high', 'critical')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_analytics_incidents_org_fingerprint
  ON ccass.dashboard_analytics_incidents (organization_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_dashboard_analytics_incidents_org_status
  ON ccass.dashboard_analytics_incidents (organization_id, status, severity, last_detected_at DESC);

CREATE TABLE IF NOT EXISTS ccass.dashboard_analytics_forecast_runs (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  forecast_date DATE NOT NULL,
  history_days INT NOT NULL DEFAULT 56,
  horizon_hours INT NOT NULL DEFAULT 168,
  method VARCHAR(64) NOT NULL DEFAULT 'seasonal_baseline_plus_llm_adjustment',
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  input_hash VARCHAR(128) NOT NULL,
  baseline_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  llm_adjustment_json JSONB,
  forecast_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version INT NOT NULL DEFAULT 1,
  prompt_version VARCHAR(64),
  model_name VARCHAR(128),
  validation_status VARCHAR(32) NOT NULL DEFAULT 'valid',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_analytics_forecast_runs_org_date_hash
  ON ccass.dashboard_analytics_forecast_runs (organization_id, forecast_date, input_hash);

CREATE INDEX IF NOT EXISTS idx_dashboard_analytics_forecast_runs_org_date
  ON ccass.dashboard_analytics_forecast_runs (organization_id, forecast_date DESC, generated_at DESC);

CREATE TABLE IF NOT EXISTS ccass.dashboard_analytics_workforce_plans (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  forecast_run_id BIGINT REFERENCES ccass.dashboard_analytics_forecast_runs (id) ON DELETE SET NULL,
  plan_date DATE NOT NULL,
  input_signature VARCHAR(128) NOT NULL,
  plan_fingerprint VARCHAR(128) NOT NULL,
  decision VARCHAR(32) NOT NULL DEFAULT 'update',
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  previous_plan_id BIGINT REFERENCES ccass.dashboard_analytics_workforce_plans (id) ON DELETE SET NULL,
  plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source VARCHAR(32) NOT NULL DEFAULT 'rules',
  schema_version INT NOT NULL DEFAULT 1,
  prompt_version VARCHAR(64),
  model_name VARCHAR(128),
  reviewed_by_user_id BIGINT,
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dashboard_analytics_workforce_plans_decision_check CHECK (
    decision IN ('update', 'no_change')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_analytics_workforce_plans_org_date_sig
  ON ccass.dashboard_analytics_workforce_plans (organization_id, plan_date, input_signature);

CREATE INDEX IF NOT EXISTS idx_dashboard_analytics_workforce_plans_org_date
  ON ccass.dashboard_analytics_workforce_plans (organization_id, plan_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_org_created_at
  ON ccass.conversations (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_missed_contacts_org_missed_at
  ON ccass.agent_missed_contacts (organization_id, missed_at DESC);
