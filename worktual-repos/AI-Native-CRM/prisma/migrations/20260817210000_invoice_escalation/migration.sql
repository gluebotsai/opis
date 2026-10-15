-- Invoice Escalation Agent.
-- Collections-risk overlay on invoices. The agent only ever writes these
-- four columns (+ notifications) — it never marks an invoice paid/void and
-- never changes due_at/total. escalation_draft is a human-review-only
-- reminder draft; nothing here triggers a customer-facing send.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS escalation_severity VARCHAR(16),
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS escalation_draft TEXT,
  ADD COLUMN IF NOT EXISTS escalation_last_run_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS invoices_org_escalation_severity_idx
  ON invoices (organization_id, escalation_severity);
