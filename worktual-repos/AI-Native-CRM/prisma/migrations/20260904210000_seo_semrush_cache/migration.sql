-- SEO Semrush project cache + generated content (crm.* only)

CREATE TABLE IF NOT EXISTS crm.seo_projects (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  external_project_id TEXT NOT NULL,
  domain TEXT,
  market TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS seo_projects_org_external_uidx
  ON crm.seo_projects (organization_id, external_project_id);

CREATE INDEX IF NOT EXISTS seo_projects_org_synced_idx
  ON crm.seo_projects (organization_id, synced_at DESC);

CREATE TABLE IF NOT EXISTS crm.seo_tool_snapshots (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  external_project_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  payload JSONB,
  error TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS seo_tool_snapshots_org_proj_tool_uidx
  ON crm.seo_tool_snapshots (organization_id, external_project_id, tool_name);

CREATE INDEX IF NOT EXISTS seo_tool_snapshots_org_fetched_idx
  ON crm.seo_tool_snapshots (organization_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS crm.seo_generated_content (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT,
  project_id TEXT,
  content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT,
  seo_score INTEGER,
  body JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seo_generated_content_org_updated_idx
  ON crm.seo_generated_content (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS seo_generated_content_org_type_idx
  ON crm.seo_generated_content (organization_id, content_type);
