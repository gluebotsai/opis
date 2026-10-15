import { getPaymentConfirmSlaHours } from "../../infra/env.js";
import { assignLead, getLeadById, reassignAllLeadsOwnedByUser } from "../leads/lead-store.js";
import { getUserById, listSalesUsers } from "../users/user-store.js";
import { rowToCamel, rowsToCamel, toIso } from "../../db/util.js";
import {
  PAID_STATUS,
  PIPELINE_STATUSES,
  buildAgentMetricsSql,
  insertExportAuditLog,
  selectAgentProductMix,
  selectDashboardMeta,
  selectLeadAssignmentHistory,
  selectLeadOversightRows,
  selectLeadQuotations,
  selectPeriodSummary,
  selectPipelineFunnelByValue,
  selectRecentApprovalActivity,
  selectRecentAssignmentActivity,
  selectRecentLeadActivity,
  selectRecentPaymentActivity,
  selectPaymentOpsMetrics,
  selectRevenueTrend,
  selectStaleLeads,
  selectTopProductsWithRevenue,
  selectUnassignedLeads,
} from "../../repositories/raw/salesOversight.repo.js";
import { query } from "../../db/pool.js";

const STALE_LEAD_DAYS = 14;

function parseDays(value: any, defaultDays = 30) {
  const parsed = Number(value);
  if (parsed === 0) {
    return 0;
  }
  if (!parsed || parsed < 1) {
    return defaultDays;
  }
  return Math.min(parsed, 365);
}

function startOfLocalDay(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString();
}

function sinceDate(days: any) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function resolvePeriodBounds(days: any) {
  const rangeDays = parseDays(days);

  if (rangeDays === 0) {
    return {
      days: 0,
      since: startOfLocalDay(0),
      until: startOfLocalDay(1),
      previousSince: startOfLocalDay(-1),
      previousUntil: startOfLocalDay(0),
    };
  }

  return {
    days: rangeDays,
    since: sinceDate(rangeDays),
    until: null,
    previousSince: previousSinceDate(rangeDays),
    previousUntil: sinceDate(rangeDays),
  };
}

function toNumber(value: any) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadAgentMetrics(agentEmail: any, userId: any, bounds: any) {
  const { since, until } = bounds;
  const { sql } = buildAgentMetricsSql(until);
  const params = until
    ? [userId, agentEmail, since, until, PAID_STATUS, PIPELINE_STATUSES]
    : [userId, agentEmail, since, PAID_STATUS, PIPELINE_STATUSES];

  const { rows } = await query(sql, params);
  const metrics = rows[0] || {};
  const quotationsSubmitted = toNumber(metrics.quotations_submitted);
  const paidDeals = toNumber(metrics.paid_deals);

  return {
    assignedLeads: toNumber(metrics.assigned_leads),
    quotationsSubmitted,
    paidDeals,
    revenue: toNumber(metrics.revenue),
    pipelineValue: toNumber(metrics.pipeline_value),
    conversionRate:
      quotationsSubmitted > 0 ? Math.round((paidDeals / quotationsSubmitted) * 1000) / 10 : 0,
  };
}

function percentChange(current: any, previous: any) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function previousSinceDate(days: any) {
  const date = new Date();
  date.setDate(date.getDate() - days * 2);
  return date.toISOString();
}

async function loadPeriodSummary(since: any, until: any = null) {
  const summary = await selectPeriodSummary(since, until);
  const quotationsSubmitted = toNumber(summary.quotations_submitted);
  const paidQuotations = toNumber(summary.paid_quotations);

  return {
    revenue: toNumber(summary.revenue),
    pipelineValue: toNumber(summary.pipeline_value),
    totalLeads: toNumber(summary.total_leads),
    quotationsSubmitted,
    paidQuotations,
    conversionRate:
      quotationsSubmitted > 0
        ? Math.round((paidQuotations / quotationsSubmitted) * 1000) / 10
        : 0,
  };
}

async function loadRevenueTrend(since: any, until: any = null) {
  const rows = await selectRevenueTrend(since, until);
  return rows.map((row) => ({
    day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10),
    revenue: toNumber(row.revenue),
  }));
}

async function loadPipelineFunnelByValue() {
  const rows = await selectPipelineFunnelByValue();
  const funnelStatuses = ["New", "Pending Finance Review", "Approved", "Paid"];

  const entries = funnelStatuses.map((status) => {
    const row = rows.find((entry: any) => entry.status === status);
    return { status, value: row ? toNumber(row.value) : 0 };
  });

  const total = entries.reduce((sum, entry) => sum + entry.value, 0) || 1;

  return entries.map((entry) => ({
    ...entry,
    percentage: Math.round((entry.value / total) * 1000) / 10,
  }));
}

async function loadTopProductsWithRevenue(since: any, until: any = null) {
  const rows = await selectTopProductsWithRevenue(since, until);
  return rows.map((row) => ({
    productId: row.product_id,
    quoteCount: toNumber(row.quote_count),
    revenue: toNumber(row.revenue),
  }));
}

