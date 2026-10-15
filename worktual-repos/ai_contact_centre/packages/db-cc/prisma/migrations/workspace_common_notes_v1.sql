CREATE TABLE IF NOT EXISTS ccass.workspace_common_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  author_user_id UUID NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_common_notes_org_created_idx
  ON ccass.workspace_common_notes (organization_id, created_at DESC);
