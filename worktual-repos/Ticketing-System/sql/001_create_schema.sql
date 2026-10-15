-- Worktual ticketing schema
-- Every business table includes organisation_id for multi-tenant isolation.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Organisations (tenant root)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organisations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'Active'
                  CHECK (status IN ('Active', 'Inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Users / agents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  initials         TEXT,
  role             TEXT NOT NULL DEFAULT 'agent'
                     CHECK (role IN ('admin', 'agent', 'viewer')),
  status           TEXT NOT NULL DEFAULT 'Active'
                     CHECK (status IN ('Active', 'Inactive')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_organisation_id ON users(organisation_id);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_id      TEXT, -- e.g. CUST-001
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT,
  status           TEXT NOT NULL DEFAULT 'Active'
                     CHECK (status IN ('Active', 'Inactive')),
  total_tickets    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, email),
  UNIQUE (organisation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_customers_organisation_id ON customers(organisation_id);

-- ---------------------------------------------------------------------------
-- Agent queues / teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_queues (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_id      TEXT, -- e.g. Q-001
  queue_name       TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'Private'
                     CHECK (type IN ('Private', 'Shared')),
  open_tickets     INTEGER NOT NULL DEFAULT 0,
  assigned         INTEGER NOT NULL DEFAULT 0,
  sla_status       TEXT NOT NULL DEFAULT 'On Track'
                     CHECK (sla_status IN ('At Risk', 'On Track')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, queue_name),
  UNIQUE (organisation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_queues_organisation_id ON agent_queues(organisation_id);

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  ticket_number    TEXT NOT NULL, -- e.g. #12503
  subject          TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_name    TEXT NOT NULL,
  customer_email   TEXT NOT NULL,
  customer_phone   TEXT,
  channel          TEXT NOT NULL DEFAULT 'Web'
                     CHECK (channel IN ('Email', 'Chat', 'Phone', 'Web')),
  assignee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  assignee_name    TEXT NOT NULL DEFAULT 'Unassigned',
  queue_id         UUID REFERENCES agent_queues(id) ON DELETE SET NULL,
  queue_name       TEXT,
  priority         TEXT NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status           TEXT NOT NULL DEFAULT 'Open'
                     CHECK (status IN ('Open', 'Pending', 'On Hold', 'Resolved', 'Overdue')),
  attachments      TEXT[] NOT NULL DEFAULT '{}',
  due_at           TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_tickets_organisation_id ON tickets(organisation_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(organisation_id, assignee_name);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(organisation_id, queue_name);

-- ---------------------------------------------------------------------------
-- Ticket notes / conversation thread
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_notes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  ticket_id        UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name      TEXT NOT NULL,
  body             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_notes_organisation_id ON ticket_notes(organisation_id);
CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket_id ON ticket_notes(ticket_id);

-- ---------------------------------------------------------------------------
-- Knowledge base articles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_articles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  external_id      TEXT, -- e.g. KB-101
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'General'
                     CHECK (category IN ('Billing', 'Troubleshooting', 'Accounts', 'General')),
  author_name      TEXT NOT NULL,
  author_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'Published'
                     CHECK (status IN ('Published', 'Draft')),
  views            INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_organisation_id ON kb_articles(organisation_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON kb_articles(organisation_id, category);

-- ---------------------------------------------------------------------------
-- Activity logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  ticket_id        UUID REFERENCES tickets(id) ON DELETE SET NULL,
  text             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_organisation_id ON activity_logs(organisation_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(organisation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  message          TEXT NOT NULL,
  ticket_id        UUID REFERENCES tickets(id) ON DELETE SET NULL,
  customer_name    TEXT,
  is_read          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_organisation_id ON notifications(organisation_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(organisation_id, user_id, is_read);

-- ---------------------------------------------------------------------------
-- Dashboard metrics snapshots (optional cached KPIs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dashboard_metrics (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  open_tickets     INTEGER NOT NULL DEFAULT 0,
  on_hold          INTEGER NOT NULL DEFAULT 0,
  overdue          INTEGER NOT NULL DEFAULT 0,
  due_today        INTEGER NOT NULL DEFAULT 0,
  unassigned       INTEGER NOT NULL DEFAULT 0,
  open_change      TEXT NOT NULL DEFAULT '—',
  on_hold_change   TEXT NOT NULL DEFAULT '—',
  overdue_change   TEXT NOT NULL DEFAULT '—',
  due_today_change TEXT NOT NULL DEFAULT '—',
  unassigned_change TEXT NOT NULL DEFAULT '—',
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_metrics_organisation_id ON dashboard_metrics(organisation_id);

-- ---------------------------------------------------------------------------
-- Seed default organisation + Jane Smith agent (matches UI currentUser)
-- ---------------------------------------------------------------------------
INSERT INTO organisations (id, name, slug, status)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'Worktual',
  'worktual',
  'Active'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO users (id, organisation_id, name, email, initials, role, status)
VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'Jane Smith',
  'jane.smith@worktual.com',
  'JS',
  'admin',
  'Active'
)
ON CONFLICT (organisation_id, email) DO NOTHING;
