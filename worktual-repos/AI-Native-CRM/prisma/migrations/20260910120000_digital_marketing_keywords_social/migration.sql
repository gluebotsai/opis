-- Digital Marketing: Semrush keyword cache, saved keywords, social posts (crm.* only)

CREATE TABLE IF NOT EXISTS crm.seo_keyword_queries (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT,
  seed TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'us',
  language TEXT NOT NULL DEFAULT 'en',
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  cache_key TEXT NOT NULL,
  semrush_called_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  budget_skipped BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS seo_keyword_queries_org_cache_uidx
  ON crm.seo_keyword_queries (organization_id, cache_key);

CREATE INDEX IF NOT EXISTS seo_keyword_queries_org_updated_idx
  ON crm.seo_keyword_queries (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm.seo_saved_keywords (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  query_id TEXT NOT NULL,
  term TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS seo_saved_keywords_org_query_term_uidx
  ON crm.seo_saved_keywords (organization_id, query_id, term);

CREATE INDEX IF NOT EXISTS seo_saved_keywords_org_idx
  ON crm.seo_saved_keywords (organization_id, updated_at DESC);

ALTER TABLE crm.seo_generated_content
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS primary_keyword TEXT,
  ADD COLUMN IF NOT EXISTS keyword_query_id TEXT;

CREATE INDEX IF NOT EXISTS seo_generated_content_org_query_idx
  ON crm.seo_generated_content (organization_id, keyword_query_id);

CREATE TABLE IF NOT EXISTS crm.seo_social_posts (
  id TEXT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id BIGINT,
  content_id TEXT,
  platform TEXT NOT NULL,
  post_type TEXT NOT NULL DEFAULT 'feed',
  copy JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  external_post_id TEXT,
  last_error TEXT,
  accounts_connection_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS seo_social_posts_org_updated_idx
  ON crm.seo_social_posts (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS seo_social_posts_org_content_idx
  ON crm.seo_social_posts (organization_id, content_id);

CREATE INDEX IF NOT EXISTS seo_social_posts_due_idx
  ON crm.seo_social_posts (status, scheduled_at)
  WHERE scheduled_at IS NOT NULL;
