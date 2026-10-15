-- Internal-domains resolver (crm-owned) — foundation for future Internal
-- Meeting Assist routing. Auto-derived (or admin-entered) set of "internal"
-- email domains per organization, cached on organization_profiles.
ALTER TABLE crm.organization_profiles
  ADD COLUMN IF NOT EXISTS internal_domains TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS internal_domains_mode VARCHAR(16) NOT NULL DEFAULT 'derived',
  ADD COLUMN IF NOT EXISTS internal_domain_overrides TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS internal_domains_updated_at TIMESTAMPTZ(6);
