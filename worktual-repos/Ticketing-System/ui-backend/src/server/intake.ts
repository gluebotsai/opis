/**
 * Public multi-channel ticket intake (B2B integrations).
 * Auth: org API key → organization_id. All channels map into one create path.
 */
import { query } from "./db";
import { computeDueAt } from "./sla";
import { statusFromAssignment } from "./statuses";
import { writeAuditEvent } from "./audit";
import { runTicketCreatedNotifyAndMail } from "./ticketCreatedSideEffects";
import { resolveTicketingTeam } from "./ticketingTeams";
import { nextTicketNumber } from "./ticketNumbers";
import type { Priority } from "../types";
import { runAutomations } from "./automation";
import { listAssignableAgents } from "./accountsSync";
import {
  findActiveCustomer,
  incrementCustomerTickets,
  requireExistingCustomer,
  CustomerDirectoryError,
} from "./customersDirectory";
import { mapTicket } from "./mappers";

const INTAKE_CHANNELS = new Set([
  "email",
  "web_form",
  "chat",
  "api",
  "phone",
  "whatsapp",
  "call",
  "ivr",
  "web",
]);
export const CANONICAL_INTAKE_TASK = Object.freeze({
  taskId: "ticket.create",
  taskVersion: "1.0.0",
  domain: "intake_deflection_domain",
  executor: "ticket_creation_executor",
  skill: "ticket-create",
  skillVersion: "1.0.0",
});

export function mapIntakeChannel(
  raw: string
): "Email" | "Chat" | "Phone" | "Web" {
  const c = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (c === "email") return "Email";
  if (c === "chat" || c === "whatsapp") return "Chat";
  if (c === "phone" || c === "call" || c === "ivr") return "Phone";
  return "Web";
}

function normalizePriority(raw: unknown): Priority {
  const p = String(raw || "medium")
    .trim()
    .toLowerCase();
  if (p === "urgent" || p === "high" || p === "medium" || p === "low") {
    return p;
  }
  if (p === "critical") return "urgent";
  return "medium";
}

export type IntakeTicketInput = {
  organizationId: string;
  channel: string;
  requester: { name?: string; email?: string; phone?: string };
  subject?: string;
  description?: string;
  priority?: string;
  category?: string;
  accountId?: string;
  externalRef?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  actorRole?: string;
  actorName?: string;
  apiKeyId?: string;
  /** When true, caller already ran DSSA (e.g. email intake after deflection check). */
  skipDssa?: boolean;
  /** Explicit customer request to file after self-service failed. */
  forceCreate?: boolean;
};

