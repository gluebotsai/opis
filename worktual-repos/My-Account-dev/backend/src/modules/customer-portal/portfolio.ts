import { pool } from "../../db/pool.js";
import { PRODUCT_CATALOG, getProductName } from "../../lib/productCatalog.js";
import { listOrganizations } from "../organizations/organization-store.js";
import { listSubscriptionsByOrganization } from "../subscriptions/subscription-store.js";
import { getUsageMetricsForSubscription } from "../usage/usage-store.js";
import { listUpcomingRenewals } from "../renewals/renewal-store.js";
import { LEAD_STATUSES, QUOTATION_STATUSES } from "../../lib/statuses.js";
import {
  selectLeadStatusesByIds,
  selectOrganizationLeadIdsByCreator,
} from "../../repositories/raw/customerHub.repo.js";
import { countPendingFinanceQuotations } from "../../repositories/raw/quotations.repo.js";

/**
 * Customers module membership — also drives Sales overview **Total customers** KPI.
 * Includes Paid / Partially paid, and any org already converted (`lifecycleStatus=active`)
 * even when lead status temporarily reflects an open quote (Approved / Pending / etc.).
 * Prospect orgs (first-time / Temporary Lead pre-payment) still require Paid / Partially paid.
 */
export function isPaidCustomer(customer: any) {
  if (customer.lifecycleStatus === "active") {
    return true;
  }
  return (
    customer.status === LEAD_STATUSES.PAID ||
    customer.status === LEAD_STATUSES.PARTIALLY_PAID
  );
}

/** Same membership as Customers list — use for Total customers KPI. */
export function countTotalCustomers(customers: any[] = []) {
  return customers.filter(isPaidCustomer).length;
}

function buildStatusRowsFromCustomers(customers: any) {
  const counts = new Map();
  for (const customer of customers) {
    const status = customer.status || LEAD_STATUSES.PAID;
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => left.status.localeCompare(right.status));
}

function estimateMonthlyFromSubscription(subscription: any) {
  if (subscription.mrr !== null && Number.isFinite(subscription.mrr)) {
    return subscription.mrr;
  }
  return 0;
}

function startOfLocalDay(value: any) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Calendar days from today to renewsAt (not a fixed 30-day month length). */
function computeDaysRemaining(renewsAt: any) {
  if (!renewsAt) {
    return null;
  }
  const due = new Date(renewsAt);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.max(
    0,
    Math.round((startOfLocalDay(due).getTime() - startOfLocalDay(new Date()).getTime()) / MS_PER_DAY),
  );
}

function formatLocationLabel(locations: any, branchId: any) {
  if (!branchId) {
    return "Head office";
  }

  const match = (locations || []).find(
    (location: any) => String(location.id) === String(branchId),
  );
  return match?.label || "Branch";
}

function enrichRenewals(renewals: any, customers: any) {
  const customerByOrgId = new Map(customers.map((customer: any) => [customer.organizationId, customer]));

  return renewals.map((renewal: any) => {
    const customer = customerByOrgId.get(renewal.organizationId);
    const subscription = (customer as any)?.subscriptions?.find(
      (entry: any) => entry.id === renewal.subscriptionId,
    );
    const renewsAt = renewal.dueAt || subscription?.renewsAt || null;

    return {
      ...renewal,
      leadId: (customer as any)?.leadId || null,
      productName: getProductName(renewal.productId),
      branchLabel: formatLocationLabel((customer as any)?.locations, subscription?.branchId),
      daysRemaining: computeDaysRemaining(renewsAt) ?? 0,
      renewsAt,
    };
  });
}

async function countPendingFinanceReview({ createdByUserId = null }: any = {}) {
  return countPendingFinanceQuotations(pool, {
    ownedByUserId: createdByUserId,
    pendingStatus: QUOTATION_STATUSES.PENDING,
  });
}

async function getLeadStatusMap(leadIds: any[] = []) {
  if (!leadIds.length) {
    return new Map();
  }

  const client = await pool.connect();
  try {
    const rows = await selectLeadStatusesByIds(client, leadIds);
    return new Map(rows.map((row: any) => [row.id, row.status]));
  } finally {
    client.release();
  }
}

