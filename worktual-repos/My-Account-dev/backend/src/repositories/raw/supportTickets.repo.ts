import { pool } from "../../db/pool.js";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return pool;
}

export async function selectSupportTicketsForOrganization(
  runner: any,
  organizationId: any,
  whereClause: any,
  values: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT t.*
     FROM support_tickets t
     WHERE t.organization_id = $1
     ${whereClause}
     ORDER BY t.created_at DESC`,
    [organizationId, ...values],
  );
  return rows;
}

export async function selectSupportTicketByIdAndOrg(runner: any, ticketId: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM support_tickets WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [ticketId, organizationId],
  );
  return rows[0] || null;
}

export async function selectTicketMessages(runner: any, ticketId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
    [ticketId],
  );
  return rows;
}

export async function insertTicketMessage(runner: any, ticketId: any, authorType: any, authorLabel: any, body: any) {
  await runnerQuery(runner).query(
    `INSERT INTO support_ticket_messages (ticket_id, author_type, author_label, body)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, authorType, authorLabel, body],
  );
}

export async function updateTicketStatus(runner: any, ticketId: any, status: any) {
  await runnerQuery(runner).query(
    `UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1`,
    [ticketId, status],
  );
}

export async function updateTicketStatusWithResolved(runner: any, ticketId: any, status: any) {
  await runnerQuery(runner).query(
    `UPDATE support_tickets
     SET status = $2::varchar,
         updated_at = NOW(),
         resolved_at = CASE
           WHEN $2::text IN ('resolved', 'closed') THEN COALESCE(resolved_at, NOW())
           ELSE NULL
         END
     WHERE id = $1`,
    [ticketId, status],
  );
}

export async function selectSupportTicketsForSales(
  runner: any,
  scopeClause: any,
  scopeValues: any,
  whereClause: any,
  filterValues: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT t.*,
            l.id AS source_lead_id,
            l.assigned_user_id AS sales_assigned_user_id,
            l.created_by_user_id AS sales_created_by_user_id
     FROM support_tickets t
     JOIN organizations o ON o.id = t.organization_id
     JOIN leads l ON l.id = o.source_lead_id
     WHERE TRUE
     ${scopeClause}
     ${whereClause}
     ORDER BY t.created_at DESC`,
    [...scopeValues, ...filterValues],
  );
  return rows;
}

export async function selectSupportTicketForSales(runner: any, ticketId: any, scopeClause: any, scopeValues: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT t.*,
            l.id AS source_lead_id
     FROM support_tickets t
     JOIN organizations o ON o.id = t.organization_id
     JOIN leads l ON l.id = o.source_lead_id
     WHERE t.id = $1
     ${scopeClause}
     LIMIT 1`,
    [ticketId, ...scopeValues],
  );
  return rows[0] || null;
}

export async function selectSalesOwnerForOrganization(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT l.id AS source_lead_id,
            l.assigned_user_id,
            l.created_by_user_id
     FROM organizations o
     JOIN leads l ON l.id = o.source_lead_id
     WHERE o.id = $1
     LIMIT 1`,
    [organizationId],
  );
  return rows[0] || null;
}
