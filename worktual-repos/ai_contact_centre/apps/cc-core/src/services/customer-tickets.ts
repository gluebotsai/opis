import { Prisma } from "@ai-contact-center/db-cc";

import type { DbClient } from "../lib/rls.js";

const TICKET_LIMIT = 20;

export type CustomerTicketNote = {
  id: string;
  authorName: string;
  body: string;
  visibility: string | null;
  createdAt: string;
};

export type CustomerTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  channel: string;
  assigneeName: string | null;
  resolverName: string | null;
  queueName: string | null;
  category: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  csatScore: number | null;
  csatComment: string | null;
  aiSummary: string | null;
  orderId: string | null;
  productId: string | null;
  interactionId: string | null;
  createdAt: string;
  notes: CustomerTicketNote[];
};

type TicketRow = {
  id: bigint | number | string;
  ticket_number: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  channel: string;
  assignee_name: string | null;
  resolver_name: string | null;
  queue_name: string | null;
  category: string | null;
  due_at: Date | string | null;
  resolved_at: Date | string | null;
  csat_score: number | null;
  csat_comment: string | null;
  ai_summary: string | null;
  portal_chat_session_id: string | null;
  created_at: Date | string;
};

type NoteRow = {
  id: bigint | number | string;
  ticket_id: bigint | number | string;
  author_name: string;
  body: string;
  visibility: string | null;
  created_at: Date | string;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapCustomerTicket(row: TicketRow, notes: NoteRow[]): CustomerTicket {
  const createdAt = iso(row.created_at) ?? new Date(0).toISOString();
  const score = row.csat_score == null ? null : Number(row.csat_score);
  return {
    id: String(row.id),
    ticketNumber: row.ticket_number.trim() || String(row.id),
    subject: row.subject.trim() || "Ticket",
    description: clean(row.description),
    status: row.status.trim() || "Open",
    priority: row.priority.trim() || "medium",
    channel: row.channel.trim() || "Web",
    assigneeName: clean(row.assignee_name),
    resolverName: clean(row.resolver_name),
    queueName: clean(row.queue_name),
    category: clean(row.category),
    dueAt: iso(row.due_at),
    resolvedAt: iso(row.resolved_at),
    csatScore: score != null && Number.isFinite(score) ? score : null,
    csatComment: clean(row.csat_comment),
    aiSummary: clean(row.ai_summary),
    orderId: null,
    productId: null,
    interactionId: clean(row.portal_chat_session_id),
    createdAt,
    notes: notes.map((note) => ({
      id: String(note.id),
      authorName: note.author_name.trim() || "Note",
      body: note.body,
      visibility: clean(note.visibility),
      createdAt: iso(note.created_at) ?? createdAt,
    })),
  };
}

export function compareCustomerTickets(left: CustomerTicket, right: CustomerTicket): number {
  const byDate = right.createdAt.localeCompare(left.createdAt);
  if (byDate !== 0) return byDate;
  return right.ticketNumber.localeCompare(left.ticketNumber, undefined, { numeric: true });
}

export async function listCustomerTickets(
  db: DbClient,
  organizationId: string,
  contactId: string,
): Promise<CustomerTicket[]> {
  const trimmed = contactId.trim();
  if (!trimmed) return [];
  const rows = await db.$queryRaw<TicketRow[]>`
    SELECT
      t.id,
      t.ticket_number,
      t.subject,
      t.description,
      t.status,
      t.priority,
      t.channel,
      t.assignee_name,
      t.resolver_name,
      t.queue_name,
      t.category,
      t.due_at,
      t.resolved_at,
      t.csat_score,
      t.csat_comment,
      t.ai_summary,
      t.portal_chat_session_id,
      t.created_at
    FROM ticketing.tickets t
    WHERE t.organization_id = ${organizationId}::bigint
      AND (
        t.customer_id IN (
          SELECT cp.id
          FROM ticketing.contact_profile cp
          WHERE cp.organization_id = ${organizationId}::bigint
            AND cp.cdp_id = ${trimmed}
        )
        OR lower(t.customer_email) IN (
          SELECT lower(ik.key_value)
          FROM cdp.identity_keys ik
          WHERE ik.organization_id = ${organizationId}::bigint
            AND ik.cdp_id = ${trimmed}
            AND ik.key_type = 'email'
            AND btrim(ik.key_value) <> ''
        )
      )
    ORDER BY
      CASE lower(t.priority)
        WHEN 'urgent' THEN 0
        WHEN 'high' THEN 0
        ELSE 1
      END,
      t.created_at DESC
    LIMIT ${TICKET_LIMIT}
  `;
  if (rows.length === 0) return [];
  const ticketIds = rows.map((row) => String(row.id));
  const notes = await db.$queryRaw<NoteRow[]>`
    SELECT n.id, n.ticket_id, n.author_name, n.body, n.visibility, n.created_at
    FROM ticketing.ticket_notes n
    WHERE n.organization_id = ${organizationId}::bigint
      AND n.ticket_id IN (${Prisma.join(ticketIds.map((id) => Prisma.sql`${id}::bigint`))})
    ORDER BY n.created_at
  `;
  const notesByTicket = new Map<string, NoteRow[]>();
  for (const note of notes) {
    const key = String(note.ticket_id);
    const list = notesByTicket.get(key) ?? [];
    list.push(note);
    notesByTicket.set(key, list);
  }
  return rows
    .map((row) => mapCustomerTicket(row, notesByTicket.get(String(row.id)) ?? []))
    .sort(compareCustomerTickets);
}
