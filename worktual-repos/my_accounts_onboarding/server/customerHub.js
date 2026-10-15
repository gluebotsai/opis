import { pool } from "./db/pool.js";
import { getProductName } from "../src/lib/productCatalog.js";
import { listOrganizations } from "./organizations.js";
import { listSubscriptionsByOrganization } from "./subscriptions.js";
import { getUsageMetricsForSubscription } from "./usageMetrics.js";
import { listUpcomingRenewals } from "./renewals.js";
import { selectLeadStatusCounts } from "./repositories/functions/analytics.repo.js";
import {
  selectLeadStatusesByIds,
  selectOrganizationLeadIdsByCreator,
} from "./repositories/raw/customerHub.repo.js";

function estimateMonthlyFromSubscription(subscription) {
  if (subscription.mrr !== null && Number.isFinite(subscription.mrr)) {
    return subscription.mrr;
  }
  return 0;
}

function computeDaysRemaining(renewsAt) {
  if (!renewsAt) {
    return null;
  }
  const due = new Date(renewsAt);
  const now = new Date();
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatLocationLabel(locations, locationId) {
  if (!locationId) {
    return "Head office";
  }

  const match = (locations || []).find(
    (location) => String(location.id) === String(locationId),
  );
  return match?.label || "Branch";
}

function enrichRenewals(renewals, customers) {
  const customerByOrgId = new Map(customers.map((customer) => [customer.organizationId, customer]));

  return renewals.map((renewal) => {
    const customer = customerByOrgId.get(renewal.organizationId);
    const subscription = customer?.subscriptions?.find(
      (entry) => entry.id === renewal.subscriptionId,
    );
    const renewsAt = renewal.dueAt || subscription?.renewsAt || null;

    return {
      ...renewal,
      leadId: customer?.leadId || null,
      productName: getProductName(renewal.productId),
      branchLabel: formatLocationLabel(customer?.locations, subscription?.locationId),
      daysRemaining: computeDaysRemaining(renewsAt) ?? 0,
      renewsAt,
    };
  });
}

async function getLeadStatusSummary({ createdByUserId = null } = {}) {
  return selectLeadStatusCounts(null, createdByUserId);
}

async function getLeadStatusMap(leadIds = []) {
  if (!leadIds.length) {
    return new Map();
  }

  const client = await pool.connect();
  try {
    const rows = await selectLeadStatusesByIds(client, leadIds);
    return new Map(rows.map((row) => [row.id, row.status]));
  } finally {
    client.release();
  }
}

export async function listCustomersWithSubscriptions({ createdByUserId = null } = {}) {
  const allOrganizations = await listOrganizations();
  let organizations = allOrganizations;

  if (createdByUserId) {
    const client = await pool.connect();
    try {
      const rows = await selectOrganizationLeadIdsByCreator(client, createdByUserId);
      const allowedLeadIds = new Set(rows.map((row) => row.source_lead_id));
      organizations = allOrganizations.filter((org) => allowedLeadIds.has(org.sourceLeadId));
    } finally {
      client.release();
    }
  }

  const customers = [];
  const leadStatusMap = await getLeadStatusMap(
    organizations.map((org) => org.sourceLeadId).filter(Boolean),
  );

  for (const org of organizations) {
    const subscriptions = await listSubscriptionsByOrganization(org.id);
    customers.push({
      organizationId: org.id,
      leadId: org.sourceLeadId,
      domainId: org.domainId,
      companyName: org.companyName || "",
      contactName: org.contactName || "",
      workEmail: org.workEmail || "",
      status: leadStatusMap.get(org.sourceLeadId) || "Paid",
      lifecycleStatus: org.lifecycleStatus || "active",
      convertedAt: org.convertedAt,
      customerSince: org.convertedAt,
      locations: org.locations || [],
      subscriptions,
      activeProductCount: subscriptions.filter((s) => s.status === "active").length,
      monthlyRecurring: subscriptions
        .filter((sub) => sub.status === "active")
        .reduce((sum, sub) => sum + estimateMonthlyFromSubscription(sub), 0),
    });
  }

  return customers;
}

export async function buildCustomerPortfolio({ createdByUserId = null } = {}) {
  const customers = await listCustomersWithSubscriptions({ createdByUserId });
  const renewals = await listUpcomingRenewals({ withinDays: 30 });
  const statusRows = await getLeadStatusSummary({ createdByUserId });
  const pendingFinanceReview =
    statusRows.find((row) => row.status === "Pending Finance Review")?.count ?? 0;
  const productAdoption = {};
  let totalMonthlyRecurring = 0;
  let totalActiveProducts = 0;

  const enrichedCustomers = [];

  for (const customer of customers) {
    totalMonthlyRecurring += customer.monthlyRecurring;
    totalActiveProducts += customer.activeProductCount;

    let usageTotal = 0;
    let usageCount = 0;
    let nextRenewalDays = null;

    for (const subscription of customer.subscriptions) {
      productAdoption[subscription.productId] =
        (productAdoption[subscription.productId] || 0) + 1;

      const metrics = await getUsageMetricsForSubscription(subscription.id);
      for (const metric of metrics) {
        if (metric.allocated > 0) {
          usageTotal += Math.min(100, (metric.consumed / metric.allocated) * 100);
          usageCount += 1;
        }
      }

      const days = computeDaysRemaining(subscription.renewsAt);
      if (days !== null && (nextRenewalDays === null || days < nextRenewalDays)) {
        nextRenewalDays = days;
      }
    }

    enrichedCustomers.push({
      ...customer,
      leadId: customer.leadId,
      locationCount: customer.locations?.length || 0,
      avgUsagePercent: usageCount > 0 ? Math.round(usageTotal / usageCount) : 0,
      nextRenewalDays,
      isActive: customer.lifecycleStatus === "active",
    });
  }

  enrichedCustomers.sort((left, right) => right.monthlyRecurring - left.monthlyRecurring);

  return {
    summary: {
      totalCustomers: enrichedCustomers.length,
      activeCustomers: enrichedCustomers.filter((c) => c.isActive).length,
      totalActiveProducts,
      portfolioMrr: totalMonthlyRecurring,
      currency: enrichedCustomers[0]?.subscriptions[0]?.entitlementConfig?.currency || "INR",
      renewalsSoon: renewals.length,
      pendingFinanceReview,
    },
    customers: enrichedCustomers,
    statusRows: statusRows.length
      ? statusRows
      : [{ status: "Paid", count: enrichedCustomers.length }],
    productAdoption: Object.entries(productAdoption).map(([productId, count]) => ({
      productId,
      count,
    })),
    renewals: enrichRenewals(renewals, customers),
  };
}

export async function getCustomerByOrganizationId(organizationId) {
  const organizations = await listOrganizations();
  const org = organizations.find((entry) => entry.id === organizationId);
  if (!org) {
    return null;
  }

  const subscriptions = await listSubscriptionsByOrganization(organizationId);
  return {
    organization: org,
    subscriptions,
  };
}
