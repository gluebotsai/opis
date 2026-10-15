-- Hub org + agents cutover (MyAccount-refer-only).
-- NEVER inserts into accounts.*.
-- Discards unmapped seed; FKs → accounts.organizations; users → agents;
-- renames ticketing.accounts → ticketing_accounts; drops unused product link tables.

BEGIN;

-- =============================================================================
-- Phase 0: Discard unmapped org/user seed (not in MyAccount)
-- =============================================================================

-- Org ids not present in accounts.organizations (seed or orphan), any table
DO $$
DECLARE
  r RECORD;
  sql text;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'ticketing' AND c.relkind = 'r'
      AND c.relname <> 'organizations'
  LOOP
    sql := format(
      'DELETE FROM ticketing.%I t
       WHERE NOT EXISTS (
         SELECT 1 FROM accounts.organizations a WHERE a.id = t.organization_id
       )',
      r.tbl
    );
    EXECUTE sql;
  END LOOP;
END $$;

DELETE FROM ticketing.organizations o
WHERE NOT EXISTS (SELECT 1 FROM accounts.organizations a WHERE a.id = o.id);

-- Users without valid setup_users mapping
DELETE FROM ticketing.user_sessions
WHERE user_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);
DELETE FROM ticketing.user_login_events
WHERE user_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);
DELETE FROM ticketing.agent_queue_members
WHERE user_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);
DELETE FROM ticketing.notifications
WHERE user_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);
DELETE FROM ticketing.ticket_presence
WHERE user_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);
UPDATE ticketing.ticket_notes SET author_id = NULL
WHERE author_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);
UPDATE ticketing.kb_articles SET author_id = NULL
WHERE author_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);
UPDATE ticketing.conversation_contexts SET user_id = NULL
WHERE user_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);
UPDATE ticketing.workflow_events SET user_id = NULL
WHERE user_id IN (
  SELECT u.id FROM ticketing.users u
  WHERE u.myaccount_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
     )
);

DELETE FROM ticketing.users u
WHERE u.myaccount_user_id IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
   );

-- =============================================================================
-- Phase A: org_settings + FK → accounts.organizations
-- =============================================================================

