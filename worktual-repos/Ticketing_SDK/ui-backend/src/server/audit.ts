/**
 * Append-only audit trail for ticketing actions.
 */
import { query } from "./db";
import { enqueueTicketEvent } from "./ticketEventOutbox";

export type AuditAction =
  | "ticket.created"
  | "ticket.updated"
  | "ticket.assigned"
  | "ticket.escalated"
  | "ticket.note_added"
  | "ticket.note_edited"
  | "ticket.note_deleted"
  | "ticket.status_changed"
  | "ticket.rated";

export async function ensureAuditTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.audit_events (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      actor_id         BIGINT,
      actor_name       TEXT,
      action           TEXT NOT NULL,
      ticket_id        BIGINT,
      ticket_number    TEXT,
      meta             JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_audit_events_org_created
     ON ticketing.audit_events(organization_id, created_at DESC)`
  );
}

export async function writeAuditEvent(input: {
  organizationId: string;
  actorId?: string | null;
  actorName?: string | null;
  action: AuditAction | string;
  ticketId?: string | null;
  ticketNumber?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO ticketing.audit_events (
         organization_id, actor_id, actor_name, action,
         ticket_id, ticket_number, meta
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        input.organizationId,
        input.actorId || null,
        input.actorName || null,
        input.action,
        input.ticketId || null,
        input.ticketNumber || null,
        JSON.stringify(input.meta || {}),
      ]
    );
    void enqueueTicketEvent({
      organizationId: input.organizationId,
      action: input.action,
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      meta: input.meta,
    }).catch((err) => {
      console.warn("ticket event outbox enqueue failed:", (err as Error).message);
    });
  } catch (err) {
    console.warn("audit write failed:", (err as Error).message);
  }
}

function auditRangeStart(range?: string): string | null {
  const key = String(range || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (key === "today" || key === "last_24h" || key === "24hours") {
    return "NOW() - INTERVAL '24 hours'";
  }
  if (key === "yesterday") {
    return "NOW() - INTERVAL '2 days'";
  }
  if (key === "last_7d" || key === "7days" || key === "this_week" || key === "last_week") {
    return "NOW() - INTERVAL '7 days'";
  }
  if (key === "last_30d" || key === "30days" || key === "this_month" || key === "last_month") {
    return "NOW() - INTERVAL '30 days'";
  }
  if (key === "last_90d" || key === "90days") {
    return "NOW() - INTERVAL '90 days'";
  }
  return null;
}

export async function listAuditEvents(
  organizationId: string,
  limitOrOpts:
    | number
    | {
        limit?: number;
        action?: string;
        actor?: string;
        ticket?: string;
        range?: string;
      } = 100
): Promise<
  Array<{
    id: string;
    actorName: string | null;
    action: string;
    ticketNumber: string | null;
    meta: Record<string, unknown>;
    createdAt: string;
  }>
> {
  const opts =
    typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts || {};
  const limit = Math.min(Math.max(Number(opts.limit || 100), 1), 500);
  const action = String(opts.action || "").trim();
  const actor = String(opts.actor || "").trim();
  const ticket = String(opts.ticket || "").trim().replace(/^#/, "");
  const sinceSql = auditRangeStart(opts.range);
  const params: unknown[] = [organizationId];
  let where = "organization_id = $1";
  if (action) {
    params.push(`%${action}%`);
    where += ` AND action ILIKE $${params.length}`;
  }
  if (actor) {
    params.push(`%${actor}%`);
    where += ` AND actor_name ILIKE $${params.length}`;
  }
  if (ticket) {
    params.push(`%${ticket}%`);
    where += ` AND ticket_number ILIKE $${params.length}`;
  }
  if (sinceSql) {
    where += ` AND created_at >= ${sinceSql}`;
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT id, actor_name, action, ticket_number, meta, created_at
     FROM ticketing.audit_events
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => ({
    id: String(r.id),
    actorName: r.actor_name ? String(r.actor_name) : null,
    action: String(r.action),
    ticketNumber: r.ticket_number ? String(r.ticket_number) : null,
    meta:
      r.meta && typeof r.meta === "object"
        ? (r.meta as Record<string, unknown>)
        : {},
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  }));
}
