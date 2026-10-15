import { query } from "./db";
import { mapTicket } from "./mappers";
import { createTicketFromIntake } from "./intake";
import { findActiveCustomer } from "./customersDirectory";
import type { PortalCustomer } from "./portalAuth";
import { isTerminalOrgStatus } from "./statuses";
import {
  emitCustomerReplied,
} from "./proactiveOutbox";

export async function listPortalTickets(customer: PortalCustomer) {
  const { rows } = await query(
    `SELECT * FROM tickets
     WHERE organization_id = $1
       AND (
         customer_id = $2::bigint
         OR lower(customer_email) = lower($3)
       )
     ORDER BY created_at DESC`,
    [customer.organizationId, customer.id, customer.email || "__none__"]
  );
  return rows.map((r) => mapTicket(r));
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
         customer_id = $3::bigint
         OR lower(customer_email) = lower($4)
       )
     LIMIT 1`,
    [customer.organizationId, num, customer.id, customer.email || "__none__"]
  );
  if (!rows[0]) return null;
  const ticketRow = rows[0];
  const ticket = mapTicket(ticketRow);
  const notes = await query(
    `SELECT id, author_name, body, created_at, visibility
     FROM ticket_notes
     WHERE organization_id = $1 AND ticket_id = $2
       AND COALESCE(visibility, 'internal') = 'public'
     ORDER BY created_at ASC`,
    [customer.organizationId, ticketRow.id]
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
        to === "Pending"
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

  if (showReopenPath && status === "Resolved") {
    steps = [
      { key: "Open", label: "Submitted", state: "done" },
      { key: "Reopened", label: "Reopened", state: "done" },
      { key: "Resolved", label: "Resolved", state: "done" },
    ];
  } else if (showReopenPath) {
    // Submitted → Resolved (past) → Reopened (current working again)
    const currentIdx =
      status === "Reopened" || status === "Pending" || status === "Overdue"
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
    const stepIndex = status === "Resolved" ? 2 : status === "Open" ? 0 : 1;
    const defs = [
      { key: "Open", label: "Submitted" },
      { key: "Pending", label: "In progress" },
      { key: "Resolved", label: "Resolved" },
    ];
    steps = defs.map((step, index) => ({
      ...step,
      state:
        status === "Resolved" || index < stepIndex
          ? ("done" as const)
          : index === stepIndex
            ? ("current" as const)
            : ("upcoming" as const),
    }));
  }

  return {
    ticket,
    uuid: String(ticketRow.id),
    rateCsatEligible:
      (await isTerminalOrgStatus(
        customer.organizationId,
        String(ticketRow.status || "")
      )) &&
      (ticketRow.csat_score == null || ticketRow.csat_score === ""),
    notes: notes.rows.map((n) => ({
      id: String(n.id),
      author: String(n.author_name),
      text: String(n.body),
      time: iso(n.created_at),
      visibility: "public",
    })),
    progress: {
      currentStatus: status,
      steps,
      history: progressEvents,
    },
  };
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
  const ins = await query(
    `INSERT INTO ticket_notes (
       organization_id, ticket_id, author_id, author_name, body, visibility
     ) VALUES ($1,$2,NULL,$3,$4,'public')
     RETURNING id, author_name, body, created_at, visibility`,
    [customer.organizationId, found.uuid, customer.name, text]
  );
  const row = ins.rows[0];
  await query(`UPDATE tickets SET updated_at = NOW() WHERE id = $1`, [found.uuid]);

  // Same customer.replied path as email / staff customer notes → ARA close/reopen.
  const ticket = found.ticket;
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
  | { ok: true; ticket: ReturnType<typeof mapTicket> }
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

  if (!(await isTerminalOrgStatus(orgId, String(row.status)))) {
    return {
      ok: false,
      error: "CSAT is only available on resolved tickets.",
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

  // Keep a public note so the review is visible in the conversation thread.
  await query(
    `INSERT INTO ticket_notes (
       organization_id, ticket_id, author_id, author_name, body, visibility
     ) VALUES ($1, $2, NULL, $3, $4, 'public')`,
    [
      orgId,
      found.uuid,
      customer.name || "Customer",
      `CSAT ${score}/5 — ${comment}`,
    ]
  );

  return { ok: true, ticket: mapTicket(updated.rows[0]) };
}
