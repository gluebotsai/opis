-- Multi-schema layout (single database). Safe to re-run.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS accounts;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS cvm;
CREATE SCHEMA IF NOT EXISTS ticketing;
CREATE SCHEMA IF NOT EXISTS ccass;
CREATE SCHEMA IF NOT EXISTS cdp;
CREATE SCHEMA IF NOT EXISTS campaign;

COMMENT ON SCHEMA platform IS 'Global staff, catalogs, mail, partners/resellers';
COMMENT ON SCHEMA accounts IS 'My Accounts — tenancy root, billing, sales CRM, customer portal';
COMMENT ON SCHEMA crm IS 'AI Native CRM product data';
COMMENT ON SCHEMA cvm IS 'Customer Value Management product data';
COMMENT ON SCHEMA ticketing IS 'Ticketing product data';
COMMENT ON SCHEMA ccass IS 'Contact Center as a Service product data';
COMMENT ON SCHEMA cdp IS 'Customer Data Platform product data';
COMMENT ON SCHEMA campaign IS 'Campaign Management product data';
