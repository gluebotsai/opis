import { subscriptionKey } from "./subscription-key.js";
import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { ensureOrganizationForPaidLead } from "../organizations/organization-store.js";
import { isBranchInactive } from "../branch-requests/lifecycle.js";
import { shouldSkipCancelledSubscriptionResurrection } from "./resurrection.js";
import { seedUsageMetricsForSubscription } from "../usage/usage-store.js";
import { scheduleRenewalForSubscription, maybeCreateImmediateRenewalQuotation, completeRenewal } from "../renewals/renewal-store.js";
import { createInitialSubscriptionInvoices } from "../billing/subscriptionInvoices.js";
import {
  DEFAULT_PURCHASE_CUTOFF_DAY,
  isPurchaseOnOrBefore20th,
} from "../billing/dates.js";
import { buildGoLiveServiceSchedule } from "../billing/goLiveSchedule.js";
import { resolveSkipInvoiceProration } from "../../lib/proration.js";
import {
  resolveCcaasNumberEntitlementCounts,
  syncCcaasNumberEntitlementFields,
} from "../../lib/ccaasConfiguration.js";
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
  selectSubscriptionByKey,
} from "../../repositories/raw/subscriptions.repo.js";

/** Dedicated subscription count columns synced from CCaaS (and zeroed for others). */
function resolveSubscriptionNumberCounts(productId: any, config: any = {}) {
  if (productId === "contact-center" || config.pricingMode === "ccaas") {
    const counts = resolveCcaasNumberEntitlementCounts(config);
    return {
      agentCount: counts.agentCount,
      includedNumberCount: counts.includedNumberCount,
      queueCapacityCount: counts.queueCapacityCount,
      totalNumberCount: counts.totalNumberEntitlement,
    };
  }
  return {
    agentCount: 0,
    includedNumberCount: 0,
    queueCapacityCount: 0,
    totalNumberCount: 0,
  };
}

function prepareSubscriptionConfig(productId: any, config: any = {}) {
  let next = { ...config, productId: config.productId || productId };
  if (productId === "contact-center" || next.pricingMode === "ccaas") {
    next = syncCcaasNumberEntitlementFields({ ...next, pricingMode: "ccaas" });
  }
  if (productId === "campaign" || next.pricingMode === "campaign") {
    next = {
      ...next,
      numberCount: "0",
      numberRate: "0",
      additionalNumbersEnabled: false,
      additionalNumberCount: "0",
      additionalNumberRate: "0",
    };
  }
  return next;
}

function computeRenewsAt(approvedAt: any, config: any) {
  const base = approvedAt ? new Date(approvedAt) : new Date();
  const billingCycle = config?.billingCycle === "yearly" ? "yearly" : "monthly";
  if (billingCycle === "yearly") {
    const renews = new Date(base);
    renews.setDate(renews.getDate() + 365);
    return renews;
  }

  // First monthly period runs through month-end; next cycle starts the following month.
  return new Date(base.getFullYear(), base.getMonth() + 1, 1);
}

function computeGoLiveRenewsAt(config: any, cutoffDay = DEFAULT_PURCHASE_CUTOFF_DAY) {
  if (config?.goLiveRenewsAt) {
    const stamped = new Date(config.goLiveRenewsAt);
    if (!Number.isNaN(stamped.getTime())) {
      return stamped;
    }
  }
  const anchor = config?.goLiveAcceptedAt || new Date();
  const skipProration = resolveSkipInvoiceProration(config || {});
  const schedule = buildGoLiveServiceSchedule({
    anchorDate: anchor,
    skipProration,
    periodStart: config?.periodStart || null,
    periodEnd: config?.periodEnd || null,
    cutoffDay,
  });
  return schedule.renewsAt;
}

function resolveRenewsAt({
  changeType,
  approvedAt,
  config,
  existingRenewsAt,
  cutoffDay = DEFAULT_PURCHASE_CUTOFF_DAY,
}: any) {
  if (changeType === "addon" && existingRenewsAt) {
    return new Date(existingRenewsAt);
  }
  if (changeType === "go_live") {
    return computeGoLiveRenewsAt(config, cutoffDay);
  }
  return computeRenewsAt(approvedAt, config);
}

