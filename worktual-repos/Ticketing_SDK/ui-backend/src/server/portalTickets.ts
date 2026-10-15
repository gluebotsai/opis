import { query } from "./db";
import { mapOneTicket, mapTicketRows } from "./mappers";
import type { Ticket } from "../types";
import { createTicketFromIntake } from "./intake";
import {
  insertPortalConversationMessages,
  listPortalConversationMessages,
} from "./portalConversation";
import { findActiveCustomer } from "./customersDirectory";
import type { PortalCustomer } from "./portalAuth";
import {
  customerLifecycleNextStatus,
  isActiveOrgStatus,
  isClosedStatusKey,
  isWorkFinishedOrgStatus,
  resolveOrgStatusKey,
  statusMailDisplayName,
} from "./statuses";
import { queueCustomerStatusChangeEmail } from "./customerMail";
import { writeAuditEvent } from "./audit";
import {
  buildReopenAlertCopy,
  emitCriticalAlert,
} from "./criticalAlerts";
import {
  buildTicketOpsNotice,
  notifyCustomerInboundReply,
  notifyTicketWatchers,
} from "./notifications";
import { runSlaSweep } from "./slaSweep";
import {
  emitCustomerReplied,
  emitCsatForAra,
} from "./proactiveOutbox";

export async function listPortalTickets(customer: PortalCustomer) {
  const { rows } = await query(
    `SELECT * FROM tickets
     WHERE organization_id = $1
       AND (
         ($2 ~ '^[0-9]+$' AND customer_id = $2::bigint)
         OR lower(customer_email) = lower($3)
       )
     ORDER BY created_at DESC`,
    [customer.organizationId, String(customer.id || ""), customer.email || "__none__"]
  );
  return mapTicketRows(customer.organizationId, rows);
}

