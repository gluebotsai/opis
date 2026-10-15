import { query } from "./db";
import { listAssignableAgents } from "./accountsSync";

const COWORKER_AGENTS_URL = (
  process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
).replace(/\/$/, "");

function tasksHeaders(): Record<string, string> {
  const secret =
    process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
  return {
    "Content-Type": "application/json",
    "X-Coworker-Tasks-Key": secret,
  };
}

/**
 * Recipients for Personalized Notifications Agent (bell inbox).
 * On ticket.created, include org admins so creators who are admins still see
 * the alert (Express assignment notify excludes the actor).
 */
export async function buildPnaNotifyPayload(opts: {
  organizationId: string;
  eventType: string;
  assigneeId?: string | null;
  resolverId?: string | null;
  actorId?: string | null;
  subject?: string | null;
  customerName?: string | null;
  ticketNumber?: string | null;
  extra?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const ids: string[] = [];
  const assignee = String(opts.assigneeId || "").trim();
  const resolver = String(opts.resolverId || "").trim();
  if (assignee) ids.push(assignee);
  if (resolver) ids.push(resolver);

  if (opts.eventType === "ticket.created") {
    try {
      const roster = await listAssignableAgents(opts.organizationId);
      for (const user of roster) {
        if (String(user.role || "").toLowerCase() === "admin" && user.id) {
          ids.push(String(user.id));
        }
      }
    } catch (err) {
      console.warn("pna admin recipients skipped:", (err as Error).message);
    }
  }

  const notifyUserIds = [...new Set(ids.filter(Boolean))];
  return {
    ticket_number: opts.ticketNumber || undefined,
    subject: opts.subject || undefined,
    customer_name: opts.customerName || undefined,
    assignee_id: assignee || undefined,
    resolver_id: resolver || undefined,
    actor_id: opts.actorId ? String(opts.actorId) : undefined,
    notify_user_id: notifyUserIds[0],
    notify_user_ids: notifyUserIds,
    ...(opts.extra || {}),
  };
}

const DSSA_CONFIDENCE_THRESHOLD = 0.75;

export type InboundDssaResult = {
  deflected: boolean;
  reply?: string;
  recommendationId?: string;
  confidence?: number;
};

/** Sync DSSA check before ticket create (email, portal, or other inbound). */
export async function runInboundDssaCheck(opts: {
  organizationId: string;
  eventId: string;
  text: string;
  customerName?: string;
  customerEmail?: string;
  subject?: string;
  channel?: "email" | "portal" | string;
  history?: Array<{ role: string; text: string }>;
}): Promise<InboundDssaResult> {
  try {
    const channel = String(opts.channel || "email").trim() || "email";
    const payload: Record<string, unknown> = {
      text: opts.text,
      body: opts.text,
      subject: opts.subject,
      customerName: opts.customerName,
      customerEmail: opts.customerEmail,
      channel,
      skip_create: true,
      history: Array.isArray(opts.history) ? opts.history : undefined,
    };
    const resp = await fetch(`${COWORKER_AGENTS_URL}/proactive/event`, {
      method: "POST",
      headers: tasksHeaders(),
      body: JSON.stringify({
        id: opts.eventId,
        event_type: "inbound.message",
        organization_id: opts.organizationId,
        payload,
      }),
    });
    if (!resp.ok) return { deflected: false };
    const data = (await resp.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = Array.isArray(data.results) ? data.results : [];
    const dssa = results.find(
      (r) => r.agent_id === "dssa" && r.status === "recommendation"
    );
    if (!dssa) return { deflected: false };
    const confidence = Number(dssa.confidence ?? 0);
    const deflect = Boolean(dssa.deflect);
    const reply = String(dssa.summary || "").trim();
    if (
      !deflect ||
      confidence < DSSA_CONFIDENCE_THRESHOLD ||
      !reply
    ) {
      return { deflected: false, confidence };
    }
    return {
      deflected: true,
      reply,
      recommendationId: dssa.id ? String(dssa.id) : undefined,
      confidence,
    };
  } catch (err) {
    console.warn("inbound dssa check skipped:", (err as Error).message);
    return { deflected: false };
  }
}

export async function emitProactiveEvent(opts: {
  organizationId: string;
  eventType: string;
  ticketId?: string | null;
  ticketNumber?: string | null;
  actor?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const payload = opts.payload || {};
  let eventId: string | null = null;
  try {
    const inserted = await query<{ id: string }>(
      `INSERT INTO proactive_outbox
         (organization_id, event_type, ticket_id, ticket_number, actor, payload)
       VALUES ($1::bigint, $2, $3, $4, $5, $6::jsonb)
       RETURNING id::text AS id`,
      [
        opts.organizationId,
        opts.eventType,
        opts.ticketId || null,
        opts.ticketNumber || null,
        opts.actor || null,
        JSON.stringify(payload),
      ]
    );
    eventId = inserted.rows[0]?.id || null;
  } catch (err) {
    console.warn("proactive outbox insert skipped:", (err as Error).message);
  }

  try {
    await fetch(`${COWORKER_AGENTS_URL}/proactive/event`, {
      method: "POST",
      headers: tasksHeaders(),
      body: JSON.stringify({
        id: eventId,
        event_type: opts.eventType,
        organization_id: opts.organizationId,
        ticket_id: opts.ticketId || null,
        ticket_number: opts.ticketNumber || null,
        actor: opts.actor || null,
        payload,
      }),
    });
  } catch (err) {
    console.warn("proactive event notify skipped:", (err as Error).message);
  }
}

/**
 * Customer-authored reply on an existing ticket (portal note, email thread,
 * staff-app customer note). Fires ARA (+ CRDA/PNA) via customer.replied.
 */
export async function emitCustomerReplied(opts: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  text: string;
  actorId?: string | null;
  customerName?: string | null;
  assigneeId?: string | null;
  resolverId?: string | null;
  subject?: string | null;
  status?: string | null;
  channel?: string;
}): Promise<void> {
  const text = String(opts.text || "").trim().slice(0, 500);
  const ticketNumber = String(opts.ticketNumber || "").trim();
  if (!text || !opts.organizationId || !ticketNumber) return;

  const pnaPayload = await buildPnaNotifyPayload({
    organizationId: opts.organizationId,
    eventType: "customer.replied",
    assigneeId: opts.assigneeId || null,
    resolverId: opts.resolverId || null,
    actorId: opts.actorId || null,
    ticketNumber,
    customerName: opts.customerName || null,
    subject: opts.subject || null,
    extra: {
      text,
      visibility: "public",
      status: opts.status || undefined,
      subject: opts.subject || undefined,
      channel: opts.channel || undefined,
    },
  });
  void emitProactiveEvent({
    organizationId: opts.organizationId,
    eventType: "customer.replied",
    ticketId: opts.ticketId,
    ticketNumber,
    actor: opts.actorId || null,
    payload: pnaPayload,
  });
}

/**
 * Portal chat (and similar) — ARA only, so we do not spam CRDA drafts on every
 * help-desk chat turn. LLM decides needed + which ticket from conversation.
 * ticketNumber is optional; ARA resolves "that ticket" from history + catalog.
 */
export async function emitAraOnDemand(opts: {
  organizationId: string;
  text: string;
  history?: Array<{ role?: string; text?: string }>;
  customerTickets?: Array<{
    ticket_number?: string;
    status?: string;
    subject?: string;
  }>;
  ticketId?: string | null;
  ticketNumber?: string | null;
  actorId?: string | null;
  customerName?: string | null;
  assigneeId?: string | null;
  resolverId?: string | null;
  subject?: string | null;
  status?: string | null;
  channel?: string;
}): Promise<void> {
  const text = String(opts.text || "").trim().slice(0, 500);
  if (!text || !opts.organizationId) return;
  const ticketNumber = String(opts.ticketNumber || "").trim() || undefined;
  const history = Array.isArray(opts.history)
    ? opts.history
        .slice(-24)
        .map((t) => ({
          role: String(t?.role || "user"),
          text: String(t?.text || "").slice(0, 400),
        }))
        .filter((t) => t.text)
    : [];
  const customerTickets = Array.isArray(opts.customerTickets)
    ? opts.customerTickets.slice(0, 20)
    : [];

  const pnaPayload = await buildPnaNotifyPayload({
    organizationId: opts.organizationId,
    eventType: "on_demand.ara",
    assigneeId: opts.assigneeId || null,
    resolverId: opts.resolverId || null,
    actorId: opts.actorId || null,
    ticketNumber: ticketNumber || null,
    customerName: opts.customerName || null,
    subject: opts.subject || null,
    extra: {
      text,
      status: opts.status || undefined,
      subject: opts.subject || undefined,
      channel: opts.channel || "portal_chat",
      history,
      customer_tickets: customerTickets,
    },
  });
  void emitProactiveEvent({
    organizationId: opts.organizationId,
    eventType: "on_demand.ara",
    ticketId: opts.ticketId || null,
    ticketNumber: ticketNumber || null,
    actor: opts.actorId || null,
    payload: pnaPayload,
  });
}
