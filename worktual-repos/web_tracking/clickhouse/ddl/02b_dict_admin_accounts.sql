-- Reloads from PostgreSQL public.v_web_tracking_ingest_registry every 15–60 seconds.
-- (My Accounts JSON flattened — legacy source was public.admin_accounts.)
-- Postgres columns: website_id, website_url, site_type, status, organization_id, is_active.
-- Password/host substituted by scripts/apply_clickhouse_ddl.py from CH_DICT_PG_* env vars.

CREATE DICTIONARY IF NOT EXISTS web_tracking.dict_admin_accounts
(
    website_id        UInt32,
    website_url       String,
    site_type         String,
    status            String,
    organization_id   Int64,
    is_active         Bool
)
PRIMARY KEY website_id
SOURCE(POSTGRESQL(
    port __CH_DICT_PG_PORT__
    host '__CH_DICT_PG_HOST__'
    db '__CH_DICT_PG_DB__'
    user '__CH_DICT_PG_USER__'
    password '__CH_DICT_PG_PASSWORD__'
    schema '__CH_DICT_PG_SCHEMA__'
    table '__CH_DICT_PG_TABLE__'
))
LIFETIME(MIN 15 MAX 60)
LAYOUT(HASHED());