export async function getPortalTicket(
  customer: PortalCustomer,
  ticketNumber: string
) {
  const num = String(ticketNumber || "").trim();
  const { rows } = await query(
    `SELECT * FROM tickets
     WHERE organization_id = $1
       AND ticket_number = $2
       AND (
         ($3 ~ '^[0-9]+$' AND customer_id = $3::bigint)
         OR lower(customer_email) = lower($4)
       )
     LIMIT 1`,
    [customer.organizationId, num, String(customer.id || ""), customer.email || "__none__"]
  );
  if (!rows[0]) return null;
  const ticketRow = rows[0];
  const ticket = await mapOneTicket(customer.organizationId, ticketRow);
  const notes = await query(
    `SELECT id, author_name, body, created_at, visibility
     FROM ticket_notes
     WHERE organization_id = $1 AND ticket_id = $2
       AND COALESCE(visibility, 'internal') = 'public'
       AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [customer.organizationId, ticketRow.id]
  );
  const portalMessages = await listPortalConversationMessages(
    customer.organizationId,
    String(ticketRow.id)
  );
  const audit = await query(
    `SELECT id, action, actor_name, meta, created_at
     FROM ticketing.audit_events
     WHERE organization_id = $1
       AND (ticket_id = $2::bigint OR ticket_number = $3)
       AND action IN (
         'ticket.created',
         'ticket.status_changed',
         'ticket.assigned',
         'ticket.escalated'
       )
     ORDER BY created_at ASC
     LIMIT 100`,
    [customer.organizationId, ticketRow.id, num]
  );

  type ProgressEvent = {
    id: string;
    at: string;
    label: string;
    actor: string | null;
    kind: "created" | "status" | "assigned" | "escalated" | "reply";
  };
  const progressEvents: ProgressEvent[] = [];
  const iso = (value: unknown) =>
    value instanceof Date ? value.toISOString() : String(value || "");
  const pushProgress = (
    id: string,
    at: unknown,
    label: string,
    actor: string | null,
    kind: ProgressEvent["kind"]
  ) => {
    progressEvents.push({ id, at: iso(at), label, actor, kind });
  };

  if (!audit.rows.some((r) => String(r.action) === "ticket.created")) {
    pushProgress(
      `created-${ticketRow.id}`,
      ticketRow.created_at,
      "Ticket submitted",
      null,
      "created"
    );
  }
  for (const row of audit.rows) {
    const action = String(row.action || "");
    const meta =
      row.meta && typeof row.meta === "object"
        ? (row.meta as Record<string, unknown>)
        : {};
    const actor = row.actor_name ? String(row.actor_name) : null;
    if (action === "ticket.created") {
      pushProgress(String(row.id), row.created_at, "Ticket submitted", actor, "created");
    } else if (action === "ticket.status_changed") {
      const to = String(meta.to || "").trim();
      const label =
        to === "Pending" || to === "In Progress"
          ? "Work in progress"
          : to === "Resolved"
            ? "Ticket resolved"
            : to === "Reopened" || to === "Open"
              ? "Ticket reopened"
              : to === "Overdue"
                ? "Ticket marked overdue"
                : `Status changed to ${to || "updated"}`;
      pushProgress(String(row.id), row.created_at, label, actor, "status");
    } else if (action === "ticket.assigned") {
      const to = String(meta.to || ticketRow.assignee_name || "support team");
      pushProgress(String(row.id), row.created_at, `Assigned to ${to}`, actor, "assigned");
    } else if (action === "ticket.escalated") {
      const to = String(meta.to || "resolver");
      pushProgress(String(row.id), row.created_at, `Escalated to ${to}`, actor, "escalated");
    }
  }
  for (const row of notes.rows) {
    pushProgress(
      `reply-${row.id}`,
      row.created_at,
      "Public reply added",
      row.author_name ? String(row.author_name) : null,
      "reply"
    );
  }
  progressEvents.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const status = String(ticketRow.status || "Open");
  const hasReopenedEvent = progressEvents.some(
    (e) => e.kind === "status" && /reopened/i.test(e.label)
  );
  const showReopenPath = status === "Reopened" || hasReopenedEvent;

  type StepState = "done" | "current" | "upcoming";
  let steps: Array<{ key: string; label: string; state: StepState }>;

  if (showReopenPath && (status === "Resolved" || status === "Closed")) {
    steps = [
      { key: "Open", label: "Submitted", state: "done" },
      { key: "Reopened", label: "Reopened", state: "done" },
      { key: "Resolved", label: "Resolved", state: "done" },
      {
        key: "Closed",
        label: "Closed",
        state: status === "Closed" ? "done" : "upcoming",
      },
    ];
  } else if (showReopenPath) {
    // Submitted → Resolved (past) → Reopened (current working again)
    const currentIdx =
      status === "Reopened" ||
      status === "Pending" ||
      status === "In Progress" ||
      status === "Overdue"
        ? 2
        : 0;
    const defs = [
      { key: "Open", label: "Submitted" },
      { key: "Resolved", label: "Resolved" },
      { key: "Reopened", label: "Reopened" },
    ];
    steps = defs.map((step, index) => ({
      ...step,
      state:
        index < currentIdx
          ? ("done" as const)
          : index === currentIdx
            ? ("current" as const)
            : ("upcoming" as const),
    }));
  } else {
    const stepIndex =
      status === "Closed" ? 3 : status === "Resolved" ? 2 : status === "Open" ? 0 : 1;
    const defs = [
      { key: "Open", label: "Submitted" },
      { key: "Pending", label: "In progress" },
      { key: "Resolved", label: "Resolved" },
      { key: "Closed", label: "Closed" },
    ];
    steps = defs.map((step, index) => {
      let state: StepState = "upcoming";
      if (status === "Closed") state = "done";
      else if (status === "Resolved") {
        // Staff finished this step — show a tick, not an in-progress dot.
        state = index <= 2 ? "done" : "upcoming";
      } else if (index < stepIndex) state = "done";
      else if (index === stepIndex) state = "current";
      return { ...step, state };
    });
  }

  return {
    ticket,
    uuid: String(ticketRow.id),
    rateCsatEligible:
      (await isWorkFinishedOrgStatus(
        customer.organizationId,
        String(ticketRow.status || "")
      )) &&
      (ticketRow.csat_score == null || ticketRow.csat_score === ""),
    notes: [
      ...notes.rows.map((n) => ({
        id: String(n.id),
        author: String(n.author_name),
        text: String(n.body),
        time: iso(n.created_at),
        visibility: "public" as const,
      })),
      ...portalMessages.map((n) => ({
        id: `portal-${n.id}`,
        author: n.author_name,
        text: n.body,
        time: iso(n.created_at),
        visibility: "public" as const,
      })),
    ].sort((a, b) => a.time.localeCompare(b.time)),
    progress: {
      currentStatus: status,
      steps,
      history: progressEvents,
    },
  };
}

export async function updateOwnedTicketStatus(
  owner: {
    organizationId: string;
    id: string;
    email?: string | null;
    name?: string | null;
  },
  ticketNumber: string,
  requestedStatus: string
): Promise<
  | { ok: true; ticket: Ticket }
  | { ok: false; error: string; status: number }
> {
  const orgId = String(owner.organizationId || "").trim();
  const num = String(ticketNumber || "").trim();
  const wanted = String(requestedStatus || "").trim();
  if (!orgId || !num || !wanted) {
    return { ok: false, error: "Ticket and status are required.", status: 400 };
  }

  const { rows } = await query(
    `SELECT * FROM tickets
     WHERE organization_id = $1
       AND ticket_number = $2
       AND (
         ($3 ~ '^[0-9]+$' AND customer_id = $3::bigint)
         OR (
           $4 <> ''
           AND lower(customer_email) = lower($4)
         )
       )
     LIMIT 1`,
    [orgId, num, String(owner.id || ""), String(owner.email || "").trim()]
  );
  const old = rows[0];
  if (!old) {
    return { ok: false, error: "Ticket not found.", status: 404 };
  }

  const mapped = (await resolveOrgStatusKey(orgId, wanted)) || wanted;
  const lifecycle = customerLifecycleNextStatus(String(old.status), mapped);
  if (!lifecycle.ok) {
    return { ok: false, error: lifecycle.error, status: 400 };
  }
  if (!(await isActiveOrgStatus(orgId, lifecycle.next))) {
    return { ok: false, error: "Unknown or inactive status.", status: 400 };
  }
  const nextStatus =
    (await resolveOrgStatusKey(orgId, lifecycle.next)) || lifecycle.next;
  const closing = isClosedStatusKey(nextStatus);
  const reopening = nextStatus === "Reopened";

  const updated = await query(
    `UPDATE tickets SET
       status = $1,
       resolved_at = CASE
         WHEN $2::boolean THEN COALESCE(resolved_at, NOW())
         ELSE NULL
       END,
       updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [nextStatus, closing, old.id]
  );
  const row = updated.rows[0];
  const ticketId = String(old.id);
  await query(
    `INSERT INTO activity_logs (organization_id, ticket_id, text)
     VALUES ($1, $2, $3)`,
    [
      orgId,
      ticketId,
      `Ticket ${num} status changed to ${nextStatus}`,
    ]
  );
  const actorId = /^\d+$/.test(String(owner.id || "")) ? String(owner.id) : null;
  await writeAuditEvent({
    organizationId: orgId,
    actorId,
    actorName: String(owner.name || "Customer"),
    action: "ticket.status_changed",
    ticketId,
    ticketNumber: num,
    meta: {
      from: old.status,
      to: nextStatus,
      via: "customer",
    },
  });
  const statusCopy = buildTicketOpsNotice({
    ticketNumber: num,
    subject: row.subject ? String(row.subject) : null,
    actorName: String(owner.name || "Customer"),
    changes: [
      {
        field: "status",
        from: String(old.status || ""),
        to: String(nextStatus || ""),
      },
    ],
  });
  if (statusCopy) {
    await notifyTicketWatchers({
      orgId,
      assigneeId: row.assignee_id ? String(row.assignee_id) : null,
      assigneeName: row.assignee_name ? String(row.assignee_name) : null,
      resolverId: row.resolver_id ? String(row.resolver_id) : null,
      resolverName: row.resolver_name ? String(row.resolver_name) : null,
      title: statusCopy.title,
      message: statusCopy.message,
      ticketUuid: ticketId,
      customerName: row.customer_name ? String(row.customer_name) : null,
      excludeUserId: actorId,
    });
  }
  if (reopening) {
    const reopenCopy = buildReopenAlertCopy({
      ticketNumber: num,
      subject: row.subject ? String(row.subject) : null,
      actorName: String(owner.name || "Customer"),
      prevStatus: String(old.status || ""),
    });
    await emitCriticalAlert({
      scenario: "ticket_reopened",
      orgId,
      userIds: [
        row.assignee_id ? String(row.assignee_id) : "",
        row.resolver_id ? String(row.resolver_id) : "",
      ].filter(Boolean),
      title: reopenCopy.title,
      message: reopenCopy.message,
      ticketUuid: ticketId,
      ticketNumber: num,
      customerName: row.customer_name ? String(row.customer_name) : null,
      payload: {
        prevStatus: String(old.status || ""),
        newStatus: String(nextStatus || ""),
        actorName: String(owner.name || "Customer"),
        via: "portal",
      },
    });
  }
  queueCustomerStatusChangeEmail({
    organizationId: orgId,
    ticketId,
    ticketNumber: num,
    subject: String(row.subject || ""),
    customerName: String(row.customer_name || ""),
    customerEmail: row.customer_email ? String(row.customer_email) : "",
    status: String(nextStatus || ""),
    displayName: statusMailDisplayName(String(nextStatus || "")),
  });
  void runSlaSweep(orgId).catch((e) =>
    console.warn("sla sweep after customer status skipped:", (e as Error).message)
  );
  return { ok: true, ticket: await mapOneTicket(orgId, row) };
}

