import { subscriptionKey } from "./subscriptionKey.js";
import { pool, withTransaction } from "./db/pool.js";
import { rowToCamel, toIso } from "./db/util.js";
import { ensureOrganizationForPaidLead } from "./organizations.js";
import { seedUsageMetricsForSubscription } from "./usageMetrics.js";
import { scheduleRenewalForSubscription } from "./renewals.js";
import { createInitialSubscriptionInvoices } from "./billing/subscriptionInvoices.js";
import {
  deleteSubscriptionItemsForPurchaseOrder,
  insertSubscriptionEntitlementRow,
  insertSubscriptionItemRow,
  selectPaidActiveProducts,
  selectProductSummaryItems,
  selectQuotationAssignments,
  selectQuotationRow,
  selectSubscriptionById,
  selectSubscriptionEntitlementExists,
  selectSubscriptionEntitlements,
  selectSubscriptionsByLeadId,
  selectSubscriptionsByOrganization,
  upsertPurchaseOrderRow,
  upsertSubscriptionRow,
} from "./repositories/raw/subscriptions.repo.js";

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function computeRenewsAt(approvedAt, config) {
  const base = approvedAt ? new Date(approvedAt) : new Date();
  const billingCycle = config?.billingCycle === "yearly" ? "yearly" : "monthly";
  return billingCycle === "yearly" ? addYears(base, 1) : addMonths(base, 1);
}

function estimateMrr(config) {
  if (!config || typeof config !== "object") {
    return 0;
  }

  if (config.pricingMode === "ccaas" && config.modules) {
    let total = 0;
    for (const selection of Object.values(config.modules)) {
      const price = Number(selection?.price);
      if (Number.isFinite(price)) {
        total += price;
      }
    }
    const addons = config.addons || {};
    if (addons.sessionBundle && addons.sessionBundle !== "none") {
      total += Number(addons.sessionPrice) || 0;
    }
    if (addons.multilingualOption === "addon") {
      total += Number(addons.multilingualPrice) || 0;
    }
    return total;
  }

  const monthly = Number(config.monthlyBasePrice || config.chatbotMonthlyPrice || 0);
  if (Number.isFinite(monthly) && monthly > 0) {
    return monthly;
  }

  const users = Number(config.userCount) || 0;
  const rate = Number(config.userLicenseRate) || 0;
  if (users > 0 && rate > 0) {
    return users * rate;
  }

  return 0;
}

function wasImplementationPurchased(config) {
  if (!config) {
    return false;
  }
  if (config.implementationPurchased === true) {
    return true;
  }
  const fee =
    Number(config.implementationCost) || Number(config.implementationFee) || 0;
  return config.implementationEnabled === true && fee > 0;
}

function mapSubscriptionRow(row) {
  const entry = rowToCamel(row);
  return {
    id: entry.id,
    key: entry.key,
    organizationId: entry.organizationId,
    sourceLeadId: entry.sourceLeadId,
    productId: entry.productId,
    locationId: entry.locationId,
    billingTargetId: entry.billingTargetId,
    status: entry.status || "active",
    changeType: entry.changeType || "new",
    entitlementConfig: entry.entitlementConfig || null,
    priceLabel: entry.priceLabel || "",
    implementationPurchased: entry.implementationPurchased === true,
    mrr: entry.mrr !== null ? Number(entry.mrr) : null,
    startsAt: toIso(entry.startsAt),
    renewsAt: toIso(entry.renewsAt),
    approvedAt: toIso(entry.approvedAt),
    paymentConfirmedAt: toIso(entry.paymentConfirmedAt),
    quotationId: entry.quotationId || null,
    sourcePurchaseOrderId: entry.sourcePurchaseOrderId || null,
    cancelledAt: toIso(entry.cancelledAt),
    cancelledBy: entry.cancelledBy || "",
    cancellationReason: entry.cancellationReason || "",
    cancelAtPeriodEnd: entry.cancelAtPeriodEnd === true,
    cancelEffectiveAt: toIso(entry.cancelEffectiveAt),
    scheduledCancellationRequestId: entry.scheduledCancellationRequestId || null,
    createdAt: toIso(entry.createdAt),
    updatedAt: toIso(entry.updatedAt),
  };
}

export async function getSubscriptionById(subscriptionId, client = null) {
  const runner = client || pool;
  const row = await selectSubscriptionById(runner, subscriptionId);
  return row ? mapSubscriptionRow(row) : null;
}

export async function listSubscriptionsByOrganization(organizationId, client = null) {
  const runner = client || pool;
  const rows = await selectSubscriptionsByOrganization(runner, organizationId);
  return rows.map(mapSubscriptionRow);
}

export async function listSubscriptionsByLeadId(leadId, client = null) {
  const runner = client || pool;
  const rows = await selectSubscriptionsByLeadId(runner, leadId);
  return rows.map(mapSubscriptionRow);
}

async function loadQuotationAssignments(client, quotationId) {
  const rows = await selectQuotationAssignments(client, quotationId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      id: entry.id,
      productId: entry.productId,
      branchId: entry.branchId,
      billingTargetId: entry.billingTargetId,
      changeType: entry.changeType || "new",
      config: entry.config || null,
    };
  });
}

