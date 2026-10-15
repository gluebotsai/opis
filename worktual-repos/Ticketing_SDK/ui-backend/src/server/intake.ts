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
  findCdpCatalogProduct,
  findCustomerOrder,
  findInventoryProduct,
  incrementCustomerTickets,
  requireExistingCustomer,
  CustomerDirectoryError,
} from "./customersDirectory";
import { mapTicketRows } from "./mappers";

const INTAKE_CHANNELS = new Set([
  "email",
  "web_form",
  "webchat",
  "chat",
  "api",
  "phone",
  "whatsapp",
  "instagram",
  "facebook",
  "call",
  "ivr",
  "web",
]);

/** Stored ticket.channel for a create key. Legacy Chat rows stay Chat on read. */
const INTAKE_CHANNEL_STORE: Record<string, string> = {
  email: "Email",
  webchat: "Webchat",
  chat: "Webchat",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  phone: "Phone",
  call: "Phone",
  ivr: "Phone",
  web_form: "Web",
  web: "Web",
  api: "Web",
};

const STORED_CHANNEL_LABELS = new Set([
  "Email",
  "Chat",
  "Webchat",
  "WhatsApp",
  "Instagram",
  "Facebook",
  "Phone",
  "Web",
]);

export const CANONICAL_INTAKE_TASK = Object.freeze({
  taskId: "ticket.create",
  taskVersion: "1.0.0",
  domain: "intake_deflection_domain",
  executor: "ticket_creation_executor",
  skill: "ticket-create",
  skillVersion: "1.0.0",
});

function intakeChannelKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

export function isAllowedIntakeChannel(raw: string): boolean {
  const trimmed = String(raw || "").trim();
  if (STORED_CHANNEL_LABELS.has(trimmed)) return true;
  return INTAKE_CHANNELS.has(intakeChannelKey(trimmed));
}

export function mapIntakeChannel(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (STORED_CHANNEL_LABELS.has(trimmed)) return trimmed;
  const key = intakeChannelKey(trimmed);
  return INTAKE_CHANNEL_STORE[key] || "Web";
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
  /** Optional `/uploads/…` URLs already stored by the upload API. */
  attachments?: string[];
  /** Canonical business-entity refs. Legacy orderId/productId are merged into this list. */
  references?: TicketEntityRef[];
  /** @deprecated Prefer references[]. Normalized to type=order. */
  orderId?: string;
  /** @deprecated Prefer references[]. Normalized to type=product. */
  productId?: string;
};

export type TicketEntityRef = { type: string; id: string };

export type IntakeReferencePolicy = {
  allowedTypes: string[];
  requiredTypes: string[];
  productRequiresOrder: boolean;
};

const DEFAULT_INTAKE_REFERENCE_POLICY: IntakeReferencePolicy = {
  allowedTypes: ["order", "product"],
  requiredTypes: [],
  productRequiresOrder: false,
};

export function mergeIntakeReferencePolicy(raw: unknown): IntakeReferencePolicy {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const allowed = Array.isArray(src.allowedTypes)
    ? src.allowedTypes.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const required = Array.isArray(src.requiredTypes)
    ? src.requiredTypes.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)
    : [];
  return {
    allowedTypes: allowed.length ? allowed : [...DEFAULT_INTAKE_REFERENCE_POLICY.allowedTypes],
    requiredTypes: required,
    productRequiresOrder: Boolean(src.productRequiresOrder),
  };
}

export function derivedOrderProductFromRefs(refs: TicketEntityRef[]): {
  orderId: string | null;
  productId: string | null;
} {
  const order = refs.find((r) => r.type === "order");
  const product = refs.find((r) => r.type === "product");
  return {
    orderId: order?.id || null,
    productId: product?.id || null,
  };
}

function looksLikeRfcMessageId(raw: string): boolean {
  return raw.startsWith("<") && raw.includes("@");
}

