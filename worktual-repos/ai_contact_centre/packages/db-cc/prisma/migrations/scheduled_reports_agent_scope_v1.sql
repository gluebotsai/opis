-- Agent-scoped personal performance schedules (additive; org schedules unchanged).

ALTER TABLE ccass.scheduled_reports
  ADD COLUMN IF NOT EXISTS report_scope VARCHAR(32) NOT NULL DEFAULT 'organization',
  ADD COLUMN IF NOT EXISTS target_user_id BIGINT;

UPDATE ccass.scheduled_reports
SET report_scope = 'organization'
WHERE report_scope IS NULL OR btrim(report_scope) = '';

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_agent_scope
  ON ccass.scheduled_reports (organization_id, target_user_id, report_scope, enabled)
  WHERE report_scope = 'agent';
