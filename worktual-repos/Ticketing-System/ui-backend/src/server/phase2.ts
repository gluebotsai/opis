/**
 * Phase 2 schema: macros, note visibility, org preferences (spoke org_settings).
 */
import { query } from "./db";

export async function ensurePhase2Schema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.macros (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      title            TEXT NOT NULL,
      body             TEXT NOT NULL,
      created_by_id    BIGINT,
      created_by_name  TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_macros_org ON ticketing.macros(organization_id, title)`
  );

  await query(
    `ALTER TABLE ticketing.ticket_notes
     ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'internal'`
  );

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

  await query(
    `ALTER TABLE ticketing.tickets
     ADD COLUMN IF NOT EXISTS created_by_id BIGINT`
  );
  await query(
    `ALTER TABLE ticketing.tickets
     ADD COLUMN IF NOT EXISTS created_by_name TEXT`
  );
}