async function loadRecentActivity() {
  const activities = [];

  for (const row of await selectRecentLeadActivity()) {
    activities.push({
      type: "lead_created",
      label: `New lead '${row.company_name || "Untitled"}' added by ${row.actor_name || "Sales"}`,
      timestamp: toIso(row.created_at),
    });
  }

  for (const row of await selectRecentAssignmentActivity()) {
    activities.push({
      type: "lead_assigned",
      label: `Lead assigned to ${row.to_name || "agent"} by ${row.actor_name || "Sales Admin"}`,
      timestamp: toIso(row.created_at),
    });
  }

  for (const row of await selectRecentApprovalActivity()) {
    activities.push({
      type: "proposal_approved",
      label: `Proposal approved by ${row.reviewed_by || "Finance"}`,
      timestamp: toIso(row.reviewed_at),
    });
  }

  for (const row of await selectRecentPaymentActivity()) {
    activities.push({
      type: "payment_received",
      label: `Payment received from ${row.company_name || "customer"}`,
      amount: toNumber(row.grand_total),
      currency: row.currency || "INR",
      timestamp: toIso(row.paid_at),
    });
  }

  return activities
    .filter((entry) => entry.timestamp)
    .sort((a, b) => new Date((b.timestamp as any)).getTime() - new Date((a.timestamp as any)).getTime())
    .slice(0, 8);
}

export async function getOversightDashboard({ days = 30 }: any = {}) {
  const bounds = resolvePeriodBounds(days);

  const [currentSummary, previousSummary, revenueTrend, pipelineFunnel, agents, topProducts, recentActivity] =
    await Promise.all([
      loadPeriodSummary(bounds.since, bounds.until),
      loadPeriodSummary(bounds.previousSince, bounds.previousUntil),
      loadRevenueTrend(bounds.since, bounds.until),
      loadPipelineFunnelByValue(),
      listOversightAgents({ days: bounds.days }),
      loadTopProductsWithRevenue(bounds.since, bounds.until),
      loadRecentActivity(),
    ]);

  const meta = await selectDashboardMeta();
  const staleRows = await selectStaleLeads(STALE_LEAD_DAYS);
  const paymentOps = await selectPaymentOpsMetrics(getPaymentConfirmSlaHours());

  return {
    days: bounds.days,
    staleLeadDays: STALE_LEAD_DAYS,
    summary: {
      salesAgents: toNumber(meta.sales_agents),
      totalLeads: toNumber(meta.total_leads_all),
      unassignedLeads: toNumber(meta.unassigned_leads),
      revenue: currentSummary.revenue,
      pipelineValue: currentSummary.pipelineValue,
      quotationsSubmitted: currentSummary.quotationsSubmitted,
      paidQuotations: currentSummary.paidQuotations,
      conversionRate: currentSummary.conversionRate,
      reportedPayments: toNumber(paymentOps.reported_payments),
      overdueReportedPayments: toNumber(paymentOps.overdue_reported_payments),
      welcomeEmailIssues: toNumber(paymentOps.welcome_email_issues),
      financeConfirmedPayments: toNumber(paymentOps.finance_confirmed_payments),
      trends: {
        revenue: percentChange(currentSummary.revenue, previousSummary.revenue),
        pipelineValue: percentChange(currentSummary.pipelineValue, previousSummary.pipelineValue),
        totalLeads: currentSummary.totalLeads - previousSummary.totalLeads,
        conversionRate: Math.round((currentSummary.conversionRate - previousSummary.conversionRate) * 10) / 10,
      },
    },
    revenueTrend,
    pipelineFunnel,
    agentPerformance: agents.slice(0, 6).map((agent) => ({
      userId: agent.id,
      displayName: agent.displayName || agent.email,
      email: agent.email,
      assignedLeads: agent.metrics.assignedLeads,
      conversionRate: agent.metrics.conversionRate,
      pipelineValue: agent.metrics.pipelineValue,
      revenue: agent.metrics.revenue,
    })),
    topQuotedProducts: topProducts,
    recentActivity,
    staleLeads: rowsToCamel(staleRows).map((lead: any) => ({
      ...lead,
      updatedAt: toIso(lead.updatedAt),
    })),
  };
}

export async function listOversightAgents({ days = 30 }: any = {}) {
  const bounds = resolvePeriodBounds(days);
  const agents = await listSalesUsers();
  const results = [];

  for (const agent of agents) {
    const metrics = await loadAgentMetrics(agent.email, agent.id, bounds);
    results.push({
      ...agent,
      metrics,
    });
  }

  return results.sort((a, b) => b.metrics.revenue - a.metrics.revenue);
}

