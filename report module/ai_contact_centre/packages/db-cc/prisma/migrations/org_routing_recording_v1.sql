-- Organization-level routing profile and recording settings.
-- Additive only. Does not change queue classifier routing
-- (accounts.setup_queue_routing_profiles / ccass.queue_routing_profiles)
-- or per-queue offer/overflow policies (ccass.routing_policies).

CREATE TABLE IF NOT EXISTS accounts.routing_profile_types (
  id INTEGER PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO accounts.routing_profile_types (id, code, name, description, sort_order)
VALUES
  (
    1,
    'long_wait',
    'Long wait time based routing',
    'Route conversations that have waited the longest toward available agents.',
    1
  ),
  (
    2,
    'sticky',
    'Sticky routing',
    'Prefer the agent who last handled this customer when they are available.',
    2
  ),
  (
    3,
    'skill',
    'Skill based routing',
    'Match conversations to agents by required skills.',
    3
  )
ON CONFLICT (id) DO UPDATE
SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS accounts.setup_organization_routing_profiles (
  organization_id BIGINT PRIMARY KEY REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  routing_type_id INTEGER NOT NULL REFERENCES accounts.routing_profile_types(id),
  long_wait_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT setup_organization_routing_profiles_long_wait_check
    CHECK (long_wait_seconds IS NULL OR long_wait_seconds > 0)
);

CREATE TABLE IF NOT EXISTS accounts.setup_organization_recording_settings (
  organization_id BIGINT PRIMARY KEY REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  recording_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE accounts.routing_profile_types IS
  'Global lookup of organization routing profile types (1 long wait, 2 sticky, 3 skill).';
COMMENT ON TABLE accounts.setup_organization_routing_profiles IS
  'One routing profile per organization. Independent of queue classifier routing profiles.';
COMMENT ON TABLE accounts.setup_organization_recording_settings IS
  'Organization-level conversation recording enable/disable.';