async function finalizeSubscriptionBilling(client: any, {
  subscription,
  renewsAt,
  changeType,
  config,
  paidAt,
  approvedAt,
  invoicesBySubscription,
  deferredImmediateRenewals = null,
}: any) {
  await scheduleRenewalForSubscription(client, subscription.id, renewsAt);

  if (changeType === "upgrade" || changeType === "renewal" || config.isRenewalQuote === true) {
    await completeRenewal(subscription.id, client);
  }

  const purchaseDate =
    changeType === "go_live"
      ? config.goLiveAcceptedAt || approvedAt || paidAt
      : paidAt || approvedAt;
  const invoices = await createInitialSubscriptionInvoices(client, subscription, {
    purchaseDate,
  });
  if (invoices.length > 0) {
    invoicesBySubscription[subscription.id] = invoices;
  }

  const cutoffDay =
    Number(config.purchaseCutoffDay) || DEFAULT_PURCHASE_CUTOFF_DAY;
  if (
    (changeType === "new" || changeType === "upgrade" || changeType === "go_live") &&
    changeType !== "renewal" &&
    !config.isRenewalQuote &&
    !isPurchaseOnOrBefore20th(purchaseDate, cutoffDay)
  ) {
    // Creating renewal quotes inside the fulfillment TX holds org/subscription locks while
    // createQuotationsForFinance waits on other rows — lock_timeout (~15s) hangs mark-paid.
    // Defer until after the fulfillment transaction commits.
    if (Array.isArray(deferredImmediateRenewals)) {
      deferredImmediateRenewals.push({ subscription, purchaseDate });
    } else {
      void maybeCreateImmediateRenewalQuotation(subscription, purchaseDate).catch((error) => {
        console.warn(
          `[renewals] Immediate renewal quote failed for subscription ${subscription.id}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }
}

function estimateMrr(config: any) {
  if (!config || typeof config !== "object") {
    return 0;
  }

  const stamped = Number(config.finalMonthlyTotal || config.coreMonthlyAmount || 0);
  if (Number.isFinite(stamped) && stamped > 0) {
    return stamped;
  }

  if (config.pricingMode === "ccaas" && config.modules) {
    let total = 0;
    for (const selection of Object.values(config.modules)) {
      const price = Number((selection as any)?.price);
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

function wasImplementationPurchased(config: any) {
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

function mapSubscriptionRow(row: any) {
  const entry = rowToCamel(row);
  return {
    id: (entry as any).id,
    key: (entry as any).key,
    organizationId: (entry as any).organizationId,
    sourceLeadId: (entry as any).sourceLeadId,
    productId: (entry as any).productId,
    branchId: (entry as any).branchId,
    billingBranchId: (entry as any).billingBranchId,
    status: (entry as any).status || "active",
    changeType: (entry as any).changeType || "new",
    entitlementConfig: (entry as any).entitlementConfig || null,
    priceLabel: (entry as any).priceLabel || "",
    implementationPurchased: (entry as any).implementationPurchased === true,
    mrr: (entry as any).mrr !== null ? Number((entry as any).mrr) : null,
    startsAt: toIso((entry as any).startsAt),
    renewsAt: toIso((entry as any).renewsAt),
    approvedAt: toIso((entry as any).approvedAt),
    paymentConfirmedAt: toIso((entry as any).paymentConfirmedAt),
    quotationId: (entry as any).quotationId || null,
    sourcePurchaseOrderId: (entry as any).sourcePurchaseOrderId || null,
    cancelledAt: toIso((entry as any).cancelledAt),
    cancelledBy: (entry as any).cancelledBy || "",
    cancellationReason: (entry as any).cancellationReason || "",
    cancelAtPeriodEnd: (entry as any).cancelAtPeriodEnd === true,
    cancelEffectiveAt: toIso((entry as any).cancelEffectiveAt),
    scheduledCancellationRequestId: (entry as any).scheduledCancellationRequestId || null,
    createdAt: toIso((entry as any).createdAt),
    updatedAt: toIso((entry as any).updatedAt),
  };
}

export async function getSubscriptionById(subscriptionId: any, client = null) {
  const runner = client || pool;
  const row = await selectSubscriptionById(runner, subscriptionId);
  return row ? mapSubscriptionRow(row) : null;
}

export async function listSubscriptionsByOrganization(organizationId: any, client = null) {
  const runner = client || pool;
  const rows = await selectSubscriptionsByOrganization(runner, organizationId);
  return rows.map(mapSubscriptionRow);
}

export async function listSubscriptionsByLeadId(leadId: any, client = null) {
  const runner = client || pool;
  const rows = await selectSubscriptionsByLeadId(runner, leadId);
  return rows.map(mapSubscriptionRow);
}

async function loadQuotationAssignments(client: any, quotationId: any) {
  const rows = await selectQuotationAssignments(client, quotationId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      id: (entry as any).id,
      productId: (entry as any).productId,
      branchId: (entry as any).branchId,
      billingBranchId: (entry as any).billingBranchId,
      changeType: (entry as any).changeType || "new",
      config: (entry as any).config || null,
    };
  });
}

async function loadProductSummary(client: any, quotationId: any) {
  const rows = await selectProductSummaryItems(client, quotationId);

  return rows.map((row: any) => ({
    productId: row.product_id,
    priceLabel: row.price_label || "",
  }));
}

async function upsertPurchaseOrder(client: any, organizationId: any, leadId: any, quotationId: any, paidAt: any) {
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
export async function syncSubscriptionsFromQuotation(quotationId: any, client: any, { paidAt = null } = {}) {
  const quotationRow = await selectQuotationRow(client, quotationId);

  if (!quotationRow) {
    return { synced: false, reason: "quotation_not_found" };
  }

  const quotation = rowToCamel(quotationRow);
  const leadId = (quotation as any).leadId;

  const { organization } = await ensureOrganizationForPaidLead(leadId, client);
  const purchaseOrder = await upsertPurchaseOrder(
    client,
    organization.id,
    leadId,
    quotationId,
    paidAt || (quotation as any).reviewedAt,
  );

  const assignments = await loadQuotationAssignments(client, quotationId);
  const productSummary = await loadProductSummary(client, quotationId);
  const approvedAt = (quotation as any).reviewedAt || (quotation as any).submittedAt || new Date().toISOString();
  const synced = [];
  const invoicesBySubscription = {};
  const deferredImmediateRenewals: any[] = [];

  await deleteSubscriptionItemsForPurchaseOrder(client, (purchaseOrder as any).id);

  for (const assignment of assignments) {
    const branchId = assignment.branchId || "hq";
    const billingBranchId = branchId;
    const key = subscriptionKey(organization.id, assignment.productId, branchId);
    const config = prepareSubscriptionConfig(assignment.productId, assignment.config || {});
    const numberCounts = resolveSubscriptionNumberCounts(assignment.productId, config);
    const changeType = assignment.changeType || "new";
    const priceLabel =
      productSummary.find((item: any) => item.productId === assignment.productId)?.priceLabel || "";
    const mrr = estimateMrr(config);
    const existingRow = await selectSubscriptionByKey(client, key);

    if (shouldSkipCancelledSubscriptionResurrection(existingRow, quotationId)) {
      continue;
    }
    if (await isBranchInactive(client, organization.id, branchId)) {
      continue;
    }

    const renewsAt = resolveRenewsAt({
      changeType,
      approvedAt,
      config,
      existingRenewsAt: existingRow?.renews_at || existingRow?.renewsAt,
    });

    const subRow = await upsertSubscriptionRow(client, [
      key,
      organization.id,
      leadId,
      assignment.productId,
      branchId,
      billingBranchId,
      changeType,
      JSON.stringify(config),
      priceLabel,
      wasImplementationPurchased(config),
      mrr,
      approvedAt,
      renewsAt.toISOString(),
      approvedAt,
      paidAt,
      quotationId,
      (purchaseOrder as any).id,
      numberCounts.agentCount,
      numberCounts.includedNumberCount,
      numberCounts.queueCapacityCount,
      numberCounts.totalNumberCount,
    ]);

    if (!subRow || subRow.status === "cancelled") {
      continue;
    }

    const subscription = mapSubscriptionRow(subRow);

    const existingEntitlement = await selectSubscriptionEntitlementExists(
      client,
      subscription.id,
      (purchaseOrder as any).id,
    );

    if (!existingEntitlement) {
      await insertSubscriptionEntitlementRow(client, [
        subscription.id,
        config.schemaVersion || 1,
        JSON.stringify(config),
        changeType,
        paidAt || approvedAt,
        (purchaseOrder as any).id,
      ]);
    }

    await insertSubscriptionItemRow(client, [
      (purchaseOrder as any).id,
      subscription.id,
      assignment.productId,
      branchId,
      changeType,
      JSON.stringify(config),
    ]);

    await seedUsageMetricsForSubscription(client, subscription.id, {
      ...config,
      productId: assignment.productId,
    });
    await finalizeSubscriptionBilling(client, {
      subscription,
      renewsAt,
      changeType,
      config,
      paidAt,
      approvedAt,
      invoicesBySubscription,
      deferredImmediateRenewals,
    });

    synced.push(subscription);
  }

  const { resyncOrganizationCustomerGrants } = await import("../customer-portal/customer-auth.js");
  await resyncOrganizationCustomerGrants(client, organization.id);

  return {
    synced: true,
    organizationId: organization.id,
    purchaseOrderId: (purchaseOrder as any).id,
    count: synced.length,
    subscriptions: synced,
    invoicesBySubscription,
    deferredImmediateRenewals,
  };
}

function assignmentMatchesBillingTarget(assignment: any, billingBranchId: any) {
  const branchId = assignment.branchId || "hq";
  return branchId === billingBranchId;
}

/**
 * Sync subscriptions for a single billing target / branch on partial payment.
 */
export async function syncSubscriptionsForBillingTarget(
  quotationId: any,
  billingBranchId: any,
  client: any,
  { paidAt = null } = {},
) {
  const quotationRow = await selectQuotationRow(client, quotationId);

  if (!quotationRow) {
    return { synced: false, reason: "quotation_not_found" };
  }

  const quotation = rowToCamel(quotationRow);
  const leadId = (quotation as any).leadId;
  const { organization } = await ensureOrganizationForPaidLead(leadId, client);
  const purchaseOrder = await upsertPurchaseOrder(
    client,
    organization.id,
    leadId,
    quotationId,
    paidAt || (quotation as any).reviewedAt,
  );

  const assignments = (await loadQuotationAssignments(client, quotationId)).filter((assignment: any) =>
    assignmentMatchesBillingTarget(assignment, billingBranchId),
  );

  if (!assignments.length) {
    return { synced: false, reason: "no_assignments_for_branch" };
  }

  const productSummary = await loadProductSummary(client, quotationId);
  const approvedAt = (quotation as any).reviewedAt || (quotation as any).submittedAt || new Date().toISOString();
  const synced = [];
  const invoicesBySubscription = {};
  const deferredImmediateRenewals: any[] = [];

  for (const assignment of assignments) {
    const branchId = assignment.branchId || "hq";
    const key = subscriptionKey(organization.id, assignment.productId, branchId);
    const config = prepareSubscriptionConfig(assignment.productId, assignment.config || {});
    const numberCounts = resolveSubscriptionNumberCounts(assignment.productId, config);
    const changeType = assignment.changeType || "new";
    const priceLabel =
      productSummary.find((item: any) => item.productId === assignment.productId)?.priceLabel || "";
    const mrr = estimateMrr(config);
    const existingRow = await selectSubscriptionByKey(client, key);

    if (shouldSkipCancelledSubscriptionResurrection(existingRow, quotationId)) {
      continue;
    }
    if (await isBranchInactive(client, organization.id, branchId)) {
      continue;
    }

    const renewsAt = resolveRenewsAt({
      changeType,
      approvedAt,
      config,
      existingRenewsAt: existingRow?.renews_at || existingRow?.renewsAt,
    });

    const subRow = await upsertSubscriptionRow(client, [
      key,
      organization.id,
      leadId,
      assignment.productId,
      branchId,
      billingBranchId,
      changeType,
      JSON.stringify(config),
      priceLabel,
      wasImplementationPurchased(config),
      mrr,
      approvedAt,
      renewsAt.toISOString(),
      approvedAt,
      paidAt,
      quotationId,
      (purchaseOrder as any).id,
      numberCounts.agentCount,
      numberCounts.includedNumberCount,
      numberCounts.queueCapacityCount,
      numberCounts.totalNumberCount,
    ]);

    if (!subRow || subRow.status === "cancelled") {
      continue;
    }

    const subscription = mapSubscriptionRow(subRow);

    const existingEntitlement = await selectSubscriptionEntitlementExists(
      client,
      subscription.id,
      (purchaseOrder as any).id,
    );

    if (!existingEntitlement) {
      await insertSubscriptionEntitlementRow(client, [
        subscription.id,
        config.schemaVersion || 1,
        JSON.stringify(config),
        changeType,
        paidAt || approvedAt,
        (purchaseOrder as any).id,
      ]);
    }

    await insertSubscriptionItemRow(client, [
      (purchaseOrder as any).id,
      subscription.id,
      assignment.productId,
      branchId,
      changeType,
      JSON.stringify(config),
    ]);

    await seedUsageMetricsForSubscription(client, subscription.id, {
      ...config,
      productId: assignment.productId,
    });
    await finalizeSubscriptionBilling(client, {
      subscription,
      renewsAt,
      changeType,
      config,
      paidAt,
      approvedAt,
      invoicesBySubscription,
      deferredImmediateRenewals,
    });

    synced.push(subscription);
  }

  const { resyncOrganizationCustomerGrants } = await import("../customer-portal/customer-auth.js");
  await resyncOrganizationCustomerGrants(client, organization.id);

  return {
    synced: true,
    organizationId: organization.id,
    purchaseOrderId: (purchaseOrder as any).id,
    count: synced.length,
    subscriptions: synced,
    invoicesBySubscription,
    billingBranchId,
    deferredImmediateRenewals,
  };
}

export async function getSubscriptionEntitlements(subscriptionId: any, client = null) {
  const subscription = await getSubscriptionById(subscriptionId, client);
  if (!subscription) {
    return null;
  }

  const runner = client || pool;
  const rows = await selectSubscriptionEntitlements(runner, subscriptionId);

  return {
    subscription,
    currentConfig: subscription.entitlementConfig,
    history: rows.map((row: any) => {
      const entry = rowToCamel(row);
      return {
        id: (entry as any).id,
        schemaVersion: (entry as any).schemaVersion,
        config: (entry as any).config,
        changeType: (entry as any).changeType,
        effectiveFrom: toIso((entry as any).effectiveFrom),
        purchaseOrderId: (entry as any).purchaseOrderId,
      };
    }),
  };
}

export async function backfillSubscriptionsFromActiveProducts(client: any) {
  const rows = await selectPaidActiveProducts(client);

  let converted = 0;
  for (const row of rows) {
    const entry = rowToCamel(row);
    if (!(entry as any).quotationId) {
      continue;
    }

    try {
      await syncSubscriptionsFromQuotation((entry as any).quotationId, client, {
        paidAt: (entry as any).paymentConfirmedAt,
      });
      converted += 1;
    } catch (error) {
      console.warn(
        `[subscriptions] backfill skipped for quotation ${(entry as any).quotationId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { converted };
}
