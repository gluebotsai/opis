-- Single-table auth: admin_accounts holds login + site config.
CREATE TABLE IF NOT EXISTS "admin_accounts" (
    "id"               SERIAL NOT NULL,
    "admin_name"       TEXT NOT NULL,
    "email"            TEXT NOT NULL,
    "password_hash"    TEXT NOT NULL,
    "domain_id"        INTEGER NOT NULL,
    "domain_name"      TEXT NOT NULL,
    "site_type"        TEXT NOT NULL DEFAULT 'blog',
    "status"           TEXT NOT NULL DEFAULT 'active',
    "organization_id"  UUID,
    "is_active"        BOOLEAN NOT NULL DEFAULT true,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "admin_accounts_email_key" ON "admin_accounts"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "admin_accounts_domain_id_key" ON "admin_accounts"("domain_id");
