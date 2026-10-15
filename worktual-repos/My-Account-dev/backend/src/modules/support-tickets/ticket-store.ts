import crypto from "node:crypto";

import { pool } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { createSupportTicketWithMessage } from "../../repositories/functions/supportTickets.repo.js";
import * as supportTicketsRepo from "../../repositories/raw/supportTickets.repo.js";

const TICKET_STATUSES = ["open", "in_progress", "waiting_on_customer", "resolved", "closed"];

function generateTicketNumber() {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `TKT-${year}-${suffix}`;
}

function mapTicketRow(row: any) {
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    ticketNumber: entry!.ticketNumber,
    organizationId: entry!.organizationId,
    customerUserId: entry!.customerUserId,
    subscriptionId: entry!.subscriptionId || null,
    productId: entry!.productId || null,
    subscriptionKey: entry!.subscriptionKey || null,
    productLabel: entry!.productLabel || "",
    category: entry!.category,
    priority: entry!.priority,
    subject: entry!.subject,
    description: entry!.description,
    status: entry!.status,
    unableToUse: entry!.unableToUse === true,
    startedAfterChange: entry!.startedAfterChange === true,
    tenantId: entry!.tenantId || "",
    companyName: entry!.companyName || "",
    contactEmail: entry!.contactEmail || "",
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
    resolvedAt: toIso(entry!.resolvedAt),
  };
}

function mapMessageRow(row: any) {
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    ticketId: entry!.ticketId,
    authorType: entry!.authorType,
    authorLabel: entry!.authorLabel || "",
    body: entry!.body,
    createdAt: toIso(entry!.createdAt),
  };
}

function buildTicketFilters({ status, productId, days, subscriptionIds = null, customerUserId = null }: any) {
  const clauses = [];
  const values = [];
  let index = 2;

  if (Array.isArray(subscriptionIds)) {
    if (subscriptionIds.length === 0) {
      clauses.push(`t.customer_user_id = $${index}`);
      values.push(customerUserId);
      index += 1;
    } else {
      clauses.push(
        `(t.subscription_id = ANY($${index}::uuid[]) OR (t.subscription_id IS NULL AND t.customer_user_id = $${index + 1}))`,
      );
      values.push(subscriptionIds, customerUserId);
      index += 2;
    }
  }

  if (status && status !== "all" && TICKET_STATUSES.includes(status)) {
    clauses.push(`t.status = $${index}`);
    values.push(status);
    index += 1;
  }

  if (productId === "account") {
    clauses.push(`t.product_id IS NULL`);
  } else if (productId && productId !== "all") {
    clauses.push(`t.product_id = $${index}`);
    values.push(productId);
    index += 1;
  }

  if (days && Number(days) > 0) {
    clauses.push(`t.created_at >= NOW() - ($${index}::int || ' days')::interval`);
    values.push(Number(days));
  }

  const where = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  return { where, values };
}

export async function listSupportTicketsForOrganization(organizationId: any, filters: any = {}) {
  const { where, values } = buildTicketFilters(filters);
  const rows = await supportTicketsRepo.selectSupportTicketsForOrganization(
    pool,
    organizationId,
    where,
    values,
  );

  return rows.map(mapTicketRow);
}

export async function getSupportTicketForOrganization(ticketId: any, organizationId: any) {
  const row = await supportTicketsRepo.selectSupportTicketByIdAndOrg(
    pool,
    ticketId,
    organizationId,
  );

  if (!row) {
    return null;
  }

  const ticket = mapTicketRow(row);
  const messageRows = await supportTicketsRepo.selectTicketMessages(pool, ticketId);

  return {
    ticket,
    messages: messageRows.map(mapMessageRow),
  };
}