export async function listCustomersWithSubscriptions({ createdByUserId = null }: any = {}) {
  const allOrganizations = await listOrganizations();
  let organizations = allOrganizations;

  if (createdByUserId) {
    const client = await pool.connect();
    try {
      const rows = await selectOrganizationLeadIdsByCreator(client, createdByUserId);
      const allowedLeadIds = new Set(rows.map((row: any) => row.source_lead_id));
      organizations = allOrganizations.filter((org) => allowedLeadIds.has(org.sourceLeadId));
    } finally {
      client.release();
    }
  }

  const customers = [];
  const leadIds = organizations.map((org) => org.sourceLeadId).filter(Boolean);
  const leadStatusMap = await getLeadStatusMap(leadIds);

  for (const org of organizations) {
    const subscriptions = await listSubscriptionsByOrganization(org.id);
    const customer = {
      organizationId: org.id,
      leadId: org.sourceLeadId,
      tenantId: org.tenantId,
      companyName: org.companyName || "",
      contactName: org.contactName || "",
      workEmail: org.workEmail || "",
      status:
        leadStatusMap.get(org.sourceLeadId) ||
        (org.lifecycleStatus === "active" ? LEAD_STATUSES.PAID : "New"),
      lifecycleStatus: org.lifecycleStatus || "active",
      convertedAt: org.convertedAt,
      customerSince: org.convertedAt,
      locations: org.locations || [],
      subscriptions,
      activeProductCount: subscriptions.filter((s: any) => s.status === "active").length,
      monthlyRecurring: subscriptions
        .filter((sub: any) => sub.status === "active")
        .reduce((sum: any, sub: any) => sum + estimateMonthlyFromSubscription(sub), 0),
    };

    if (!isPaidCustomer(customer)) {
      continue;
    }

    customers.push(customer);
  }

  return customers;
}

export async function buildCustomerPortfolio({ createdByUserId = null }: any = {}) {
  const customers = await listCustomersWithSubscriptions({ createdByUserId });
  const renewals = await listUpcomingRenewals({ withinDays: 30 });
  const customerOrgIds = new Set(customers.map((customer) => customer.organizationId));
  const scopedRenewals = renewals.filter((renewal: any) =>
    customerOrgIds.has(renewal.organizationId),
  );
  // Count open finance-pending quotations (not lead status). Existing customers stay
  // Paid while a new quote awaits finance — lead-status counting missed those.
  const pendingFinanceReview = await countPendingFinanceReview({ createdByUserId });
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
      (productAdoption as any)[subscription.productId] =
        ((productAdoption as any)[subscription.productId] || 0) + 1;

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
  const statusRows = buildStatusRowsFromCustomers(enrichedCustomers);

  const productAdoptionRows = PRODUCT_CATALOG.map((product) => ({
    productId: product.id,
    productName: getProductName(product.id),
    count: (productAdoption as any)[product.id] || 0,
  }));

  return {
    summary: {
      // Matches Customers module list length (isPaidCustomer), including Partially paid /
      // awaiting-payment accounts — not Paid-only.
      totalCustomers: countTotalCustomers(enrichedCustomers),
      activeCustomers: enrichedCustomers.filter((c) => c.isActive).length,
      totalActiveProducts,
      portfolioMrr: totalMonthlyRecurring,
      currency: enrichedCustomers[0]?.subscriptions[0]?.entitlementConfig?.currency || "INR",
      renewalsSoon: scopedRenewals.length,
      pendingFinanceReview,
    },
    customers: enrichedCustomers,
    statusRows: statusRows.length
      ? statusRows
      : [{ status: LEAD_STATUSES.PAID, count: 0 }],
    productAdoption: productAdoptionRows,
    productAdoptionRows,
    renewals: enrichRenewals(scopedRenewals, customers),
  };
}

export async function getCustomerByOrganizationId(organizationId: any) {
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
