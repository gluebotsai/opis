-- Scheduled admin PDF reports (CCaaS performance dashboards).

CREATE TABLE IF NOT EXISTS ccass.scheduled_reports (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  created_by_user_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  schedule VARCHAR(32) NOT NULL,
  weekday VARCHAR(16) NOT NULL DEFAULT 'monday',
  month_day INT NOT NULL DEFAULT 1,
  send_mode VARCHAR(32) NOT NULL DEFAULT 'custom_time',
  send_at VARCHAR(8) NOT NULL DEFAULT '09:00',
  time_zone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  period VARCHAR(16) NOT NULL DEFAULT 'yesterday',
  formats JSONB NOT NULL DEFAULT '{"pdf": true, "csv": false}'::jsonb,
  included_sections JSONB NOT NULL DEFAULT '{"dashboardKpis": true, "agentTable": true, "aiSummary": true}'::jsonb,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_org_creator
  ON ccass.scheduled_reports (organization_id, created_by_user_id, enabled);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next_run
  ON ccass.scheduled_reports (enabled, next_run_at)
  WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS ccass.scheduled_report_runs (
  id BIGSERIAL PRIMARY KEY,
  scheduled_report_id BIGINT NOT NULL REFERENCES ccass.scheduled_reports (id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_label VARCHAR(255) NOT NULL,
  pdf_bytes BYTEA,
  summary_text TEXT,
  sent_to_email VARCHAR(255),
  sent_from_email VARCHAR(255),
  error_code VARCHAR(64),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_report_runs_schedule
  ON ccass.scheduled_report_runs (scheduled_report_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_report_runs_idempotent
  ON ccass.scheduled_report_runs (scheduled_report_id, period_start, period_end)
  WHERE status = 'succeeded';