export function normalizeIntakeReferences(
  body: Record<string, unknown> | null | undefined
): TicketEntityRef[] {
  const src = body && typeof body === "object" ? body : {};
  const out: TicketEntityRef[] = [];
  const seen = new Set<string>();
  const push = (typeRaw: unknown, idRaw: unknown) => {
    const type = String(typeRaw || "").trim().toLowerCase();
    const id = normalizeTicketOrderId(idRaw);
    if (!type || !id) return;
    const key = `${type}\0${id.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type, id });
  };
  const list = src.references;
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === "string") {
        if (looksLikeRfcMessageId(item.trim())) continue;
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      push(row.type ?? row.ref_type ?? row.refType, row.id ?? row.ref_id ?? row.refId);
    }
  }
  const picked = pickOptionalOrderProduct(src);
  if (picked.orderId) push("order", picked.orderId);
  if (picked.productId) push("product", picked.productId);
  return out;
}

export function assertIntakeReferencesPolicy(
  refs: TicketEntityRef[],
  policy: IntakeReferencePolicy
): void {
  const allowed = new Set(policy.allowedTypes);
  for (const ref of refs) {
    if (!allowed.has(ref.type)) {
      throw intakeClientError(
        `Reference type '${ref.type}' is not allowed for this organization`,
        400
      );
    }
  }
  for (const need of policy.requiredTypes) {
    if (!refs.some((r) => r.type === need)) {
      throw intakeClientError(
        `Reference type '${need}' is required for this organization`,
        400
      );
    }
  }
  if (policy.productRequiresOrder) {
    const hasProduct = refs.some((r) => r.type === "product");
    const hasOrder = refs.some((r) => r.type === "order");
    if (hasProduct && !hasOrder) {
      throw intakeClientError("order reference is required when product is set", 400);
    }
  }
}

async function loadOrgIntakeReferencePolicy(
  organizationId: string
): Promise<IntakeReferencePolicy> {
  const { rows } = await query<{ intake_reference_policy: unknown }>(
    `SELECT intake_reference_policy
       FROM org_settings
      WHERE organization_id = $1::bigint
      LIMIT 1`,
    [organizationId]
  );
  return mergeIntakeReferencePolicy(rows[0]?.intake_reference_policy);
}

function productMatchesOrderLine(
  productRaw: string,
  items: Array<{ productId: string; sku: string }>
): string | null {
  const match = items.find(
    (item) =>
      item.productId === productRaw ||
      (item.sku && item.sku.toLowerCase() === productRaw.toLowerCase())
  );
  return match?.productId || null;
}

export async function validateIntakeReferences(input: {
  organizationId: string;
  customerId: string;
  refs: TicketEntityRef[];
}): Promise<TicketEntityRef[]> {
  const refs = input.refs;
  if (!refs.length) return [];
  const policy = await loadOrgIntakeReferencePolicy(input.organizationId);
  assertIntakeReferencesPolicy(refs, policy);

  const customerId = String(input.customerId || "").trim();
  const orderHits = new Map<string, Awaited<ReturnType<typeof findCustomerOrder>>>();
  const resolved: TicketEntityRef[] = [];
  const orderRefs = refs.filter((r) => r.type === "order");
  const otherRefs = refs.filter((r) => r.type !== "order");

  for (const ref of orderRefs) {
    const hit = await findCustomerOrder({
      organizationId: input.organizationId,
      customerId,
      orderId: ref.id,
    });
    if (!hit) {
      throw intakeClientError("Order not found for this customer", 400);
    }
    orderHits.set(ref.id, hit);
    resolved.push({ type: "order", id: hit.orderId || ref.id });
  }

  for (const ref of otherRefs) {
    if (ref.type === "product") {
      let productId = "";
      for (const hit of orderHits.values()) {
        if (!hit) continue;
        const lineId = productMatchesOrderLine(ref.id, hit.items);
        if (lineId) {
          productId = lineId;
          break;
        }
      }
      if (!productId) {
        const cdp = await findCdpCatalogProduct({
          organizationId: input.organizationId,
          productId: ref.id,
        });
        if (cdp?.id) productId = cdp.id;
      }
      if (!productId) {
        try {
          const inv = await findInventoryProduct({
            organizationId: input.organizationId,
            codeOrName: ref.id,
          });
          productId = inv.id || inv.code || ref.id;
        } catch {
          productId = "";
        }
      }
      if (!productId) {
        throw intakeClientError("Product not found for this organization", 400);
      }
      resolved.push({ type: "product", id: productId });
      continue;
    }
    throw intakeClientError(
      `Reference type '${ref.type}' is not allowed for this organization`,
      400
    );
  }
  return resolved;
}

export async function persistTicketReferences(
  organizationId: string,
  ticketId: string,
  refs: TicketEntityRef[]
): Promise<void> {
  if (!refs.length) return;
  for (const ref of refs) {
    await query(
      `INSERT INTO ticket_references (organization_id, ticket_id, ref_type, ref_id)
       VALUES ($1::bigint, $2::bigint, $3, $4)
       ON CONFLICT (ticket_id, ref_type, ref_id) DO NOTHING`,
      [organizationId, ticketId, ref.type, ref.id]
    );
  }
}

async function loadTicketEntityRefs(
  organizationId: string,
  ticketId: string
): Promise<TicketEntityRef[]> {
  const { rows } = await query<{ ref_type: string; ref_id: string }>(
    `SELECT ref_type, ref_id
       FROM ticket_references
      WHERE organization_id = $1::bigint AND ticket_id = $2::bigint
      ORDER BY id ASC`,
    [organizationId, ticketId]
  );
  return rows.map((r) => ({
    type: String(r.ref_type || "").trim().toLowerCase(),
    id: String(r.ref_id || "").trim(),
  })).filter((r) => r.type && r.id);
}

function intakeResultShape(
  row: Record<string, unknown>,
  extras?: { references?: TicketEntityRef[] }
): IntakeTicketResult {
  const refs = extras?.references || [];
  const derived = derivedOrderProductFromRefs(refs);
  return {
    ticketId: String(row.id),
    ticketNumber: String(row.ticket_number),
    status: String(row.status || "Open"),
    channel: String(row.channel || "Web"),
    subject: String(row.subject || ""),
    orderId: derived.orderId,
    productId: derived.productId,
    references: refs,
    assignee: String(row.assignee_name || "Unassigned"),
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    resolver: row.resolver_name ? String(row.resolver_name) : null,
    resolverId: row.resolver_id ? String(row.resolver_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function normalizeTicketOrderId(raw: unknown): string | null {
  const text = String(raw || "").trim();
  if (!text || text.length > 80) return null;
  return text;
}

export function normalizeTicketProductId(raw: unknown): string | null {
  return normalizeTicketOrderId(raw);
}

export function pickOptionalOrderProduct(body: Record<string, unknown> | null | undefined): {
  orderId: string | null;
  productId: string | null;
} {
  const src = body && typeof body === "object" ? body : {};
  return {
    orderId: normalizeTicketOrderId(
      src.orderId ?? src.order_id ?? src.orderNumber ?? src.order_number
    ),
    productId: normalizeTicketProductId(
      src.productId ?? src.product_id ?? src.productNumber ?? src.product_number
    ),
  };
}

function intakeClientError(message: string, status: number, extra?: Record<string, unknown>): Error {
  const err = new Error(message) as Error & { status?: number } & Record<string, unknown>;
  err.status = status;
  if (extra) Object.assign(err, extra);
  return err;
}

export async function resolveTicketOrderProduct(input: {
  organizationId: string;
  customerId: string;
  orderId?: string | null;
  productId?: string | null;
}): Promise<{ orderId: string | null; productId: string | null }> {
  const refs = await validateIntakeReferences({
    organizationId: input.organizationId,
    customerId: input.customerId,
    refs: normalizeIntakeReferences({
      orderId: input.orderId,
      productId: input.productId,
    }),
  });
  return derivedOrderProductFromRefs(refs);
}

/** Compare intake issue text to a stored ticket (strip intake footer; not utterance matching). */
export function normalizeIntakeIssueText(raw: unknown): string {
  let text = String(raw || "");
  const cut = text.search(/\n---\nIntake:/);
  if (cut >= 0) text = text.slice(0, cut);
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function intakeIssueTextsMatch(left: unknown, right: unknown): boolean {
  const a = normalizeIntakeIssueText(left);
  const b = normalizeIntakeIssueText(right);
  if (!a || !b) return false;
  if (a === "no description provided." || b === "no description provided.") {
    return false;
  }
  return a === b;
}

export async function findExistingOpenTicketForSameIssue(input: {
  organizationId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  subject?: string | null;
  description?: string | null;
}): Promise<{ ticketNumber: string; ticketId: string; status: string } | null> {
  const orgId = String(input.organizationId || "").trim();
  const customerId = String(input.customerId || "").trim();
  const email = String(input.customerEmail || "").trim().toLowerCase();
  const incoming = [
    normalizeIntakeIssueText(input.subject),
    normalizeIntakeIssueText(input.description),
  ].filter(Boolean);
  if (!orgId || (!customerId && !email) || !incoming.length) return null;

  const { rows } = await query(
    `SELECT t.id, t.ticket_number, t.status, t.subject, t.description
       FROM tickets t
      WHERE t.organization_id = $1
        AND (
          ($2 <> '' AND t.customer_id::text = $2)
          OR ($3 <> '' AND lower(t.customer_email) = $3)
        )
        AND lower(btrim(t.status)) NOT IN ('resolved', 'closed')
        AND NOT EXISTS (
          SELECT 1
            FROM ticketing.ticket_statuses s
           WHERE s.organization_id = t.organization_id
             AND lower(s.status) = lower(t.status)
             AND s.is_terminal = true
        )
      ORDER BY t.created_at DESC
      LIMIT 80`,
    [orgId, customerId, email]
  );

  for (const row of rows) {
    const existing = [
      normalizeIntakeIssueText(row.subject),
      normalizeIntakeIssueText(row.description),
    ];
    const hit = incoming.some((issue) =>
      existing.some((prior) => intakeIssueTextsMatch(issue, prior))
    );
    if (!hit) continue;
    return {
      ticketId: String(row.id),
      ticketNumber: String(row.ticket_number || ""),
      status: String(row.status || ""),
    };
  }
  return null;
}

/** Resolved and Closed (and other terminal statuses) do not hold the order. */
function openTicketOnlySql(alias = "t"): string {
  return `
        AND lower(btrim(${alias}.status)) NOT IN ('resolved', 'closed')
        AND NOT EXISTS (
          SELECT 1
            FROM ticketing.ticket_statuses s
           WHERE s.organization_id = ${alias}.organization_id
             AND lower(s.status) = lower(${alias}.status)
             AND s.is_terminal = true
        )`;
}

export async function findExistingTicketForOrderAndProduct(input: {
  organizationId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  orderId: string;
  productId: string;
}): Promise<{ ticketNumber: string; ticketId: string } | null> {
  const orgId = String(input.organizationId || "").trim();
  const orderId = String(input.orderId || "").trim();
  const productId = String(input.productId || "").trim();
  if (!orgId || !orderId || !productId) return null;
  const customerId = String(input.customerId || "").trim();
  const email = String(input.customerEmail || "").trim().toLowerCase();
  const { rows } = await query(
    `SELECT t.id, t.ticket_number
       FROM tickets t
       JOIN ticket_references o
         ON o.ticket_id = t.id
        AND o.organization_id = t.organization_id
        AND o.ref_type = 'order'
        AND lower(trim(o.ref_id)) = lower($2)
       JOIN ticket_references p
         ON p.ticket_id = t.id
        AND p.organization_id = t.organization_id
        AND p.ref_type = 'product'
        AND lower(trim(p.ref_id)) = lower($3)
      WHERE t.organization_id = $1
        AND (
          ($4 <> '' AND t.customer_id::text = $4)
          OR ($5 <> '' AND lower(t.customer_email) = $5)
        )
        ${openTicketOnlySql("t")}
      ORDER BY t.created_at ASC
      LIMIT 1`,
    [orgId, orderId, productId, customerId, email]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ticketId: String(row.id),
    ticketNumber: String(row.ticket_number || ""),
  };
}

export async function findExistingTicketForOrder(input: {
  organizationId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  orderId: string;
  orderNumber?: string | null;
}): Promise<{ ticketNumber: string; ticketId: string } | null> {
  const orgId = String(input.organizationId || "").trim();
  const orderId = String(input.orderId || "").trim();
  if (!orgId || !orderId) return null;
  const customerId = String(input.customerId || "").trim();
  const email = String(input.customerEmail || "").trim().toLowerCase();
  const orderNumber = String(input.orderNumber || "").trim();
  const ids = [orderId, orderNumber].filter(Boolean);
  const { rows } = await query(
    `SELECT t.id, t.ticket_number
       FROM tickets t
       JOIN ticket_references r
         ON r.ticket_id = t.id
        AND r.organization_id = t.organization_id
      WHERE t.organization_id = $1
        AND r.ref_type = 'order'
        AND lower(trim(r.ref_id)) = ANY($2::text[])
        AND (
          ($3 <> '' AND t.customer_id::text = $3)
          OR ($4 <> '' AND lower(t.customer_email) = $4)
        )
        ${openTicketOnlySql("t")}
      ORDER BY t.created_at ASC
      LIMIT 1`,
    [orgId, ids.map((v) => v.toLowerCase()), customerId, email]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ticketId: String(row.id),
    ticketNumber: String(row.ticket_number || ""),
  };
}

export function sanitizeIntakeAttachments(raw: unknown): string[] {
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
    out.push(`${prefix}${name}`);
  }
  return out;
}

export type IntakeTicketResult = {
  ticketId: string;
  ticketNumber: string;
  status: string;
  channel: string;
  subject: string;
  orderId?: string | null;
  productId?: string | null;
  references?: TicketEntityRef[];
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
  const references = await loadTicketEntityRefs(organizationId, String(row.id));
  return intakeResultShape(row, { references });
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

  const channelIn = intakeChannelKey(input.channel);
  if (!channelIn || !isAllowedIntakeChannel(channelIn)) {
    const err = new Error(
      "channel_type is required (email | webchat | chat | whatsapp | instagram | facebook | phone | web_form | api | web)"
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
  const rawSubject = subjectVal;
  const rawDescription = descriptionVal;
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
  const customerId = /^\d+$/.test(String(directoryCustomer.id || ""))
    ? directoryCustomer.id
    : null;
  const requesterName = directoryCustomer.name || name;
  const requesterEmail = directoryCustomer.email || resolvedEmail;
  const requesterPhone = directoryCustomer.phone || phone || "";

  const actorName = input.actorName || "Intake API";
  const createStatus = statusFromAssignment({
    assigneeId,
    assigneeName,
    resolverId,
  });
  const resolvedRefs = await validateIntakeReferences({
    organizationId: orgId,
    customerId: String(directoryCustomer.id || customerId || ""),
    refs: normalizeIntakeReferences({
      references: input.references,
      orderId: input.orderId,
      productId: input.productId,
    }),
  });
  const orderRefs = resolvedRefs.filter((r) => r.type === "order");
  const productRefs = resolvedRefs.filter((r) => r.type === "product");
  for (const orderRef of orderRefs) {
    for (const productRef of productRefs) {
      const existingPair = await findExistingTicketForOrderAndProduct({
        organizationId: orgId,
        customerId,
        customerEmail: requesterEmail,
        orderId: orderRef.id,
        productId: productRef.id,
      });
      if (existingPair) {
        throw intakeClientError(
          `A ticket already exists for this order and product (${existingPair.ticketNumber})`,
          409,
          {
            ticketNumber: existingPair.ticketNumber,
            ticketId: existingPair.ticketId,
          }
        );
      }
    }
    const existingOrderTicket = await findExistingTicketForOrder({
      organizationId: orgId,
      customerId,
      customerEmail: requesterEmail,
      orderId: orderRef.id,
    });
    if (existingOrderTicket) {
      throw intakeClientError(
        `A ticket already exists for this order (${existingOrderTicket.ticketNumber})`,
        409,
        {
          ticketNumber: existingOrderTicket.ticketNumber,
          ticketId: existingOrderTicket.ticketId,
        }
      );
    }
  }

  const existingIssueTicket = await findExistingOpenTicketForSameIssue({
    organizationId: orgId,
    customerId,
    customerEmail: requesterEmail,
    subject: rawSubject,
    description: rawDescription,
  });
  if (existingIssueTicket) {
    throw intakeClientError(
      `A ticket already exists for this issue (${existingIssueTicket.ticketNumber})`,
      409,
      {
        ticketNumber: existingIssueTicket.ticketNumber,
        ticketId: existingIssueTicket.ticketId,
        ticketStatus: existingIssueTicket.status,
      }
    );
  }
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
          sanitizeIntakeAttachments(input.attachments),
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
  try {
    await persistTicketReferences(orgId, ticketId, resolvedRefs);
  } catch (err) {
    await query(
      `DELETE FROM tickets WHERE id = $1::bigint AND organization_id = $2::bigint`,
      [ticketId, orgId]
    ).catch(() => undefined);
    throw err;
  }
  await incrementCustomerTickets(customerId || "");

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
        input.actorRole === "portal_customer" ||
        input.actorRole === "portal_guest" ||
        input.actorRole === "customer" ||
        Boolean(input.apiKeyId)
          ? null
          : input.actorId || null,
      payload: {
        ...pnaPayload,
        actor_id: input.actorId || null,
        actor_role: input.actorRole || (input.apiKeyId ? "customer" : null),
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

  return intakeResultShape(created, { references: resolvedRefs });
}

/**
 * Webchat / CCaaS: list tickets for an existing customer matched by email or phone.
 * Does not create customers — missing directory match fails.
 */
export async function listTicketsByContact(input: {
  organizationId: string;
  email?: string;
  phone?: string;
  /** Newest first. Webchat lookup uses 5. */
  limit?: number;
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
         ($2 ~ '^[0-9]+$' AND customer_id = $2::bigint)
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
     ORDER BY created_at DESC
     LIMIT $5`,
    [
      orgId,
      customer.id,
      customer.email || email || "",
      String(phone || customer.phone || "").replace(/\D/g, ""),
      Math.min(50, Math.max(1, Number(input.limit) || 5)),
    ]
  );

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
    tickets: await mapTicketRows(orgId, rows),
  };
}