CREATE TABLE IF NOT EXISTS ticketing.org_settings (
  organization_id   BIGINT PRIMARY KEY
    REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  ticket_prefix     TEXT NOT NULL DEFAULT '#',
  portal_label      TEXT,
  display_timezone  TEXT NOT NULL DEFAULT 'UTC',
  portal_auth_mode  TEXT NOT NULL DEFAULT 'otp'
    CHECK (portal_auth_mode IN ('password', 'otp')),
  portal_slug       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ticketing.org_settings (
  organization_id, ticket_prefix, portal_label, display_timezone,
  portal_auth_mode, portal_slug, created_at, updated_at
)
SELECT
  o.id,
  COALESCE(o.ticket_prefix, '#'),
  o.portal_label,
  COALESCE(o.display_timezone, 'UTC'),
  COALESCE(o.portal_auth_mode, 'otp'),
  o.slug,
  o.created_at,
  o.updated_at
FROM ticketing.organizations o
WHERE EXISTS (SELECT 1 FROM accounts.organizations a WHERE a.id = o.id)
ON CONFLICT (organization_id) DO NOTHING;

-- Drop all FKs that point at ticketing.organizations, then point at accounts.organizations
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.confrelid = 'ticketing.organizations'::regclass
      AND c.contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;

  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'ticketing' AND c.relkind = 'r'
      AND c.relname NOT IN ('organizations', 'org_settings')
  LOOP
    EXECUTE format(
      'ALTER TABLE ticketing.%I
         ADD CONSTRAINT %I
         FOREIGN KEY (organization_id) REFERENCES accounts.organizations(id) ON DELETE CASCADE',
      r.tbl,
      r.tbl || '_organization_id_fkey'
    );
  END LOOP;
END $$;

-- Staging org view: MyAccount company + spoke settings
DROP VIEW IF EXISTS ticketing_marts.mart_tickets CASCADE;
DROP VIEW IF EXISTS ticketing_marts.mart_users CASCADE;
DROP VIEW IF EXISTS ticketing_marts.mart_agent_queue_members CASCADE;
DROP VIEW IF EXISTS ticketing_staging.stg_organizations CASCADE;
DROP VIEW IF EXISTS ticketing_staging.stg_users CASCADE;

CREATE VIEW ticketing_staging.stg_organizations AS
SELECT
  a.id::text AS organization_id,
  a.company_name AS organization_name,
  COALESCE(s.portal_slug, a.support_portal_slug) AS organization_slug,
  COALESCE(a.lifecycle_status, 'Active') AS organization_status,
  COALESCE(s.ticket_prefix, '#') AS ticket_prefix,
  COALESCE(s.display_timezone, 'UTC') AS display_timezone,
  COALESCE(s.portal_auth_mode, 'otp') AS portal_auth_mode,
  COALESCE(a.business_type::text, 'b2c') AS business_type,
  a.created_at,
  a.updated_at
FROM accounts.organizations a
LEFT JOIN ticketing.org_settings s ON s.organization_id = a.id;

DROP TABLE ticketing.organizations;

-- =============================================================================
-- Phase B: users → agents (mapped setup_users only; preserve ids)
-- =============================================================================

CREATE TABLE ticketing.agents (
  id                        BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  organization_id           BIGINT NOT NULL
    REFERENCES accounts.organizations(id) ON DELETE CASCADE,
  setup_user_id             BIGINT NOT NULL
    REFERENCES accounts.setup_users(id) ON DELETE CASCADE,
  support_email             TEXT,
  support_phone             TEXT,
  status                    TEXT NOT NULL DEFAULT 'Active'
    CHECK (status IN ('Active', 'Inactive')),
  role                      TEXT NOT NULL DEFAULT 'agent'
    CHECK (role IN ('admin', 'agent', 'resolver', 'customer', 'viewer')),
  last_login_at             TIMESTAMPTZ,
  two_factor_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  language                  TEXT NOT NULL DEFAULT 'English',
  timezone                  TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  date_format               TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  notify_ticket_assignments BOOLEAN NOT NULL DEFAULT TRUE,
  notify_ticket_updates     BOOLEAN NOT NULL DEFAULT TRUE,
  notify_security_alerts    BOOLEAN NOT NULL DEFAULT TRUE,
  notify_sla_alerts         BOOLEAN NOT NULL DEFAULT TRUE,
  notify_product_updates    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, setup_user_id)
);

CREATE INDEX idx_agents_organization_id ON ticketing.agents(organization_id);
CREATE UNIQUE INDEX idx_agents_setup_user_id ON ticketing.agents(setup_user_id);

INSERT INTO ticketing.agents (
  id, organization_id, setup_user_id, support_email, support_phone,
  status, role, last_login_at, two_factor_enabled, language, timezone, date_format,
  notify_ticket_assignments, notify_ticket_updates, notify_security_alerts,
  notify_sla_alerts, notify_product_updates, created_at, updated_at
)
SELECT
  u.id,
  u.organization_id,
  u.myaccount_user_id::bigint,
  NULLIF(btrim(u.email), ''),
  NULLIF(btrim(u.phone), ''),
  u.status,
  u.role,
  u.last_login_at,
  u.two_factor_enabled,
  u.language,
  u.timezone,
  u.date_format,
  u.notify_ticket_assignments,
  u.notify_ticket_updates,
  u.notify_security_alerts,
  u.notify_sla_alerts,
  u.notify_product_updates,
  u.created_at,
  u.updated_at
FROM ticketing.users u
WHERE u.myaccount_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM accounts.setup_users su WHERE su.id::text = u.myaccount_user_id
  )
  AND EXISTS (
    SELECT 1 FROM accounts.organizations a WHERE a.id = u.organization_id
  );