async function loadLeadOversightRows(userId: any) {
  const rows = await selectLeadOversightRows(userId);

  return rows.map((row) => {
    const lead = rowToCamel(row);
    const quotedProducts = Array.isArray(lead!.quotedProducts) ? lead!.quotedProducts : [];
    const purchasedProducts = Array.isArray(lead!.purchasedProducts) ? lead!.purchasedProducts : [];
    const lastActivity = lead!.lastQuotationAt || lead!.updatedAt;

    return {
      id: lead!.id,
      tenantId: lead!.tenantId,
      companyName: lead!.companyName || "",
      status: lead!.status,
      assignedAt: toIso(lead!.assignedAt),
      updatedAt: toIso(lead!.updatedAt),
      createdAt: toIso(lead!.createdAt),
      lastActivityAt: toIso(lastActivity),
      latestQuotationStatus: lead!.latestQuotationStatus || null,
      purchased: purchasedProducts.length > 0 || lead!.status === PAID_STATUS,
      quotedProducts,
      purchasedProducts,
      revenue: toNumber(lead!.paidRevenue),
    };
  });
}

export async function getOversightAgentDetail(userId: any, { days = 30 }: any = {}) {
  const agent = await getUserById(userId);
  if (!agent || ((agent as any).role !== "sales" && (agent as any).role !== "sales_admin")) {
    return null;
  }

  const bounds = resolvePeriodBounds(days);
  const metrics = await loadAgentMetrics((agent as any).email, (agent as any).id, bounds);
  const leads = await loadLeadOversightRows((agent as any).id);
  const productMixRows = await selectAgentProductMix((agent as any).email, bounds.since, bounds.until);

  return {
    agent: {
      id: (agent as any).id,
      email: (agent as any).email,
      displayName: (agent as any).displayName || (agent as any).email,
      phone: (agent as any).phone || "",
      department: (agent as any).department || "",
      isActive: (agent as any).isActive !== false,
    },
    days: bounds.days,
    metrics,
    leads,
    productMix: productMixRows.map((row) => ({
      productId: row.product_id,
      quotedCount: toNumber(row.quoted_count),
      purchasedCount: toNumber(row.purchased_count),
    })),
  };
}

export async function getOversightLeadDetail(leadId: any) {
  const { syncLeadCustomerFulfillment } = await import("../payments/leadFulfillment.js");
  await syncLeadCustomerFulfillment(leadId);

  const lead = await getLeadById(leadId);
  if (!lead) {
    return null;
  }

  let assignedAgent = null;
  if (lead.assignedUserId) {
    const user = await getUserById(lead.assignedUserId);
    if (user) {
      assignedAgent = {
        id: (user as any).id,
        email: (user as any).email,
        displayName: (user as any).displayName || (user as any).email,
      };
    }
  }

  const assignmentHistory = await selectLeadAssignmentHistory(leadId);
  const quotationRows = await selectLeadQuotations(leadId);

  return {
    lead,
    assignedAgent,
    assignmentHistory: rowsToCamel(assignmentHistory).map((entry: any) => ({
      ...entry,
      createdAt: toIso(entry.createdAt),
    })),
    quotations: rowsToCamel(quotationRows).map((entry: any) => ({
      ...entry,
      submittedAt: toIso(entry.submittedAt),
      grandTotal: toNumber(entry.grandTotal),
    })),
  };
}

export async function reassignLead(leadId: any, toUserId: any, { assignedByUserId, reason = "" }: any = {}) {
  const targetUser = await getUserById(toUserId);
  if (!targetUser || (targetUser as any).role !== "sales" || (targetUser as any).isActive === false) {
    throw new Error("Target user must be an active sales agent.");
  }

  const lead = await assignLead(leadId, toUserId, ({ assignedByUserId, reason } as any));
  if (!lead) {
    throw new Error("Lead not found.");
  }

  return lead;
}

export async function reassignAllLeadsFromUser(
  fromUserId: any,
  toUserId: any,
  { assignedByUserId, reason = "" }: any = {},
) {
  const targetUser = await getUserById(toUserId);
  if (!targetUser || (targetUser as any).role !== "sales" || (targetUser as any).isActive === false) {
    throw new Error("Target user must be an active sales agent.");
  }

  const fromUser = await getUserById(fromUserId);
  if (!fromUser) {
    throw new Error("Source user not found.");
  }

  return reassignAllLeadsOwnedByUser(fromUserId, toUserId, ({ assignedByUserId, reason } as any));
}

export async function listUnassignedLeads() {
  const rows = await selectUnassignedLeads();
  return rowsToCamel(rows).map((lead: any) => ({
    ...lead,
    sourceType: lead.sourceType || lead.source_type || "sales",
    createdAt: toIso(lead.createdAt),
    updatedAt: toIso(lead.updatedAt),
  }));
}

export async function logExportAudit({
  exportedByUserId = null,
  exportedByEmail,
  exportedByRole,
  agentUserId = null,
  agentEmail = "",
  agentName = "",
  format,
  scope,
  rowCount = 0,
  fileName = "",
}: any) {
  const row = await insertExportAuditLog([
    exportedByUserId || null,
    exportedByEmail,
    exportedByRole,
    agentUserId || null,
    agentEmail || "",
    agentName || "",
    format,
    scope,
    Number(rowCount) || 0,
    fileName || "",
  ]);

  const entry = rowToCamel(row);
  return {
    ...entry,
    createdAt: toIso(entry!.createdAt),
  };
}