export type IntakeTicketResult = {
  ticketId: string;
  ticketNumber: string;
  status: string;
  channel: string;
  subject: string;
  assignee?: string;
  assigneeId?: string | null;
  resolver?: string | null;
  resolverId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export class DssaDeflectionError extends Error {
  status = 409;
  deflected = true as const;
  reply: string;
  agent = "dssa" as const;
  confidence?: number;

  constructor(reply: string, confidence?: number) {
    super(reply);
    this.name = "DssaDeflectionError";
    this.reply = reply;
    this.confidence = confidence;
  }
}

async function findIdempotentTicket(
  organizationId: string,
  idempotencyKey: string
): Promise<IntakeTicketResult | null> {
  if (!idempotencyKey) return null;
  const { rows } = await query(
    `SELECT * FROM tickets
     WHERE organization_id = $1 AND idempotency_key = $2
     LIMIT 1`,
    [organizationId, idempotencyKey]
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ticketId: String(row.id),
    ticketNumber: String(row.ticket_number),
    status: String(row.status || "Open"),
    channel: String(row.channel || "Web"),
    subject: String(row.subject || ""),
    assignee: String(row.assignee_name || "Unassigned"),
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    resolver: row.resolver_name ? String(row.resolver_name) : null,
    resolverId: row.resolver_id ? String(row.resolver_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function createTicketFromIntake(
  input: IntakeTicketInput
): Promise<IntakeTicketResult> {
  const orgId = String(input.organizationId || "").trim();
  if (!orgId) {
    const err = new Error("organizationId is required");
    (err as { status?: number }).status = 400;
    throw err;
  }
  const idempotencyKey = String(
    input.idempotencyKey || input.externalRef || ""
  ).trim();
  const existing = await findIdempotentTicket(orgId, idempotencyKey);
  if (existing) return existing;

  const channelIn = String(input.channel || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (!channelIn || !INTAKE_CHANNELS.has(channelIn)) {
    const err = new Error(
      "channel is required (email | web_form | chat | api | phone)"
    );
    (err as { status?: number }).status = 400;
    throw err;
  }

  const name = String(input.requester?.name || "").trim();
  const emailRaw = String(input.requester?.email || "").trim();
  const phone = String(input.requester?.phone || "").trim();
  if (!name) {
    const err = new Error("requester.name is required");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (!emailRaw && !phone) {
    const err = new Error("requester.email or requester.phone is required");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const resolvedEmail =
    emailRaw ||
    `phone+${phone.replace(/[^\d+]/g, "") || "unknown"}@placeholder.local`;

  let subjectVal = String(input.subject || "").trim();
  let descriptionVal = String(input.description || "").trim();
  let prio = normalizePriority(input.priority);
  let categoryVal = String(input.category || "").trim();
  let skillVal = "";
  let queueName = "";
  let assigneeName = "Unassigned";
  let assigneeId: string | null = null;
  let resolverName: string | null = null;
  let resolverId: string | null = null;
  const channelVal = mapIntakeChannel(channelIn);

  // DSSA gate: LLM reads published KB before any customer-channel ticket create.
  // Staff UI create uses a different Express path and is not gated here.
  if (!input.skipDssa && !input.forceCreate) {
    const issueText = [subjectVal, descriptionVal].filter(Boolean).join("\n\n").trim();
    if (issueText) {
      const { runInboundDssaCheck } = await import("./proactiveOutbox");
      const dssa = await runInboundDssaCheck({
        organizationId: orgId,
        eventId: String(Date.now()),
        text: issueText,
        customerName: name,
        customerEmail: emailRaw || undefined,
        subject: subjectVal || undefined,
        channel: channelIn === "email" ? "email" : channelIn === "web" ? "portal" : channelIn,
      });
      if (dssa.deflected && dssa.reply) {
        throw new DssaDeflectionError(dssa.reply, dssa.confidence);
      }
    }
  }

  const metaBits: string[] = [];
  if (input.accountId) metaBits.push(`accountId=${input.accountId}`);
  if (input.externalRef) metaBits.push(`externalRef=${input.externalRef}`);
  if (input.metadata && Object.keys(input.metadata).length) {
    metaBits.push(`metadata=${JSON.stringify(input.metadata)}`);
  }
  if (metaBits.length) {
    descriptionVal = `${descriptionVal || "No description provided."}\n\n---\nIntake: ${metaBits.join("; ")}`;
  }

  // Lean INSERT: store raw issue; post-insert triage Domain enriches
  // subject/description/priority/category/queue then assigns L1/L2.
  const issueText =
    descriptionVal || subjectVal || `Support request for ${name}`;
  descriptionVal = descriptionVal || issueText;
  if (!subjectVal) {
    subjectVal =
      issueText.length <= 80
        ? issueText
        : `${issueText.slice(0, 77).replace(/\s+\S*$/, "").trimEnd()}…`;
    if (!subjectVal || subjectVal === "…") {
      subjectVal = issueText.slice(0, 80);
    }
  }
  if (!input.priority) prio = "medium";
  // Leave queue / assignee / resolver / category for Domain→Executor.

  const dueAt = await computeDueAt(orgId, prio);

  let queueId: string | null = null;
  if (queueName) {
    const team = await resolveTicketingTeam(orgId, queueName);
    if (team) {
      queueId = team.id;
      queueName = team.name;
    } else {
      queueName = "";
      queueId = null;
    }
  }

  if (assigneeName !== "Unassigned") {
    const roster = await listAssignableAgents(orgId);
    const assignee =
      (assigneeId ? roster.find((user) => user.id === assigneeId) : null) ||
      roster.find(
        (user) => user.name.toLowerCase() === assigneeName.toLowerCase()
      );
    assigneeId = assignee?.id || null;
    if (assignee) assigneeName = assignee.name;
  } else {
    assigneeId = null;
  }

  if (resolverName) {
    const roster = await listAssignableAgents(orgId);
    const resolver =
      (resolverId
        ? roster.find(
            (user) => user.id === resolverId && user.role === "resolver"
          )
        : null) ||
      roster.find(
        (user) =>
          user.role === "resolver" &&
          user.name.toLowerCase() === resolverName!.toLowerCase()
      );
    resolverId = resolver?.id || null;
    resolverName = resolver?.name || null;
  } else {
    resolverId = null;
    resolverName = null;
  }

  const directoryCustomer = await requireExistingCustomer({
    organizationId: orgId,
    email: emailRaw || undefined,
    phone: phone || undefined,
  });
  const customerId = directoryCustomer.id;
  const requesterName = directoryCustomer.name || name;
  const requesterEmail = directoryCustomer.email || resolvedEmail;
  const requesterPhone = directoryCustomer.phone || phone || "";

  const actorName = input.actorName || "Intake API";
  const createStatus = statusFromAssignment({
    assigneeId,
    assigneeName,
    resolverId,
  });
  let ticketNumber = "";
  let insert: { rows: Record<string, unknown>[] } | null = null;
  let lastInsertErr: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    ticketNumber = await nextTicketNumber(orgId);
    try {
      insert = await query(
        `INSERT INTO tickets (
           organization_id, ticket_number, subject, description,
           customer_id, customer_name, customer_email, customer_phone,
           channel, assignee_id, assignee_name, resolver_id, resolver_name,
           queue_id, queue_name, priority, status,
           attachments, due_at, category, skill, created_by_id, created_by_name,
           idempotency_key
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
         ) RETURNING *`,
        [
          orgId,
          ticketNumber,
          subjectVal,
          descriptionVal || "No description provided.",
          customerId,
          requesterName,
          requesterEmail,
          requesterPhone,
          channelVal,
          assigneeId,
          assigneeName,
          resolverId,
          resolverName,
          queueId,
          queueName,
          prio,
          createStatus,
          [],
          dueAt,
          categoryVal || null,
          skillVal || null,
          null,
          actorName,
          idempotencyKey || null,
        ]
      );
      lastInsertErr = null;
      break;
    } catch (err) {
      lastInsertErr = err;
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        const duplicate = await findIdempotentTicket(orgId, idempotencyKey);
        if (duplicate) return duplicate;
        continue;
      }
      throw err;
    }
  }
  if (!insert?.rows[0]) {
    throw lastInsertErr || new Error("Failed to allocate unique ticket number");
  }

  const created = insert.rows[0];
  const ticketId = String(created.id);
  await incrementCustomerTickets(customerId);

  await query(
    `INSERT INTO activity_logs (organization_id, ticket_id, text)
     VALUES ($1, $2, $3)`,
    [
      orgId,
      ticketId,
      `New Ticket ${ticketNumber} created via intake (${channelIn}) by ${requesterName}`,
    ]
  );

  await writeAuditEvent({
    organizationId: orgId,
    actorId: null,
    actorName,
    action: "ticket.created",
    ticketId,
    ticketNumber,
    meta: {
      subject: subjectVal,
      channel: channelVal,
      intakeChannel: channelIn,
      assignee: assigneeName,
      resolver: resolverName,
      queue: queueName,
      externalRef: input.externalRef || null,
      apiKeyId: input.apiKeyId || null,
      source: "intake",
      harness: CANONICAL_INTAKE_TASK,
      idempotencyKey: idempotencyKey || null,
    },
  });

  await runTicketCreatedNotifyAndMail({
    organizationId: orgId,
    ticketId,
    ticketNumber,
    subject: subjectVal,
    customerName: requesterName,
    customerEmail: requesterEmail,
    assigneeId,
    assigneeName,
    resolverId,
    resolverName,
  });

  await runAutomations({
    organizationId: orgId,
    event: "ticket.created",
    ticketId,
    ticketNumber,
  }).catch((e) =>
    console.warn("automation (created) failed:", (e as Error).message)
  );

  try {
    const { emitProactiveEvent, buildPnaNotifyPayload } = await import(
      "./proactiveOutbox"
    );
    const pnaPayload = await buildPnaNotifyPayload({
      organizationId: orgId,
      eventType: "ticket.created",
      assigneeId:
        assigneeId && assigneeName !== "Unassigned" ? String(assigneeId) : null,
      resolverId: resolverId ? String(resolverId) : null,
      subject: subjectVal,
      customerName: requesterName,
      ticketNumber,
      extra: {
        channel: channelVal,
        source: "intake",
      },
    });
    void emitProactiveEvent({
      organizationId: orgId,
      eventType: "ticket.created",
      ticketId,
      ticketNumber,
      actor:
        input.actorId ||
        (input.apiKeyId ? `api-key:${input.apiKeyId}` : null),
      payload: {
        ...pnaPayload,
        actor_id:
          input.actorId ||
          (input.apiKeyId ? `api-key:${input.apiKeyId}` : null),
        actor_role: input.actorRole || (input.apiKeyId ? "service" : null),
        actor_name: input.actorName || null,
        ticket_number: ticketNumber,
        subject: subjectVal,
        description: String(descriptionVal || subjectVal || ""),
        status: String(created.status || "Open"),
        priority: prio,
        category: categoryVal || null,
        queue: queueName || null,
        assignee: assigneeName || null,
        triage_complete: false,
        harness_triage_complete: false,
        created_by_role: "customer",
        domain_triage_owned: true,
        harness: CANONICAL_INTAKE_TASK,
      },
    });
  } catch (e) {
    console.warn("intake proactive emit skipped:", (e as Error).message);
  }

  return {
    ticketId,
    ticketNumber,
    status: String(created.status || "Open"),
    channel: channelVal,
    subject: subjectVal,
    assignee: assigneeName,
    assigneeId: assigneeId,
    resolver: resolverName,
    resolverId: resolverId,
    createdAt: String(created.created_at),
    updatedAt: String(created.updated_at),
  };
}

/**
 * Webchat / CCaaS: list tickets for an existing customer matched by email or phone.
 * Does not create customers — missing directory match fails.
 */
export async function listTicketsByContact(input: {
  organizationId: string;
  email?: string;
  phone?: string;
}) {
  const orgId = String(input.organizationId || "").trim();
  const email = String(input.email || "").trim();
  const phone = String(input.phone || "").trim();
  if (!orgId) {
    const err = new Error("organizationId is required");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (!email && !phone) {
    const err = new Error("email or phone is required");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const customer = await findActiveCustomer({
    organizationId: orgId,
    email: email || undefined,
    phone: phone || undefined,
  });
  if (!customer) {
    throw new CustomerDirectoryError(
      "there is no account for this customer",
      404
    );
  }

  const { rows } = await query(
    `SELECT * FROM tickets
     WHERE organization_id = $1
       AND (
         customer_id = $2::bigint
         OR ($3 <> '' AND lower(customer_email) = lower($3))
         OR (
           $4 <> ''
           AND customer_phone IS NOT NULL AND btrim(customer_phone) <> ''
           AND (
             regexp_replace(customer_phone, '[^0-9]', '', 'g') = $4
             OR (
               length(regexp_replace(customer_phone, '[^0-9]', '', 'g')) >= 10
               AND length($4) >= 10
               AND right(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 10) = right($4, 10)
             )
           )
         )
       )
     ORDER BY created_at DESC`,
    [
      orgId,
      customer.id,
      customer.email || email || "",
      String(phone || customer.phone || "").replace(/\D/g, ""),
    ]
  );

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
    tickets: rows.map((r) => mapTicket(r)),
  };
}

/**
 * Webchat / CCaaS: verify org has Ticketing and customer exists (Active).
 * Does not list tickets or create anything.
 */
export async function verifyWebchatCustomer(input: {
  organizationId: string;
  email?: string;
  phone?: string;
}) {
  const orgId = String(input.organizationId || "").trim();
  const email = String(input.email || "").trim();
  const phone = String(input.phone || "").trim();
  if (!orgId) {
    const err = new Error("organizationId is required");
    (err as { status?: number }).status = 400;
    throw err;
  }
  if (!email && !phone) {
    const err = new Error("email or mobile number is required");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const customer = await requireExistingCustomer({
    organizationId: orgId,
    email: email || undefined,
    phone: phone || undefined,
  });

  return {
    organizationId: orgId,
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
  };
}
