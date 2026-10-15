-- Migration ledger for ordered, idempotent db-cc SQL migrations.
-- Applied by packages/db-cc/src/migrate.ts

CREATE TABLE IF NOT EXISTS ccass.schema_migrations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL UNIQUE,
  checksum    VARCHAR(64) NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_name ON ccass.schema_migrations (name);
