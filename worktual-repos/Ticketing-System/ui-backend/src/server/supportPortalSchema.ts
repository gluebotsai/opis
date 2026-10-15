import { query } from "./db";

/**
 * Idempotent support-portal schema guards (hub org = accounts.organizations;
 * B2B clients = ticketing.ticketing_accounts; staff = ticketing.agents).
 */
export async function ensureSupportPortalSchema(): Promise<void> {
  await query(`
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
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.ticketing_accounts (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'Active'
                         CHECK (status IN ('Active', 'Inactive')),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, name)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_ticketing_accounts_org ON ticketing.ticketing_accounts(organization_id)`
  );

  await query(`
    ALTER TABLE ticketing.contact_profile
      ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES ticketing.ticketing_accounts(id) ON DELETE SET NULL
  `).catch(() => undefined);
  await query(
    `ALTER TABLE ticketing.contact_profile ADD COLUMN IF NOT EXISTS password_hash TEXT`
  ).catch(() => undefined);
  await query(
    `ALTER TABLE ticketing.contact_profile ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ`
  ).catch(() => undefined);
  await query(
    `ALTER TABLE ticketing.contact_profile ADD COLUMN IF NOT EXISTS last_portal_login_at TIMESTAMPTZ`
  ).catch(() => undefined);
  await query(
    `ALTER TABLE ticketing.contact_profile ADD COLUMN IF NOT EXISTS cdp_id TEXT`
  ).catch(() => undefined);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_profile_org_cdp
      ON ticketing.contact_profile (organization_id, cdp_id)
      WHERE cdp_id IS NOT NULL AND btrim(cdp_id) <> ''
  `).catch(() => undefined);

  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.customer_otp_challenges (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      customer_id      BIGINT NOT NULL REFERENCES ticketing.contact_profile(id) ON DELETE CASCADE,
      identifier       TEXT NOT NULL,
      channel          TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
      code_hash        TEXT NOT NULL,
      attempts         INTEGER NOT NULL DEFAULT 0,
      expires_at       TIMESTAMPTZ NOT NULL,
      consumed_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_customer_otp_org_ident
      ON ticketing.customer_otp_challenges(organization_id, identifier, created_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.customer_password_tokens (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      customer_id      BIGINT NOT NULL REFERENCES ticketing.contact_profile(id) ON DELETE CASCADE,
      token_hash       TEXT NOT NULL,
      expires_at       TIMESTAMPTZ NOT NULL,
      consumed_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_customer_pw_tokens_hash
      ON ticketing.customer_password_tokens(token_hash)
      WHERE consumed_at IS NULL
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.customer_portal_sessions (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      customer_id      BIGINT NOT NULL REFERENCES ticketing.contact_profile(id) ON DELETE CASCADE,
      device_label     TEXT,
      ip_address       TEXT,
      user_agent       TEXT,
      last_active_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at       TIMESTAMPTZ
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_portal_sessions_customer
      ON ticketing.customer_portal_sessions(customer_id, revoked_at)
  `);
}