async function loadProductSummary(client, quotationId) {
  const rows = await selectProductSummaryItems(client, quotationId);

  return rows.map((row) => ({
    productId: row.product_id,
    priceLabel: row.price_label || "",
  }));
}

async function upsertPurchaseOrder(client, organizationId, leadId, quotationId, paidAt) {
  const row = await upsertPurchaseOrderRow(client, [
    organizationId,
    leadId,
    quotationId,
    paidAt || new Date().toISOString(),
  ]);

  return rowToCamel(row);
}

/**
 * Sync subscriptions, purchase order, entitlement history from a paid quotation.
 */
export async function syncSubscriptionsFromQuotation(quotationId, client, { paidAt = null } = {}) {
  const quotationRow = await selectQuotationRow(client, quotationId);

  if (!quotationRow) {
    return { synced: false, reason: "quotation_not_found" };
  }

  const quotation = rowToCamel(quotationRow);
  const leadId = quotation.leadId;

  const { organization } = await ensureOrganizationForPaidLead(leadId, client);
  const purchaseOrder = await upsertPurchaseOrder(
    client,
    organization.id,
    leadId,
    quotationId,
    paidAt || quotation.reviewedAt,
  );

  const assignments = await loadQuotationAssignments(client, quotationId);
  const productSummary = await loadProductSummary(client, quotationId);
  const approvedAt = quotation.reviewedAt || quotation.submittedAt || new Date().toISOString();
  const synced = [];
  const invoicesBySubscription = {};

  await deleteSubscriptionItemsForPurchaseOrder(client, purchaseOrder.id);

  for (const assignment of assignments) {
    const locationId = assignment.branchId || "hq";
    const billingTargetId = locationId;
    const key = subscriptionKey(organization.id, assignment.productId, locationId);
    const config = assignment.config || {};
    const priceLabel =
      productSummary.find((item) => item.productId === assignment.productId)?.priceLabel || "";
    const mrr = estimateMrr(config);
    const renewsAt = computeRenewsAt(approvedAt, config);

    const subRow = await upsertSubscriptionRow(client, [
      key,
      organization.id,
      leadId,
      assignment.productId,
      locationId,
      billingTargetId,
      assignment.changeType || "new",
      JSON.stringify(config),
      priceLabel,
      wasImplementationPurchased(config),
      mrr,
      approvedAt,
      renewsAt.toISOString(),
      approvedAt,
      paidAt,
      quotationId,
      purchaseOrder.id,
    ]);

    const subscription = mapSubscriptionRow(subRow);

    const existingEntitlement = await selectSubscriptionEntitlementExists(
      client,
      subscription.id,
      purchaseOrder.id,
    );

    if (!existingEntitlement) {
      await insertSubscriptionEntitlementRow(client, [
        subscription.id,
        config.schemaVersion || 1,
        JSON.stringify(config),
        assignment.changeType || "new",
        paidAt || approvedAt,
        purchaseOrder.id,
      ]);
    }

    await insertSubscriptionItemRow(client, [
      purchaseOrder.id,
      subscription.id,
      assignment.productId,
      locationId,
      assignment.changeType || "new",
      JSON.stringify(config),
    ]);

    await seedUsageMetricsForSubscription(client, subscription.id, {
      ...config,
      productId: assignment.productId,
    });
    await scheduleRenewalForSubscription(client, subscription.id, renewsAt);

    const invoices = await createInitialSubscriptionInvoices(client, subscription, {
      purchaseDate: paidAt || approvedAt,
    });
    if (invoices.length > 0) {
      invoicesBySubscription[subscription.id] = invoices;
    }

    synced.push(subscription);
  }

  const { resyncOrganizationCustomerGrants } = await import("./customerAuth.js");
  await resyncOrganizationCustomerGrants(client, organization.id);

  return {
    synced: true,
    organizationId: organization.id,
    purchaseOrderId: purchaseOrder.id,
    count: synced.length,
    subscriptions: synced,
    invoicesBySubscription,
  };
}

export async function getSubscriptionEntitlements(subscriptionId, client = null) {
  const subscription = await getSubscriptionById(subscriptionId, client);
  if (!subscription) {
    return null;
  }

  const runner = client || pool;
  const rows = await selectSubscriptionEntitlements(runner, subscriptionId);

  return {
    subscription,
    currentConfig: subscription.entitlementConfig,
    history: rows.map((row) => {
      const entry = rowToCamel(row);
      return {
        id: entry.id,
        schemaVersion: entry.schemaVersion,
        config: entry.config,
        changeType: entry.changeType,
        effectiveFrom: toIso(entry.effectiveFrom),
        purchaseOrderId: entry.purchaseOrderId,
      };
    }),
  };
}

export async function backfillSubscriptionsFromActiveProducts(client) {
  const rows = await selectPaidActiveProducts(client);

  let converted = 0;
  for (const row of rows) {
    const entry = rowToCamel(row);
    if (!entry.quotationId) {
      continue;
    }

    try {
      await syncSubscriptionsFromQuotation(entry.quotationId, client, {
        paidAt: entry.paymentConfirmedAt,
      });
      converted += 1;
    } catch (error) {
      console.warn(
        `[subscriptions] backfill skipped for quotation ${entry.quotationId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { converted };
}
