-- TEST DATABASE ONLY. Minimal ticketing tables so tests can run guarded SQL for real.
-- Column set matches tests/golden/seed.sql and product/schema.yml sources.
DROP SCHEMA IF EXISTS ticketing CASCADE;
CREATE SCHEMA ticketing;

CREATE TABLE ticketing.ticket_statuses (
    organization_id bigint, status text, display_name text, is_system boolean,
    is_terminal boolean, sort_order int, active boolean,
    UNIQUE (organization_id, status)
);
CREATE TABLE ticketing.sla_policies (
    id bigserial PRIMARY KEY, organization_id bigint, priority text,
    resolution_hours int, first_response_hours int, active boolean,
    UNIQUE (organization_id, priority)
);
CREATE TABLE ticketing.agents (
    id bigint PRIMARY KEY, organization_id bigint, setup_user_id bigint,
    support_email text, status text, role text, created_at timestamptz
);
CREATE TABLE ticketing.agent_queues (
    id bigint PRIMARY KEY, organization_id bigint, queue_name text, type text, created_at timestamptz
);
CREATE TABLE ticketing.agent_queue_members (
    organization_id bigint, queue_id bigint, user_id bigint, created_at timestamptz
);
CREATE TABLE ticketing.contact_profile (
    id bigint PRIMARY KEY, organization_id bigint, cdp_id text, status text,
    total_tickets int, account_id bigint, created_at timestamptz
);
CREATE TABLE ticketing.ticketing_accounts (
    id bigint PRIMARY KEY, organization_id bigint, name text, status text, created_at timestamptz
);
CREATE TABLE ticketing.tickets (
    id bigint PRIMARY KEY, organization_id bigint, ticket_number text, subject text,
    description text, status text, priority text, channel text, category text, skill text,
    customer_id bigint, customer_name text, customer_email text, customer_phone text,
    assignee_id bigint, assignee_name text, resolver_id bigint, resolver_name text,
    queue_id bigint, queue_name text, due_at timestamptz, first_response_at timestamptz,
    resolved_at timestamptz, csat_score int, csat_rated_at timestamptz,
    created_by_id bigint, created_by_name text, created_at timestamptz, updated_at timestamptz,
    attachments text
);
CREATE TABLE ticketing.ticket_notes (
    id bigint PRIMARY KEY, organization_id bigint, ticket_id bigint, author_id bigint,
    author_name text, body text, created_at timestamptz
);
CREATE TABLE ticketing.audit_events (
    id bigint PRIMARY KEY, organization_id bigint, ticket_id bigint, action text,
    actor_id bigint, actor_name text, meta jsonb, created_at timestamptz
);
CREATE TABLE ticketing.notifications (
    id bigint PRIMARY KEY, organization_id bigint, user_id bigint, kind text,
    is_read boolean, created_at timestamptz
);
CREATE TABLE ticketing.kb_articles (
    id bigint PRIMARY KEY, organization_id bigint, title text, status text, category text,
    views int, created_at timestamptz
);
CREATE TABLE ticketing.proactive_recommendations (
    id bigint PRIMARY KEY, organization_id bigint, ticket_id text, agent_id text,
    status text, created_at timestamptz
);
CREATE TABLE ticketing.proactive_approvals (
    id bigint PRIMARY KEY, organization_id bigint, ticket_id text, agent_id text,
    status text, tool_name text, created_at timestamptz
);
