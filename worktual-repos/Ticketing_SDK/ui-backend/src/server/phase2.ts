/**
 * Phase 2 schema: macros, note visibility, org preferences (spoke org_settings).
 */
import { ensureColumn, query } from "./db";

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

  await ensureColumn(
    "ticketing",
    "ticket_notes",
    "visibility",
    "TEXT NOT NULL DEFAULT 'internal'"
  );
  await ensureColumn(
    "ticketing",
    "ticket_notes",
    "pinned",
    "BOOLEAN NOT NULL DEFAULT FALSE"
  );
  await ensureColumn("ticketing", "ticket_notes", "pinned_at", "TIMESTAMPTZ");
  await ensureColumn("ticketing", "ticket_notes", "edited_at", "TIMESTAMPTZ");
  await ensureColumn("ticketing", "ticket_notes", "deleted_at", "TIMESTAMPTZ");

  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.ticket_note_reads (
      organization_id BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      ticket_id       BIGINT NOT NULL REFERENCES ticketing.tickets(id) ON DELETE CASCADE,
      user_id         BIGINT NOT NULL REFERENCES ticketing.agents(id) ON DELETE CASCADE,
      last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, ticket_id, user_id)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_ticket_note_reads_ticket
     ON ticketing.ticket_note_reads(organization_id, ticket_id)`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.ticket_attachment_reads (
      organization_id BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      ticket_id       BIGINT NOT NULL REFERENCES ticketing.tickets(id) ON DELETE CASCADE,
      user_id         BIGINT NOT NULL REFERENCES ticketing.agents(id) ON DELETE CASCADE,
      last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      seen_urls       TEXT[] NOT NULL DEFAULT '{}',
      PRIMARY KEY (organization_id, ticket_id, user_id)
    )
  `);
  await ensureColumn(
    "ticketing",
    "ticket_attachment_reads",
    "seen_urls",
    "TEXT[] NOT NULL DEFAULT '{}'"
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_ticket_attachment_reads_ticket
     ON ticketing.ticket_attachment_reads(organization_id, ticket_id)`
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
  await ensureColumn("ticketing", "org_settings", "portal_logo_url", "TEXT");
  await ensureColumn("ticketing", "tickets", "created_by_id", "BIGINT");
  await ensureColumn("ticketing", "tickets", "created_by_name", "TEXT");
}