export function sanitizeTicketAttachments(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const text = String(item || "").trim();
    const prefix = "/uploads/";
    if (!text.startsWith(prefix)) continue;
    const name = text.slice(prefix.length);
    if (!name || name.includes("/") || name.includes("..") || name.includes("\\")) {
      continue;
    }
    const url = `${prefix}${name}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

export async function appendTicketAttachments(input: {
  organizationId: string;
  ticketNumber: string;
  urls: unknown;
  owner?: { id: string; email?: string | null };
}): Promise<
  | { ok: true; attachments: string[]; ticketId: string }
  | { ok: false; error: string; status: number }
> {
  const orgId = String(input.organizationId || "").trim();
  const num = String(input.ticketNumber || "").trim();
  const add = sanitizeTicketAttachments(input.urls);
  if (!orgId || !num) {
    return { ok: false, error: "Ticket is required.", status: 400 };
  }
  if (!add.length) {
    return { ok: false, error: "No valid uploaded files to attach.", status: 400 };
  }
  const owner = input.owner;
  const { rows } = await query(
    `SELECT id, attachments FROM tickets
     WHERE organization_id = $1
       AND ticket_number = $2
       AND (
         $3::text IS NULL
         OR (
           ($3 ~ '^[0-9]+$' AND customer_id = $3::bigint)
           OR lower(customer_email) = lower($4)
         )
       )`,
    [
      orgId,
      num,
      owner ? String(owner.id || "") : null,
      owner ? String(owner.email || "").toLowerCase() : "",
    ]
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, error: "Ticket not found.", status: 404 };
  }
  const current = Array.isArray(row.attachments)
    ? (row.attachments as string[]).map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const merged = [...current];
  for (const url of add) {
    if (!merged.includes(url)) merged.push(url);
  }
  await query(
    `UPDATE tickets SET attachments = $1::text[], updated_at = NOW()
     WHERE id = $2`,
    [merged, row.id]
  );
  return { ok: true, attachments: merged, ticketId: String(row.id) };
}

export async function replaceTicketAttachments(input: {
  organizationId: string;
  ticketNumber: string;
  urls: unknown;
}): Promise<
  | { ok: true; attachments: string[]; ticketId: string }
  | { ok: false; error: string; status: number }
> {
  const orgId = String(input.organizationId || "").trim();
  const num = String(input.ticketNumber || "").trim();
  const next = sanitizeTicketAttachments(input.urls);
  if (!orgId || !num) {
    return { ok: false, error: "Ticket is required.", status: 400 };
  }
  const { rows } = await query(
    `SELECT id FROM tickets
     WHERE organization_id = $1 AND ticket_number = $2`,
    [orgId, num]
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, error: "Ticket not found.", status: 404 };
  }
  await query(
    `UPDATE tickets SET attachments = $1::text[], updated_at = NOW()
     WHERE id = $2`,
    [next, row.id]
  );
  return { ok: true, attachments: next, ticketId: String(row.id) };
}

export async function createPortalTicket(
  customer: PortalCustomer,
  input: {
    subject?: string;
    description?: string;
    issue?: string;
    /** After KB guidance failed — customer explicitly wants a ticket. */
    forceCreate?: boolean;
    idempotencyKey?: string;
    attachments?: string[];
    orderId?: string;
    productId?: string;
    references?: Array<{ type: string; id: string }>;
  }
) {
  const full = await findActiveCustomer({
    organizationId: customer.organizationId,
    customerId: customer.id,
  });
  if (!full) {
    const err = new Error("Customer not found.");
    (err as { status?: number }).status = 404;
    throw err;
  }
  const issue = String(input.issue || input.description || "").trim();
  const subject = String(input.subject || "").trim();
  if (!issue && !subject) {
    const err = new Error("Describe the issue to file a ticket.");
    (err as { status?: number }).status = 400;
    throw err;
  }
  return createTicketFromIntake({
    organizationId: customer.organizationId,
    channel: "web",
    requester: {
      name: full.name,
      email: full.email || undefined,
      phone: full.phone || undefined,
    },
    subject: subject || undefined,
    description: issue || subject,
    actorId: customer.id,
    actorRole: "portal_customer",
    actorName: full.name,
    forceCreate: Boolean(input.forceCreate),
    idempotencyKey: input.idempotencyKey,
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    references: input.references,
    orderId: input.orderId,
    productId: input.productId,
  });
}

export async function addPortalPublicNote(
  customer: PortalCustomer,
  ticketNumber: string,
  body: string
) {
  const text = String(body || "").trim();
  if (!text) {
    const err = new Error("Note text is required.");
    (err as { status?: number }).status = 400;
    throw err;
  }
  const found = await getPortalTicket(customer, ticketNumber);
  if (!found) return null;
  await insertPortalConversationMessages({
    organizationId: customer.organizationId,
    ticketId: found.uuid,
    source: "portal_reply",
    messages: [{ authorName: customer.name, body: text, ageMs: 0 }],
  });
  const ins = await query(
    `SELECT id, author_name, body, created_at
       FROM ticketing.ticket_portal_messages
      WHERE organization_id = $1 AND ticket_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [customer.organizationId, found.uuid]
  );
  const row = ins.rows[0];
  if (!row) {
    const err = new Error("Failed to store portal reply.");
    (err as { status?: number }).status = 500;
    throw err;
  }
  await query(
    `UPDATE tickets
        SET updated_at = NOW(),
            last_customer_inbound_channel = 'support_portal',
            last_customer_inbound_at = NOW()
      WHERE id = $1`,
    [found.uuid]
  );

  // Same customer.replied path as email / staff customer notes → ARA close/reopen.
  const ticket = found.ticket;
  await notifyCustomerInboundReply({
    orgId: customer.organizationId,
    source: "support_portal",
    ticketNumber: String(ticket.id),
    ticketUuid: found.uuid,
    fromName: customer.name,
    preview: text,
    assigneeId: ticket.assigneeId || null,
    assigneeName: ticket.assignee || null,
    resolverId: ticket.resolverId || null,
    resolverName: ticket.resolver || null,
  });
  void emitCustomerReplied({
    organizationId: customer.organizationId,
    ticketId: found.uuid,
    ticketNumber: String(ticket.id),
    text,
    actorId: customer.id,
    customerName: customer.name,
    assigneeId: ticket.assigneeId || null,
    resolverId: ticket.resolverId || null,
    subject: ticket.subject || null,
    status: ticket.status || null,
    channel: "support_portal",
  });

  return {
    id: String(row.id),
    author: String(row.author_name),
    text: String(row.body),
    time: row.created_at,
    visibility: "public",
  };
}

