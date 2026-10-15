-- Minimal seed schema for local development and the end-to-end smoke test.
-- Mirrors the tables named in core.yaml.

CREATE SCHEMA IF NOT EXISTS accounts;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS ticketing;
CREATE SCHEMA IF NOT EXISTS ccaas;

-- ---------------------------------------------------------------- control plane
CREATE TABLE accounts.organisations (
    organization_id  text PRIMARY KEY,
    tenant_id        text NOT NULL UNIQUE,
    name             text NOT NULL,
    status           text NOT NULL DEFAULT 'active',
    instance         text,                 -- reserved for DBMS sharding
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- business tables
CREATE TABLE crm.contacts (
    contact_id       bigserial PRIMARY KEY,
    tenant_id        text NOT NULL,
    account_id       bigint,
    policy_id        bigint,
    first_name       text,
    last_name        text,
    email            text,
    phone            text,
    status           text,
    lifetime_value          numeric(18,2),   -- scale is DECLARED, never inferred
    lifetime_value_currency text,
    custom_data      jsonb,
    created_at       timestamp(6) NOT NULL DEFAULT now(),
    updated_at       timestamp(6) NOT NULL DEFAULT now()
);

CREATE TABLE crm.contact_attributes (
    attribute_id     bigserial PRIMARY KEY,
    tenant_id        text NOT NULL,
    contact_id       bigint NOT NULL,
    attr_name        text NOT NULL,
    attr_value       text
);

CREATE TABLE ticketing.tickets (
    ticket_id        bigserial PRIMARY KEY,
    tenant_id        text NOT NULL,
    contact_id       bigint,
    assigned_agent_id bigint,
    subject          text,
    status           text,
    priority         text,
    custom_data      jsonb,
    created_at       timestamp(6) NOT NULL DEFAULT now(),
    closed_at        timestamp(6)
);

CREATE TABLE ticketing.ticket_tags (
    tenant_id        text NOT NULL,
    ticket_id        bigint NOT NULL,
    tag_id           bigint NOT NULL,
    PRIMARY KEY (ticket_id, tag_id)
);

CREATE TABLE ccaas.calls (
    call_id          bigserial PRIMARY KEY,
    tenant_id        text NOT NULL,
    contact_id       bigint,
    direction        text,
    disposition      text,
    duration_seconds integer,
    started_at       timestamp(6)
);

-- ---------------------------------------------------------------- REPLICA IDENTITY
-- NOT an optimisation. Under DEFAULT, a DELETE's before-image carries only
-- primary-key columns, so tenant_id is absent and every delete is quarantined.
ALTER TABLE accounts.organisations   REPLICA IDENTITY FULL;
ALTER TABLE crm.contacts             REPLICA IDENTITY FULL;
ALTER TABLE crm.contact_attributes   REPLICA IDENTITY FULL;
ALTER TABLE ticketing.tickets        REPLICA IDENTITY FULL;
ALTER TABLE ticketing.ticket_tags    REPLICA IDENTITY FULL;
ALTER TABLE ccaas.calls              REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------- seed
INSERT INTO accounts.organisations (organization_id, tenant_id, name, status) VALUES
    ('a1b2c3d4', 'tenant-alpha', 'Alpha Insurance', 'active'),
    ('b5e6f7a8', 'tenant-beta',  'Beta Retail',     'active');
