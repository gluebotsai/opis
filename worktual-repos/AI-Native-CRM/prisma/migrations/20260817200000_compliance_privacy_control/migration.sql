-- Compliance & Privacy Control Agent.
-- Marketing opt-out is a durable, reversible suppression flag applied
-- autonomously by the agent and enforced in lead-nurture-job.ts. Data
-- deletion / data access requests are queued for admin-only human review —
-- the agent never deletes data itself (see executePrivacyRequestCommand).

ALTER TABLE contact_profiles
  ADD COLUMN IF NOT EXISTS marketing_opt_out BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS privacy_requests (
  id                   TEXT PRIMARY KEY,
  organization_id      BIGINT NOT NULL,
  activity_id          TEXT NOT NULL UNIQUE,
  contact_id           TEXT NOT NULL,
  request_type         VARCHAR(24) NOT NULL,
  confidence           VARCHAR(16) NOT NULL,
  status               VARCHAR(24) NOT NULL DEFAULT 'pending_review',
  reason               TEXT,
  draft_confirmation   TEXT,
  reviewed_by_user_id  BIGINT,
  reviewed_at          TIMESTAMPTZ,
  executed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS privacy_requests_org_status_created_idx
  ON privacy_requests (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS privacy_requests_contact_idx
  ON privacy_requests (contact_id);