export async function submitPortalCsat(
  customer: PortalCustomer,
  ticketNumber: string,
  scoreRaw: unknown,
  commentRaw?: unknown
): Promise<
  | { ok: true; ticket: Ticket }
  | { ok: false; error: string; status: number }
> {
  const score = Number(scoreRaw);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return {
      ok: false,
      error: "CSAT score must be an integer from 1 to 5.",
      status: 400,
    };
  }

  const comment = String(commentRaw ?? "").trim().slice(0, 2000);
  if (comment.length < 3) {
    return {
      ok: false,
      error: "Please add a short comment about your experience.",
      status: 400,
    };
  }

  const found = await getPortalTicket(customer, ticketNumber);
  if (!found) {
    return { ok: false, error: "Ticket not found.", status: 404 };
  }

  const orgId = customer.organizationId;
  const { rows } = await query(
    `SELECT id, status, csat_score FROM tickets
     WHERE organization_id = $1 AND id = $2
     LIMIT 1`,
    [orgId, found.uuid]
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, error: "Ticket not found.", status: 404 };
  }

  if (!(await isWorkFinishedOrgStatus(orgId, String(row.status)))) {
    return {
      ok: false,
      error: "CSAT is only available after the ticket is resolved or closed.",
      status: 400,
    };
  }

  if (row.csat_score != null && row.csat_score !== "") {
    return {
      ok: false,
      error: "You have already rated this ticket.",
      status: 400,
    };
  }

  const updated = await query(
    `UPDATE tickets SET
       csat_score = $1,
       csat_comment = $2,
       csat_rated_at = NOW(),
       updated_at = NOW()
     WHERE id = $3 AND organization_id = $4
     RETURNING *`,
    [score, comment, found.uuid, orgId]
  );

  const ticketNum = String(found.ticket.id);
  await query(
    `INSERT INTO activity_logs (organization_id, ticket_id, text)
     VALUES ($1, $2, $3)`,
    [orgId, found.uuid, `Ticket ${ticketNum} rated CSAT ${score}/5`]
  );
  await writeAuditEvent({
    organizationId: orgId,
    actorId: /^\d+$/.test(String(customer.id || ""))
      ? String(customer.id)
      : null,
    actorName: String(customer.name || "Customer"),
    action: "ticket.rated",
    ticketId: found.uuid,
    ticketNumber: ticketNum,
    meta: {
      score,
      csatScore: score,
      via: "customer",
    },
  });

  // Keep a public note so the review is visible in the conversation thread.
  await insertPortalConversationMessages({
    organizationId: orgId,
    ticketId: found.uuid,
    source: "csat",
    messages: [
      {
        authorName: customer.name || "Customer",
        body: `CSAT ${score}/5 — ${comment}`,
        ageMs: 0,
      },
    ],
  });

  const saved = updated.rows[0];
  void emitCsatForAra({
    organizationId: orgId,
    score,
    comment,
    ticketId: found.uuid,
    ticketNumber: ticketNum,
    actorId: customer.id,
    customerName: customer.name,
    assigneeId: saved?.assignee_id ? String(saved.assignee_id) : found.ticket.assigneeId || null,
    resolverId: saved?.resolver_id ? String(saved.resolver_id) : found.ticket.resolverId || null,
    subject: saved?.subject ? String(saved.subject) : found.ticket.subject || null,
    status: saved?.status ? String(saved.status) : found.ticket.status || null,
  }).catch((e) =>
    console.warn("CSAT ARA emit skipped:", (e as Error).message)
  );

  return { ok: true, ticket: await mapOneTicket(customer.organizationId, saved) };
}