function intakeStatusError(message: string, status: number): Error {
  const err = new Error(message);
  (err as { status?: number }).status = status;
  return err;
}

/** Optional ticket id/number from webchat lookup body. */
export function webchatLookupTicketRef(body: Record<string, unknown>): string {
  return String(
    body.ticketId ||
      body.ticket_id ||
      body.ticketNumber ||
      body.ticket_number ||
      body.id ||
      ""
  ).trim();
}

/** Normalize "#12899" / "12899" for intake status lookup. Not utterance matching. */
function intakeTicketNumberVariants(raw: string): {
  given: string;
  hashed: string;
  digits: string;
} {
  const given = String(raw || "").trim();
  const digits = given.replace(/\D/g, "");
  const hashed = digits ? `#${digits}` : given;
  return { given, hashed, digits };
}

/**
 * Intake status check: org API key + ticket number/id + requester email.
 * Read-only. Same tenant as the key. Email must match the ticket row.
 */
export async function getIntakeTicketStatus(input: {
  organizationId: string;
  ticketRef?: string;
  email?: string;
}): Promise<IntakeTicketResult> {
  const orgId = String(input.organizationId || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const ref = String(input.ticketRef || "").trim();
  if (!orgId) throw intakeStatusError("organizationId is required", 400);
  if (!ref) throw intakeStatusError("ticketNumber is required", 400);
  if (!email) throw intakeStatusError("email is required", 400);

  const { given, hashed, digits } = intakeTicketNumberVariants(ref);
  const { rows } = await query(
    `SELECT * FROM tickets
     WHERE organization_id = $1
       AND lower(btrim(customer_email)) = $2
       AND (
         ticket_number = $3
         OR ticket_number = $4
         OR ($5 <> '' AND id::text = $5)
       )
     ORDER BY CASE
       WHEN ticket_number = $3 OR ticket_number = $4 THEN 0
       ELSE 1
     END
     LIMIT 1`,
    [orgId, email, given, hashed, digits]
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw intakeStatusError("Ticket not found", 404);
  const references = await loadTicketEntityRefs(orgId, String(row.id));
  return intakeResultShape(row, { references });
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

const INTEGRATION_SECRET_KEY_RE =
  /^(authorization|api[-_]?key|x-api-key|x-internal-service-key|password|passwd|secret|token|key_secret|access_token|refresh_token|bearer)$/i;

const LONG_TEXT_KEYS = new Set([
  "html",
  "text",
  "body",
  "description",
  "issue",
  "content",
  "raw",
]);

function truncateLogString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…(${value.length} chars)`;
}

/** Redact secrets and shrink bulky fields for intake / webchat / widget API logs. */
export function redactIntegrationApiPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (/^wt_(live|test)_/i.test(value)) return "[redacted]";
    return truncateLogString(value, 2000);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const max = 40;
    const slice = value
      .slice(0, max)
      .map((item) => redactIntegrationApiPayload(item, depth + 1));
    if (value.length > max) slice.push(`…+${value.length - max} more`);
    return slice;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (INTEGRATION_SECRET_KEY_RE.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      if (key === "attachments" && Array.isArray(nested)) {
        out[key] = nested.slice(0, 20).map((att) => {
          if (!att || typeof att !== "object") return att;
          const row = att as Record<string, unknown>;
          const content = row.content;
          return {
            name: row.name ?? row.filename ?? row.path,
            contentType: row.contentType ?? row.mimeType ?? row.type,
            bytes:
              typeof content === "string"
                ? content.length
                : typeof row.size === "number"
                  ? row.size
                  : undefined,
            hasContent: Boolean(content || row.url || row.path),
          };
        });
        if (nested.length > 20) {
          (out[key] as unknown[]).push(`…+${nested.length - 20} more`);
        }
        continue;
      }
      if (LONG_TEXT_KEYS.has(key) && typeof nested === "string") {
        out[key] = truncateLogString(nested, 800);
        continue;
      }
      out[key] = redactIntegrationApiPayload(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function summarizeIntegrationAuthHeaders(req: {
  headers?: Record<string, unknown>;
}): {
  authorization: string | null;
  xApiKey: string | null;
  xInternalServiceKey: string | null;
  keyHint: string | null;
} {
  const headers = req.headers || {};
  const authorization = String(headers.authorization || headers.Authorization || "").trim();
  const xApiKey = String(headers["x-api-key"] || "").trim();
  const xInternal = String(headers["x-internal-service-key"] || "").trim();
  const raw = authorization.replace(/^Bearer\s+/i, "").trim() || xApiKey;
  let keyHint: string | null = null;
  if (raw) {
    keyHint = /^wt_(live|test)_/i.test(raw) ? `${raw.slice(0, 8)}…` : "[present]";
  }
  return {
    authorization: authorization
      ? /^Bearer\s+/i.test(authorization)
        ? "Bearer [redacted]"
        : "[redacted]"
      : null,
    xApiKey: xApiKey ? "[redacted]" : null,
    xInternalServiceKey: xInternal ? "[redacted]" : null,
    keyHint,
  };
}

export function logIntegrationApi(event: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  organizationId?: string | null;
  params?: unknown;
  auth: ReturnType<typeof summarizeIntegrationAuthHeaders>;
  payload: unknown;
  response: unknown;
}): void {
  const line = {
    method: event.method,
    path: event.path,
    status: event.status,
    durationMs: event.durationMs,
    organizationId: event.organizationId || null,
    params: event.params && Object.keys(event.params as object).length
      ? redactIntegrationApiPayload(event.params)
      : undefined,
    auth: event.auth,
    payload: redactIntegrationApiPayload(event.payload),
    response: redactIntegrationApiPayload(event.response),
  };
  const serialized = JSON.stringify(line);
  if (event.status >= 500) {
    console.error("[integration-api]", serialized);
  } else if (event.status >= 400) {
    console.warn("[integration-api]", serialized);
  } else {
    console.info("[integration-api]", serialized);
  }
}