SELECT setval(
  pg_get_serial_sequence('ticketing.agents', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM ticketing.agents), 1),
  true
);

-- Retarget user FKs → agents (same ids)
ALTER TABLE ticketing.agent_queue_members DROP CONSTRAINT IF EXISTS agent_queue_members_user_id_fkey;
ALTER TABLE ticketing.agent_queue_members
  ADD CONSTRAINT agent_queue_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES ticketing.agents(id) ON DELETE CASCADE;

ALTER TABLE ticketing.conversation_contexts DROP CONSTRAINT IF EXISTS conversation_contexts_user_id_fkey;
ALTER TABLE ticketing.conversation_contexts
  ADD CONSTRAINT conversation_contexts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES ticketing.agents(id) ON DELETE SET NULL;

ALTER TABLE ticketing.kb_articles DROP CONSTRAINT IF EXISTS kb_articles_author_id_fkey;
ALTER TABLE ticketing.kb_articles
  ADD CONSTRAINT kb_articles_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES ticketing.agents(id) ON DELETE SET NULL;

ALTER TABLE ticketing.notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey;
ALTER TABLE ticketing.notifications
  ADD CONSTRAINT notifications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES ticketing.agents(id) ON DELETE CASCADE;

ALTER TABLE ticketing.ticket_notes DROP CONSTRAINT IF EXISTS ticket_notes_author_id_fkey;
ALTER TABLE ticketing.ticket_notes
  ADD CONSTRAINT ticket_notes_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES ticketing.agents(id) ON DELETE SET NULL;

ALTER TABLE ticketing.ticket_presence DROP CONSTRAINT IF EXISTS ticket_presence_user_id_fkey;
ALTER TABLE ticketing.ticket_presence
  ADD CONSTRAINT ticket_presence_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES ticketing.agents(id) ON DELETE CASCADE;

ALTER TABLE ticketing.user_login_events DROP CONSTRAINT IF EXISTS user_login_events_user_id_fkey;
ALTER TABLE ticketing.user_login_events
  ADD CONSTRAINT user_login_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES ticketing.agents(id) ON DELETE CASCADE;

ALTER TABLE ticketing.user_sessions DROP CONSTRAINT IF EXISTS user_sessions_user_id_fkey;
ALTER TABLE ticketing.user_sessions
  ADD CONSTRAINT user_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES ticketing.agents(id) ON DELETE CASCADE;

ALTER TABLE ticketing.workflow_events DROP CONSTRAINT IF EXISTS workflow_events_user_id_fkey;
ALTER TABLE ticketing.workflow_events
  ADD CONSTRAINT workflow_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES ticketing.agents(id) ON DELETE SET NULL;

CREATE VIEW ticketing_staging.stg_users AS
SELECT
  ag.id::text AS user_id,
  ag.organization_id::text AS organization_id,
  NULLIF(trim(both ' ' FROM concat_ws(' ', su.first_name, su.last_name)), '') AS user_name,
  su.work_email AS email,
  ag.role,
  ag.status,
  ag.setup_user_id::text AS myaccount_user_id,
  ag.last_login_at,
  ag.created_at,
  ag.updated_at,
  lower(ag.status) = 'active' AS is_active
FROM ticketing.agents ag
JOIN accounts.setup_users su ON su.id = ag.setup_user_id;

CREATE VIEW ticketing_marts.mart_users AS
SELECT
  user_id,
  organization_id,
  user_name,
  email,
  role,
  status,
  is_active,
  myaccount_user_id,
  last_login_at,
  created_at,
  updated_at
FROM ticketing_staging.stg_users;

DROP TABLE ticketing.users;

-- =============================================================================
-- Phase C: rename accounts → ticketing_accounts; drop unused product links
-- =============================================================================

