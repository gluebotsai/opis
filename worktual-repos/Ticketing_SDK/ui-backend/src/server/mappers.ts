import { formatRelative, isDueToday } from "./sla";
import { mapIntakeChannel } from "./intake";
import { query } from "./db";
import type {
  Ticket,
  Customer,
  KBArticle,
  AgentQueue,
  ActivityLog,
  DashboardMetrics,
} from "../types";

export type TicketEntityRef = { type: string; id: string };

export function normalizeTicketChannel(raw: unknown): Ticket["channel"] {
  return mapIntakeChannel(String(raw || "Web"));
}

function refsFromRow(row: Record<string, unknown>): TicketEntityRef[] {
  if (!Array.isArray(row.references)) return [];
  return (row.references as TicketEntityRef[])
    .map((r) => ({
      type: String(r?.type || "").trim().toLowerCase(),
      id: String(r?.id || "").trim(),
    }))
    .filter((r) => r.type && r.id);
}

export async function loadTicketReferences(
  organizationId: string,
  ticketIds: string[]
): Promise<Map<string, TicketEntityRef[]>> {
  const byId = new Map<string, TicketEntityRef[]>();
  const ids = [...new Set(ticketIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!organizationId || !ids.length) return byId;
  const { rows } = await query<{
    ticket_id: string;
    ref_type: string;
    ref_id: string;
  }>(
    `SELECT ticket_id::text AS ticket_id, ref_type, ref_id
       FROM ticket_references
      WHERE organization_id = $1::bigint
        AND ticket_id = ANY($2::bigint[])
      ORDER BY id ASC`,
    [organizationId, ids]
  );
  for (const row of rows) {
    const tid = String(row.ticket_id || "");
    const type = String(row.ref_type || "").trim().toLowerCase();
    const id = String(row.ref_id || "").trim();
    if (!tid || !type || !id) continue;
    const list = byId.get(tid) || [];
    list.push({ type, id });
    byId.set(tid, list);
  }
  return byId;
}

export async function mapTicketRows(
  organizationId: string,
  rows: Array<Record<string, unknown>>
): Promise<Ticket[]> {
  const ids = rows.map((r) => String(r.id || "")).filter(Boolean);
  const byId = await loadTicketReferences(organizationId, ids);
  return rows.map((row) =>
    mapTicket({
      ...row,
      references: byId.get(String(row.id || "")) || [],
    })
  );
}

export async function mapOneTicket(
  organizationId: string,
  row: Record<string, unknown>
): Promise<Ticket> {
  const [ticket] = await mapTicketRows(organizationId, [row]);
  return ticket;
}

export function mapTicket(row: Record<string, unknown>): Ticket {
  const references = refsFromRow(row);
  const orderId =
    references.find((r) => r.type === "order")?.id ||
    (row.order_id != null && String(row.order_id).trim()
      ? String(row.order_id).trim()
      : null);
  const productId =
    references.find((r) => r.type === "product")?.id ||
    (row.product_id != null && String(row.product_id).trim()
      ? String(row.product_id).trim()
      : null);
  return {
    id: String(row.ticket_number),
    subject: String(row.subject),
    description: String(row.description ?? ""),
    customerId: row.customer_id ? String(row.customer_id) : null,
    customerName: String(row.customer_name),
    customerEmail: String(row.customer_email),
    customerPhone: row.customer_phone ? String(row.customer_phone) : "",
    channel: normalizeTicketChannel(row.channel),
    assignee: String(row.assignee_name || "Unassigned"),
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    resolver: row.resolver_name ? String(row.resolver_name) : null,
    resolverId: row.resolver_id ? String(row.resolver_id) : null,
    createdById: row.created_by_id ? String(row.created_by_id) : null,
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    queue: row.queue_name ? String(row.queue_name) : undefined,
    priority: row.priority as Ticket["priority"],
    status: row.status as Ticket["status"],
    updatedAt: formatRelative(row.updated_at as string),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    resolvedAt: row.resolved_at
      ? row.resolved_at instanceof Date
        ? row.resolved_at.toISOString()
        : String(row.resolved_at)
      : null,
    attachments: Array.isArray(row.attachments)
      ? (row.attachments as string[])
      : [],
    dueAt: row.due_at
      ? row.due_at instanceof Date
        ? row.due_at.toISOString()
        : String(row.due_at)
      : undefined,
    csatScore:
      row.csat_score != null && row.csat_score !== ""
        ? Number(row.csat_score)
        : null,
    csatComment:
      row.csat_comment != null && String(row.csat_comment).trim()
        ? String(row.csat_comment).trim()
        : null,
    category: row.category != null && row.category !== "" ? String(row.category) : null,
    skill: row.skill != null && row.skill !== "" ? String(row.skill) : null,
    references,
    orderId,
    productId,
    aiSummary:
      row.ai_summary != null && row.ai_summary !== ""
        ? String(row.ai_summary)
        : null,
  };
}

export function mapCustomer(row: Record<string, unknown>): Customer {
  return {
    id: String(row.id),
    externalId: row.external_id ? String(row.external_id) : "",
    name: String(row.name),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    totalTickets: Number(row.total_tickets || 0),
    status: row.status as Customer["status"],
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString().slice(0, 10)
        : String(row.created_at).slice(0, 10),
    accountId: row.account_id ? String(row.account_id) : null,
    accountName: row.account_name ? String(row.account_name) : null,
  };
}

export function mapKb(row: Record<string, unknown>): KBArticle {
  return {
    id: String(row.external_id || row.id),
    title: String(row.title),
    content: String(row.content),
    category: row.category as KBArticle["category"],
    author: String(row.author_name),
    status: row.status as KBArticle["status"],
    views: Number(row.views || 0),
    updatedAt: formatRelative(row.updated_at as string),
    attachments: Array.isArray(row.attachments)
      ? (row.attachments as string[])
      : [],
  };
}

export function mapQueue(row: Record<string, unknown>): AgentQueue {
  const membersRaw = row.members;
  let members: string[] | undefined;
  if (Array.isArray(membersRaw)) {
    members = membersRaw.map((m) => String(m)).filter(Boolean);
  } else if (typeof membersRaw === "string" && membersRaw.trim()) {
    try {
      const parsed = JSON.parse(membersRaw);
      if (Array.isArray(parsed)) members = parsed.map((m) => String(m));
    } catch {
      members = undefined;
    }
  }
  return {
    id: String(row.external_id || row.id),
    queueName: String(row.queue_name),
    type: row.type as AgentQueue["type"],
    openTickets: Number(row.open_tickets || 0),
    assigned: Number(row.assigned || 0),
    slaStatus: row.sla_status as AgentQueue["slaStatus"],
    description: row.description != null ? String(row.description) : "",
    members,
    memberIds: Array.isArray(row.memberIds)
      ? row.memberIds.map((id) => String(id))
      : undefined,
    memberDetails: Array.isArray(row.memberDetails)
      ? (row.memberDetails as AgentQueue["memberDetails"])
      : undefined,
  };
}

export function mapActivity(row: Record<string, unknown>): ActivityLog {
  return {
    id: String(row.id),
    text: String(row.text),
    time: formatRelative(row.created_at as string),
  };
}

export function mapMetrics(row: Record<string, unknown>): DashboardMetrics {
  return {
    openTickets: Number(row.open_tickets || 0),
    onHold: Number(row.on_hold || 0),
    overdue: Number(row.overdue || 0),
    dueToday: Number(row.due_today || 0),
    createdToday: Number(row.created_today || 0),
    unassigned: Number(row.unassigned || 0),
    openChange: String(row.open_change || "—"),
    onHoldChange: String(row.on_hold_change || "—"),
    overdueChange: String(row.overdue_change || "—"),
    dueTodayChange: String(row.due_today_change || "—"),
    unassignedChange: String(row.unassigned_change || "—"),
    priorityCounts: { low: 0, medium: 0, high: 0, urgent: 0 },
    topQueues: [],
  };
}

export { isDueToday };
