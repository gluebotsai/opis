/**
 * Transactional outbox for outbound ticket webhooks (CRM / CCaaS consumers).
 */
import crypto from "crypto";
import { query } from "./db";
import type { AuditAction } from "./audit";

const OUTBOX_EVENT_MAP: Partial<Record<AuditAction | string, string>> = {
  "ticket.created": "ticket.created",
  "ticket.assigned": "ticket.assigned",
  "ticket.escalated": "ticket.escalated",
  "ticket.status_changed": "ticket.status_changed",
  "ticket.updated": "ticket.updated",
  "ticket.note_added": "ticket.note_added",
};

let workerStarted = false;

export async function ensureTicketEventOutboxTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.ticket_event_outbox (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      event_type       TEXT NOT NULL,
      payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
      webhook_url      TEXT,
      status           TEXT NOT NULL DEFAULT 'pending',
      attempts         INT NOT NULL DEFAULT 0,
      last_error       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivered_at     TIMESTAMPTZ
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_ticket_event_outbox_pending
     ON ticketing.ticket_event_outbox(status, created_at)
     WHERE status = 'pending'`
  );
}

function signingSecret(): string {
  return (
    String(process.env.WEBHOOK_SIGNING_SECRET || "").trim() ||
    String(process.env.INTERNAL_SERVICE_KEY || "").trim() ||
    String(process.env.JWT_SECRET || "").trim()
  );
}

function signPayload(body: string): string {
  const secret = signingSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function resolveWebhookUrl(_organizationId: string): Promise<string | null> {
  const envUrl = String(process.env.TICKETING_WEBHOOK_URL || "").trim();
  return envUrl || null;
}

export async function enqueueTicketEvent(input: {
  organizationId: string;
  action: AuditAction | string;
  ticketId?: string | null;
  ticketNumber?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const eventType = OUTBOX_EVENT_MAP[input.action] || String(input.action || "").trim();
  if (!eventType || !input.organizationId) return;

  const payload = {
    type: eventType,
    organizationId: input.organizationId,
    ticketId: input.ticketId || null,
    ticketNumber: input.ticketNumber || null,
    meta: input.meta || {},
    emittedAt: new Date().toISOString(),
  };

  const webhookUrl = await resolveWebhookUrl(input.organizationId);

  await query(
    `INSERT INTO ticketing.ticket_event_outbox
       (organization_id, event_type, payload, webhook_url, status)
     VALUES ($1::bigint, $2, $3::jsonb, $4, $5)`,
    [
      input.organizationId,
      eventType,
      JSON.stringify(payload),
      webhookUrl,
      webhookUrl ? "pending" : "queued",
    ]
  );
}

async function deliverOutboxRow(row: {
  id: string;
  webhook_url: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const body = JSON.stringify(row.payload);
  const signature = signPayload(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Worktual-Event": String(row.payload.type || "ticket.event"),
  };
  if (signature) {
    headers["X-Worktual-Signature"] = `sha256=${signature}`;
  }

  const res = await fetch(String(row.webhook_url), {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    throw new Error(`Webhook HTTP ${res.status}`);
  }
}

async function processOutboxBatch(limit = 20): Promise<void> {
  const { rows } = await query<{
    id: string;
    webhook_url: string | null;
    payload: Record<string, unknown>;
    attempts: number;
  }>(
    `SELECT id, webhook_url, payload, attempts
     FROM ticketing.ticket_event_outbox
     WHERE status = 'pending' AND webhook_url IS NOT NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  for (const row of rows) {
    if (!row.webhook_url) continue;
    try {
      await deliverOutboxRow({
        id: row.id,
        webhook_url: row.webhook_url,
        payload: row.payload || {},
      });
      await query(
        `UPDATE ticketing.ticket_event_outbox
         SET status = 'delivered', delivered_at = NOW(), attempts = attempts + 1
         WHERE id = $1`,
        [row.id]
      );
    } catch (err) {
      const msg = (err as Error).message || "delivery failed";
      const attempts = Number(row.attempts || 0) + 1;
      const status = attempts >= 5 ? "failed" : "pending";
      await query(
        `UPDATE ticketing.ticket_event_outbox
         SET attempts = $2, last_error = $3, status = $4
         WHERE id = $1`,
        [row.id, attempts, msg.slice(0, 500), status]
      );
    }
  }
}

export function startTicketEventOutboxWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const intervalMs = Number(process.env.TICKETING_WEBHOOK_POLL_MS || 15000);
  setInterval(() => {
    void processOutboxBatch().catch((err) => {
      console.warn("ticket event outbox worker:", (err as Error).message);
    });
  }, intervalMs).unref?.();
}