export async function createSupportTicket({
  organizationId,
  customerUserId,
  subscriptionId = null,
  productId = null,
  subscriptionKey = null,
  productLabel = "",
  category,
  priority = "medium",
  subject,
  description,
  unableToUse = false,
  startedAfterChange = false,
  tenantId = "",
  companyName = "",
  contactEmail = "",
  authorLabel = "",
}: any) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const ticketNumber = generateTicketNumber();
    const ticketId = await createSupportTicketWithMessage(client, {
      ticketNumber,
      organizationId,
      customerUserId,
      subscriptionId,
      productId,
      subscriptionKey,
      productLabel,
      category,
      priority,
      subject,
      description,
      unableToUse,
      startedAfterChange,
      tenantId,
      companyName,
      contactEmail,
      authorLabel: authorLabel || contactEmail,
    });

    await client.query("COMMIT");

    return getSupportTicketForOrganization(ticketId, organizationId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addCustomerTicketReply({
  ticketId,
  organizationId,
  body,
  authorLabel = "",
}: any) {
  const existing = await getSupportTicketForOrganization(ticketId, organizationId);
  if (!existing) {
    return null;
  }

  if (existing.ticket.status === "closed") {
    throw new Error("This ticket is closed and cannot receive new replies.");
  }

  await supportTicketsRepo.insertTicketMessage(pool, ticketId, "customer", authorLabel, body);

  const nextStatus =
    existing.ticket.status === "waiting_on_customer" ? "in_progress" : existing.ticket.status;

  await supportTicketsRepo.updateTicketStatus(pool, ticketId, nextStatus);

  return getSupportTicketForOrganization(ticketId, organizationId);
}

/**
 * Sales admins see all customer tickets.
 * Sales executives see tickets only for leads they created.
 */
function salesTicketScopeClause(authUser: any, { paramOffset = 1 }: any = {}) {
  if (authUser?.role === "sales_admin" || authUser?.role === "admin") {
    return { clause: "", values: [], nextIndex: paramOffset };
  }

  if (authUser?.role === "sales" && authUser.userId) {
    return {
      clause: `AND (l.assigned_user_id = $${paramOffset} OR l.created_by_user_id = $${paramOffset})`,
      values: [authUser.userId],
      nextIndex: paramOffset + 1,
    };
  }

  return { clause: "AND FALSE", values: [], nextIndex: paramOffset };
}

function buildSalesTicketFilters(filters: any, startIndex: any) {
  const clauses = [];
  const values = [];
  let index = startIndex;

  if (filters.status && filters.status !== "all" && TICKET_STATUSES.includes(filters.status)) {
    clauses.push(`t.status = $${index}`);
    values.push(filters.status);
    index += 1;
  }

  if (filters.productId === "account") {
    clauses.push(`t.product_id IS NULL`);
  } else if (filters.productId && filters.productId !== "all") {
    clauses.push(`t.product_id = $${index}`);
    values.push(filters.productId);
    index += 1;
  }

  if (filters.days && Number(filters.days) > 0) {
    clauses.push(`t.created_at >= NOW() - ($${index}::int || ' days')::interval`);
    values.push(Number(filters.days));
    index += 1;
  }

  if (filters.search?.trim()) {
    clauses.push(
      `(t.ticket_number ILIKE $${index} OR t.subject ILIKE $${index} OR t.company_name ILIKE $${index} OR t.tenant_id ILIKE $${index} OR COALESCE(t.contact_email, '') ILIKE $${index})`,
    );
    values.push(`%${filters.search.trim()}%`);
    index += 1;
  }

  const where = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  return { where, values, nextIndex: index };
}

export async function listSupportTicketsForSalesUser(authUser: any, filters: any = {}) {
  const scope = salesTicketScopeClause(authUser, { paramOffset: 1 });
  const { where, values: filterValues } = buildSalesTicketFilters(filters, scope.nextIndex);

  const rows = await supportTicketsRepo.selectSupportTicketsForSales(
    pool,
    scope.clause,
    scope.values,
    where,
    filterValues,
  );

  return rows.map((row: any) => ({
    ...mapTicketRow(row),
    sourceLeadId: row.source_lead_id || null,
  }));
}

export async function getSupportTicketForSalesUser(ticketId: any, authUser: any) {
  const scope = salesTicketScopeClause(authUser, { paramOffset: 2 });

  const row = await supportTicketsRepo.selectSupportTicketForSales(
    pool,
    ticketId,
    scope.clause,
    scope.values,
  );

  if (!row) {
    return null;
  }

  const ticket = {
    ...mapTicketRow(row),
    sourceLeadId: row.source_lead_id || null,
  };

  const messageRows = await supportTicketsRepo.selectTicketMessages(pool, ticketId);

  return {
    ticket,
    messages: messageRows.map(mapMessageRow),
  };
}

export async function addSalesTicketReply({
  ticketId,
  authUser,
  body,
  authorLabel = "",
  status = null,
}: any) {
  const messageBody = typeof body === "string" ? body.trim() : "";
  if (!messageBody) {
    throw new Error("Reply body is required.");
  }

  if (status != null && status !== "" && !TICKET_STATUSES.includes(status)) {
    throw new Error("Invalid ticket status.");
  }

  const existing = await getSupportTicketForSalesUser(ticketId, authUser);
  if (!existing) {
    return null;
  }

  if (existing.ticket.status === "closed") {
    throw new Error("This ticket is closed and cannot receive new replies.");
  }

  await supportTicketsRepo.insertTicketMessage(
    pool,
    ticketId,
    "sales",
    authorLabel || authUser?.displayName || authUser?.email || "Sales",
    messageBody,
  );

  // Prefer server-driven status after sales reply; ignore stale/invalid client status.
  let nextStatus = existing.ticket.status;
  if (existing.ticket.status === "open" || existing.ticket.status === "in_progress") {
    nextStatus = "waiting_on_customer";
  } else if (status && TICKET_STATUSES.includes(status) && status !== "closed") {
    nextStatus = status;
  }

  await supportTicketsRepo.updateTicketStatusWithResolved(pool, ticketId, nextStatus);

  return getSupportTicketForSalesUser(ticketId, authUser);
}

export async function updateSalesTicketStatus({ ticketId, authUser, status }: any) {
  if (!TICKET_STATUSES.includes(status)) {
    throw new Error("Invalid ticket status.");
  }

  const existing = await getSupportTicketForSalesUser(ticketId, authUser);
  if (!existing) {
    return null;
  }

  await supportTicketsRepo.updateTicketStatusWithResolved(pool, ticketId, status);

  return getSupportTicketForSalesUser(ticketId, authUser);
}

export async function resolveSalesOwnerForOrganization(organizationId: any) {
  const row = await supportTicketsRepo.selectSalesOwnerForOrganization(pool, organizationId);

  return row
    ? {
        sourceLeadId: row.source_lead_id,
        assignedUserId: row.assigned_user_id,
        createdByUserId: row.created_by_user_id,
      }
    : null;
}
