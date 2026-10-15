CREATE TABLE IF NOT EXISTS crm.lead_summary_refresh_queue (
  organization_id bigint NOT NULL,
  contact_id text NOT NULL,
  run_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, contact_id)
);

CREATE INDEX IF NOT EXISTS lead_summary_refresh_queue_run_after_idx
  ON crm.lead_summary_refresh_queue (run_after);