ALTER TABLE ticketing.accounts RENAME TO ticketing_accounts;
ALTER TABLE ticketing.ticketing_accounts RENAME CONSTRAINT accounts_pkey TO ticketing_accounts_pkey;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_organization_id_fkey'
      AND conrelid = 'ticketing.ticketing_accounts'::regclass
  ) THEN
    ALTER TABLE ticketing.ticketing_accounts
      RENAME CONSTRAINT accounts_organization_id_fkey TO ticketing_accounts_organization_id_fkey;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_status_check'
      AND conrelid = 'ticketing.ticketing_accounts'::regclass
  ) THEN
    ALTER TABLE ticketing.ticketing_accounts
      RENAME CONSTRAINT accounts_status_check TO ticketing_accounts_status_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_organization_id_name_key'
      AND conrelid = 'ticketing.ticketing_accounts'::regclass
  ) THEN
    ALTER TABLE ticketing.ticketing_accounts
      RENAME CONSTRAINT accounts_organization_id_name_key TO ticketing_accounts_organization_id_name_key;
  END IF;
END $$;
ALTER INDEX IF EXISTS ticketing.idx_accounts_org RENAME TO idx_ticketing_accounts_org;

-- Ensure org FK on ticketing_accounts points at accounts.organizations
ALTER TABLE ticketing.ticketing_accounts
  DROP CONSTRAINT IF EXISTS ticketing_accounts_organization_id_fkey;
ALTER TABLE ticketing.ticketing_accounts
  DROP CONSTRAINT IF EXISTS accounts_organization_id_fkey;
ALTER TABLE ticketing.ticketing_accounts
  ADD CONSTRAINT ticketing_accounts_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES accounts.organizations(id) ON DELETE CASCADE;

ALTER TABLE ticketing.contact_profile
  DROP CONSTRAINT IF EXISTS contact_profile_account_id_fkey;
ALTER TABLE ticketing.contact_profile
  ADD CONSTRAINT contact_profile_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES ticketing.ticketing_accounts(id) ON DELETE SET NULL;

DROP TABLE IF EXISTS ticketing.contact_products;
DROP TABLE IF EXISTS ticketing.account_products;

DROP VIEW IF EXISTS ticketing_staging.stg_accounts CASCADE;
CREATE VIEW ticketing_staging.stg_accounts AS
SELECT
  id::text AS account_id,
  organization_id::text AS organization_id,
  name AS account_name,
  status,
  created_at,
  updated_at
FROM ticketing.ticketing_accounts;

