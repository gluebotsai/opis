-- Lead pipeline Phase 2: lifecycle flags, meeting analysis, document approval gates.

ALTER TABLE contact_profiles
  ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS lifecycle_last_action VARCHAR(64),
  ADD COLUMN IF NOT EXISTS lifecycle_last_reason TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_last_run_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS contact_profiles_flagged_idx
  ON contact_profiles (organization_id, flagged_for_review)
  WHERE flagged_for_review = true;

CREATE TABLE IF NOT EXISTS meeting_analyses (
  id TEXT PRIMARY KEY,
  organization_id UUID NOT NULL,
  activity_id TEXT NOT NULL,
  contact_id UUID,
  deal_id TEXT,
  outcome VARCHAR(32),
  bant_budget BOOLEAN,
  bant_authority BOOLEAN,
  bant_need BOOLEAN,
  bant_timeline_text VARCHAR(256),
  next_step_agreed TEXT,
  objections_raised JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id)
);

CREATE INDEX IF NOT EXISTS meeting_analyses_contact_idx
  ON meeting_analyses (contact_id, analyzed_at DESC);

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS approved_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'drafting';

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS approved_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'drafting';

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approved_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'drafting';
