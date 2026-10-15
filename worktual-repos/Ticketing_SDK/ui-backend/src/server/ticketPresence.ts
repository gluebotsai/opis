/**
 * Agent collision / ticket viewing presence.
 * Heartbeat upsert + TTL; clients poll while ticket detail is open.
 */
import { query } from "./db";

/** Viewers older than this are treated as gone. */
export const PRESENCE_STALE_MS = 45_000;

export type TicketViewer = {
  userId: string;
  name: string;
  lastSeenAt: string;
};

export async function ensureTicketPresenceTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.ticket_presence (
      organization_id BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      ticket_id       BIGINT NOT NULL REFERENCES ticketing.tickets(id) ON DELETE CASCADE,
      user_id         BIGINT NOT NULL REFERENCES ticketing.agents(id) ON DELETE CASCADE,
      user_name       TEXT NOT NULL,
      last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, ticket_id, user_id)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_ticket_presence_ticket_seen
     ON ticketing.ticket_presence(organization_id, ticket_id, last_seen_at DESC)`
  );
}

export async function upsertTicketPresence(input: {
  organizationId: string;
  ticketUuid: string;
  userId: string;
  userName: string;
}): Promise<void> {
  await query(
    `INSERT INTO ticketing.ticket_presence (
       organization_id, ticket_id, user_id, user_name, last_seen_at
     ) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (organization_id, ticket_id, user_id)
     DO UPDATE SET user_name = EXCLUDED.user_name, last_seen_at = NOW()`,
    [
      input.organizationId,
      input.ticketUuid,
      input.userId,
      input.userName.trim() || "Agent",
    ]
  );
}

export async function clearTicketPresence(input: {
  organizationId: string;
  ticketUuid: string;
  userId: string;
}): Promise<void> {
  await query(
    `DELETE FROM ticketing.ticket_presence
     WHERE organization_id = $1 AND ticket_id = $2 AND user_id = $3`,
    [input.organizationId, input.ticketUuid, input.userId]
  );
}

/** Other active viewers on this ticket (excludes self; drops stale rows). */
export async function listOtherTicketViewers(input: {
  organizationId: string;
  ticketUuid: string;
  excludeUserId: string;
  staleMs?: number;
}): Promise<TicketViewer[]> {
  const staleMs = input.staleMs ?? PRESENCE_STALE_MS;
  const staleSeconds = Math.max(5, Math.ceil(staleMs / 1000));
  const { rows } = await query(
    `SELECT user_id, user_name, last_seen_at
     FROM ticketing.ticket_presence
     WHERE organization_id = $1
       AND ticket_id = $2
       AND user_id <> $3
       AND last_seen_at > NOW() - ($4::int * INTERVAL '1 second')
     ORDER BY last_seen_at DESC`,
    [input.organizationId, input.ticketUuid, input.excludeUserId, staleSeconds]
  );
  return rows.map((r) => ({
    userId: String(r.user_id),
    name: String(r.user_name || "Agent"),
    lastSeenAt: String(r.last_seen_at),
  }));
}

/** Best-effort cleanup of very old rows (optional housekeeping). */
export async function pruneStaleTicketPresence(
  olderThanMs = 24 * 60 * 60 * 1000
): Promise<void> {
  const olderThanSeconds = Math.max(60, Math.ceil(olderThanMs / 1000));
  await query(
    `DELETE FROM ticketing.ticket_presence
     WHERE last_seen_at < NOW() - ($1::int * INTERVAL '1 second')`,
    [olderThanSeconds]
  ).catch(() => undefined);
}