-- Recreate mart_tickets after stg_accounts / stg_organizations / stg_users exist
CREATE VIEW ticketing_marts.mart_tickets AS
SELECT t.ticket_id,
  t.organization_id,
  o.organization_name,
  o.business_type AS organization_business_type,
  t.ticket_number,
  t.subject,
  t.status,
  ts.status_display_name,
  ts.is_terminal AS is_closed_by_status,
  t.priority,
  t.channel,
  t.customer_id,
  t.customer_name,
  t.customer_email,
  c.account_id,
  a.account_name,
  t.assignee_id,
  t.assignee_name,
  u.role AS assignee_role,
  t.resolver_id,
  t.resolver_name,
  t.queue_id,
  t.queue_name,
  q.queue_type,
  q.sla_status AS queue_sla_status,
  true AS team_supports_ticketing,
  t.category,
  t.skill,
  t.due_at,
  t.first_response_at,
  t.resolved_at,
  t.csat_score,
  t.csat_rated_at,
  t.created_by_id,
  t.created_by_name,
  t.is_resolved,
  CASE
    WHEN NOT COALESCE(ts.is_terminal, false) AND t.status::text <> 'Resolved'::text THEN true
    ELSE false
  END AS is_open,
  CASE
    WHEN t.status::text = 'Overdue'::text
      OR (t.due_at IS NOT NULL AND t.due_at < now()
          AND NOT COALESCE(ts.is_terminal, false)
          AND t.status::text <> 'Resolved'::text) THEN true
    ELSE false
  END AS is_overdue,
  CASE
    WHEN NOT COALESCE(ts.is_terminal, false)
     AND t.status::text <> 'Resolved'::text
     AND (lower(t.priority::text) = ANY (ARRAY['high'::text, 'urgent'::text])) THEN true
    ELSE false
  END AS is_high_priority_open,
  CASE
    WHEN NOT COALESCE(ts.is_terminal, false)
     AND t.status::text <> 'Resolved'::text
     AND t.due_at IS NOT NULL
     AND date(t.due_at) = CURRENT_DATE THEN true
    ELSE false
  END AS is_due_today,
  CASE
    WHEN NOT COALESCE(ts.is_terminal, false)
     AND t.status::text <> 'Resolved'::text
     AND t.due_at IS NOT NULL
     AND t.due_at > now()
     AND t.due_at <= (now() + '04:00:00'::interval) THEN true
    ELSE false
  END AS is_sla_at_risk,
  CASE
    WHEN (t.status::text = 'Overdue'::text
          OR (t.due_at IS NOT NULL AND t.due_at < now()
              AND NOT COALESCE(ts.is_terminal, false)
              AND t.status::text <> 'Resolved'::text))
     AND t.due_at IS NOT NULL
    THEN EXTRACT(epoch FROM now() - t.due_at) / 3600.0
    ELSE NULL::numeric
  END AS overdue_hours,
  CASE
    WHEN t.resolved_at IS NOT NULL AND t.due_at IS NOT NULL AND t.resolved_at <= t.due_at THEN true
    WHEN t.is_resolved AND sp.resolution_hours IS NOT NULL
     AND t.resolution_hours <= sp.resolution_hours::numeric THEN true
    ELSE false
  END AS is_resolution_sla_met,
  CASE
    WHEN t.resolved_at IS NOT NULL
     AND (t.due_at IS NOT NULL OR sp.resolution_hours IS NOT NULL) THEN true
    ELSE false
  END AS has_resolution_sla_target,
  sp.resolution_hours AS sla_resolution_hours,
  sp.first_response_hours AS sla_first_response_hours,
  CASE
    WHEN t.is_resolved AND sp.resolution_hours IS NOT NULL
    THEN t.resolution_hours - sp.resolution_hours::numeric
    ELSE NULL::numeric
  END AS resolution_hours_variance,
  t.created_at,
  t.updated_at
FROM ticketing_staging.stg_tickets t
LEFT JOIN ticketing_staging.stg_customers c
  ON t.customer_id = c.customer_id AND t.organization_id = c.organization_id
LEFT JOIN ticketing_staging.stg_accounts a
  ON c.account_id = a.account_id AND t.organization_id = a.organization_id
LEFT JOIN ticketing_staging.stg_agent_queues q
  ON t.queue_id = q.queue_id AND t.organization_id = q.organization_id
LEFT JOIN ticketing_staging.stg_users u
  ON t.assignee_id = u.user_id AND t.organization_id = u.organization_id
LEFT JOIN ticketing_staging.stg_organizations o
  ON t.organization_id = o.organization_id
LEFT JOIN ticketing_staging.stg_ticket_statuses ts
  ON t.status::text = ts.status AND t.organization_id = ts.organization_id
LEFT JOIN ticketing_staging.stg_sla_policies sp
  ON t.priority::text = sp.priority AND t.organization_id = sp.organization_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ticketing_staging' AND table_name = 'stg_agent_queue_members'
  ) THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW ticketing_marts.mart_agent_queue_members AS
      SELECT * FROM ticketing_staging.stg_agent_queue_members
    $v$;
  END IF;
END $$;

COMMENT ON TABLE ticketing.org_settings IS
  'Spoke-only org settings; company SoR is accounts.organizations';
COMMENT ON TABLE ticketing.agents IS
  'Thin support agent bridge; staff SoR is accounts.setup_users via setup_user_id';
COMMENT ON TABLE ticketing.ticketing_accounts IS
  'B2B client accounts in ticketing (not MyAccount schema)';

COMMIT;
