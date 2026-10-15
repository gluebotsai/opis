/**
 * Support-portal conversation for one ticket.
 * Staff Notes stay in ticket_notes (internal). Email threads stay on the CCaaS path.
 */
import { looksLikeInboundEmailDump } from "./emailIntake";
import { query } from "./db";

export type PortalMessageSource = "portal_chat" | "portal_reply" | "csat";

export type PortalConversationRow = {
  id: string;
  author_name: string;
  body: string;
  created_at: Date | string;
  source: string;
};

/** Public ticket_notes that are portal chat, not mail copies. */
export function isStoredPortalConversationNote(body: string): boolean {
  const text = String(body || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return false;
  if (looksLikeInboundEmailDump(text)) return false;
  const first = text.split("\n")[0]?.trim() || "";
  if (
    /^\[[^\]]+\]\s+(We received your request|Your request was resolved|Your ticket is closed|Your ticket is open|Your ticket was reopened|We are working on your ticket|Your ticket is now\b)/i.test(
      first
    )
  ) {
    return false;
  }
  if (/^(\[[^\]]+\]|Re:)/i.test(first) && text.includes("\n\n")) return false;
  return true;
}

export async function ensurePortalConversationTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.ticket_portal_messages (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      ticket_id        BIGINT NOT NULL REFERENCES ticketing.tickets(id) ON DELETE CASCADE,
      author_name      TEXT NOT NULL,
      body             TEXT NOT NULL,
      source           TEXT NOT NULL DEFAULT 'portal_chat',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_ticket_portal_messages_ticket
      ON ticketing.ticket_portal_messages (organization_id, ticket_id, created_at)
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_portal_messages_natural
      ON ticketing.ticket_portal_messages (
        organization_id, ticket_id, created_at, md5(body)
      )
  `);
}

export async function insertPortalConversationMessages(input: {
  organizationId: string;
  ticketId: string;
  source: PortalMessageSource;
  messages: Array<{ authorName: string; body: string; ageMs: number }>;
}): Promise<void> {
  const messages = input.messages.filter((row) => String(row.body || "").trim());
  if (!messages.length) return;
  const params: unknown[] = [input.organizationId, input.ticketId, input.source];
  const values: string[] = [];
  for (const row of messages) {
    const base = params.length;
    params.push(row.authorName, row.body, row.ageMs);
    values.push(
      `($1, $2, $${base + 1}, $${base + 2}, $3, NOW() - ($${base + 3}::int * INTERVAL '1 millisecond'))`
    );
  }
  await query(
    `INSERT INTO ticketing.ticket_portal_messages (
       organization_id, ticket_id, author_name, body, source, created_at
     ) VALUES ${values.join(", ")}
     ON CONFLICT (organization_id, ticket_id, created_at, md5(body)) DO NOTHING`,
    params
  );
}

export async function listPortalConversationMessages(
  organizationId: string,
  ticketId: string
): Promise<PortalConversationRow[]> {
  const { rows } = await query(
    `SELECT id, author_name, body, created_at, source
       FROM ticketing.ticket_portal_messages
      WHERE organization_id = $1 AND ticket_id = $2
      ORDER BY created_at ASC, id ASC`,
    [organizationId, ticketId]
  );
  return rows.map((row) => ({
    id: String(row.id),
    author_name: String(row.author_name || ""),
    body: String(row.body || ""),
    created_at: row.created_at as Date,
    source: String(row.source || ""),
  }));
}

export async function portalChatTurnAlreadyStored(input: {
  organizationId: string;
  ticketId: string;
  userText: string;
  assistantText: string;
}): Promise<boolean> {
  const recent = await query(
    `SELECT body
       FROM ticketing.ticket_portal_messages
      WHERE organization_id = $1 AND ticket_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 2`,
    [input.organizationId, input.ticketId]
  );
  const newest = String(recent.rows[0]?.body || "").trim();
  const prior = String(recent.rows[1]?.body || "").trim();
  return newest === input.assistantText && prior === input.userText;
}

/** Move existing portal public notes into the conversation table. Mail rows stay. */
export async function backfillPortalConversationFromNotes(): Promise<void> {
  const { rows } = await query(
    `SELECT id, organization_id, ticket_id, author_name, body, created_at
       FROM ticketing.ticket_notes
      WHERE COALESCE(visibility, 'internal') = 'public'
        AND deleted_at IS NULL`
  );
  for (const row of rows) {
    const body = String(row.body || "");
    if (!isStoredPortalConversationNote(body)) continue;
    await query(
      `INSERT INTO ticketing.ticket_portal_messages (
         organization_id, ticket_id, author_name, body, source, created_at
       ) VALUES ($1, $2, $3, $4, 'portal_chat', $5)
       ON CONFLICT (organization_id, ticket_id, created_at, md5(body)) DO NOTHING`,
      [
        row.organization_id,
        row.ticket_id,
        String(row.author_name || "Customer"),
        body,
        row.created_at,
      ]
    );
    await query(
      `UPDATE ticketing.ticket_notes
          SET deleted_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL`,
      [row.id]
    );
  }
}
