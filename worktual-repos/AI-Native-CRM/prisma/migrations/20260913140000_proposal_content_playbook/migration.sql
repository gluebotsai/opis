-- Org-level versioned content playbooks + per-pair case studies.
-- Visual playbooks pin a snapshot FK at freeze time (nullable for pre-existing rows).

ALTER TABLE crm.proposal_corpus_items
  ADD COLUMN IF NOT EXISTS pair_slot INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS proposal_corpus_items_batch_id_pair_slot_idx
  ON crm.proposal_corpus_items (batch_id, pair_slot);

ALTER TABLE crm.proposal_corpus_pairs
  ADD COLUMN IF NOT EXISTS pairing_source TEXT NOT NULL DEFAULT 'user_explicit';

ALTER TABLE crm.proposal_corpus_pairs
  ADD COLUMN IF NOT EXISTS is_visual_master BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS crm.proposal_corpus_case_studies (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  batch_id TEXT NOT NULL,
  pair_id TEXT NOT NULL,
  pairing_confidence DOUBLE PRECISION NOT NULL,
  section_analysis JSONB NOT NULL,
  length_analysis JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT proposal_corpus_case_studies_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES crm.proposal_corpus_batches(id) ON DELETE CASCADE,
  CONSTRAINT proposal_corpus_case_studies_pair_id_fkey
    FOREIGN KEY (pair_id) REFERENCES crm.proposal_corpus_pairs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_corpus_case_studies_pair_id_key
  ON crm.proposal_corpus_case_studies (pair_id);

CREATE INDEX IF NOT EXISTS proposal_corpus_case_studies_org_created_idx
  ON crm.proposal_corpus_case_studies (organization_id, created_at);

CREATE INDEX IF NOT EXISTS proposal_corpus_case_studies_batch_id_idx
  ON crm.proposal_corpus_case_studies (batch_id);

CREATE TABLE IF NOT EXISTS crm.proposal_content_playbooks (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  version INTEGER NOT NULL,
  section_specs_json JSONB NOT NULL,
  length_model_json JSONB NOT NULL,
  exemplar_bank_json JSONB NOT NULL,
  case_study_count INTEGER NOT NULL,
  confidence_level TEXT NOT NULL,
  variance_log_json JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_content_playbooks_org_version_key
  ON crm.proposal_content_playbooks (organization_id, version);

CREATE INDEX IF NOT EXISTS proposal_content_playbooks_org_version_idx
  ON crm.proposal_content_playbooks (organization_id, version);

ALTER TABLE crm.proposal_playbooks
  ADD COLUMN IF NOT EXISTS content_playbook_id TEXT;

CREATE INDEX IF NOT EXISTS proposal_playbooks_content_playbook_id_idx
  ON crm.proposal_playbooks (content_playbook_id);

ALTER TABLE crm.proposal_playbooks
  DROP CONSTRAINT IF EXISTS proposal_playbooks_content_playbook_id_fkey;

ALTER TABLE crm.proposal_playbooks
  ADD CONSTRAINT proposal_playbooks_content_playbook_id_fkey
  FOREIGN KEY (content_playbook_id)
  REFERENCES crm.proposal_content_playbooks(id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
