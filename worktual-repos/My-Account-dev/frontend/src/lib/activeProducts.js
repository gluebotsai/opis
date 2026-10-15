import { getInactiveLeadBranchIds } from "./leads.js";
import { goLiveStatusLabel } from "./goLive.js";

export const CHANGE_TYPES = {
  NEW: "new",
  UPGRADE: "upgrade",
  ADDON: "addon",
  RENEWAL: "renewal",
};

export const CHANGE_TYPE_OPTIONS = [
  { value: CHANGE_TYPES.NEW, label: "New purchase", description: "First time buying this product." },
  {
    value: CHANGE_TYPES.UPGRADE,
    label: "Upgrade",
    description: "Increase plan, users, or capacity on an existing subscription.",
  },
  {
    value: CHANGE_TYPES.ADDON,
    label: "Add-on",
    description: "Optional extra module alongside an existing product.",
  },
  {
    value: CHANGE_TYPES.RENEWAL,
    label: "Renewal",
    description: "Advance quotation for the next billing period.",
  },
];

export function activeProductKey(leadId, productId, branchId) {
  return `${leadId}:${productId}:${branchId}`;
}

export function getSubscriptionRenewsAt(entry) {
  if (entry?.renewsAt) {
    return new Date(entry.renewsAt);
  }

  const approvedAt = entry?.approvedAt ? new Date(entry.approvedAt) : new Date();
  const billingCycle = entry?.config?.billingCycle === "yearly" ? "yearly" : "monthly";
  if (billingCycle === "yearly") {
    const renews = new Date(approvedAt);
    renews.setDate(renews.getDate() + 365);
    return renews;
  }

  // Align with subscription-store: first monthly period runs through month-end;
  // renewsAt is the 1st of the following month (start of next cycle).
  return new Date(approvedAt.getFullYear(), approvedAt.getMonth() + 1, 1);
}

/** Paid live subscription still within the current billing window (OTC/implementing ≠ active). */
export function isActivePaidSubscription(entry, now = new Date()) {
  if (!entry?.productId || !entry?.branchId) {
    return false;
  }

  if (!entry.paymentConfirmedAt) {
    return false;
  }

  const lifecycle = entry.lifecycleStatus;
  if (
    lifecycle === "awaiting_implementation" ||
    lifecycle === "uat" ||
    lifecycle === "uat_expired" ||
    lifecycle === "awaiting_subscription_payment"
  ) {
    return false;
  }

  // OTC-paid products without a live subscription are not commercially active.
  if (!entry.subscriptionId && lifecycle !== "live") {
    return false;
  }

  return getSubscriptionRenewsAt(entry) > now;
}

/**
 * Mid-period revisit of a paid-active product at this branch (not a renewal quote).
 * Sales may only quote add-ons — base configuration stays locked.
 */
export function isMidPeriodAddonOnlyQuote(lead, productId, branchId, { renewal = false } = {}) {
  if (renewal) {
    return false;
  }

  const atBranch = getActiveAtBranch(lead, productId, branchId);
  return Boolean(atBranch && isActivePaidSubscription(atBranch));
}

export function findDuplicateNewPurchase(lead, productId, branchId) {
  const atBranch = getActiveAtBranch(lead, productId, branchId);
  if (!atBranch?.paymentConfirmedAt) {
    return null;
  }

  // Live subscription in window, or OTC/implementing slot still occupied.
  if (
    isActivePaidSubscription(atBranch) ||
    !atBranch.subscriptionId ||
    atBranch.lifecycleStatus === "awaiting_implementation" ||
    atBranch.lifecycleStatus === "uat" ||
    atBranch.lifecycleStatus === "uat_expired" ||
    atBranch.lifecycleStatus === "awaiting_subscription_payment"
  ) {
    return {
      productId,
      branchId,
      renewsAt: getSubscriptionRenewsAt(atBranch).toISOString(),
    };
  }

  return null;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** True when implementation was billed on a prior approved purchase. */
export function wasImplementationBilled(config) {
  if (!config) {
    return false;
  }

  if (config.implementationPurchased === true) {
    return true;
  }

  const hasFee = toNumber(config.implementationCost) > 0 || toNumber(config.implementationFee) > 0;
  return config.implementationEnabled === true && hasFee;
}

export function hasImplementationPurchased(lead, productId) {
  return getActiveProducts(lead).some(
    (entry) =>
      entry.productId === productId &&
      Boolean(entry.paymentConfirmedAt) &&
      (entry.implementationPurchased === true || wasImplementationBilled(entry.config)),
  );
}

export function shouldShowImplementationNote(lead, productId, changeType, { renewal = false } = {}) {
  if (renewal) {
    return false;
  }

  if (changeType === CHANGE_TYPES.NEW || changeType === CHANGE_TYPES.ADDON) {
    return false;
  }

  if (changeType !== CHANGE_TYPES.UPGRADE) {
    return false;
  }

  return hasImplementationPurchased(lead, productId);
}

export function applyPurchaseHistoryToConfig(config, lead, productId) {
  if (!config || !hasImplementationPurchased(lead, productId)) {
    return config;
  }

  return {
    ...config,
    implementationPurchased: true,
    implementationEnabled: false,
  };
}

export function resolveReturningProductConfig({
  lead,
  productId,
  branchId,
  changeType,
  createInitialConfig,
  product,
  existingAtBranch,
}) {
  if (changeType === CHANGE_TYPES.NEW || !lead) {
    const initial = product ? createInitialConfig(product) : null;
    return applyPurchaseHistoryToConfig(initial, lead, productId);
  }

  const existingAnywhere = getActiveProducts(lead).find((entry) => entry.productId === productId);
  const sourceConfig = existingAtBranch?.config || existingAnywhere?.config;

  if (sourceConfig) {
    return applyPurchaseHistoryToConfig({ ...sourceConfig }, lead, productId);
  }

  const initial = product ? createInitialConfig(product) : null;
  return applyPurchaseHistoryToConfig(initial, lead, productId);
}

export function getImplementationPurchaseNote(lead, productId) {
  const entry = getActiveProducts(lead).find(
    (item) =>
      item.productId === productId &&
      Boolean(item.paymentConfirmedAt) &&
      (item.implementationPurchased === true || wasImplementationBilled(item.config)),
  );

  if (!entry?.approvedAt) {
    return "Implementation was completed on a previous purchase. Only subscription and usage changes apply.";
  }

  const date = new Date(entry.approvedAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `Implementation was completed on ${date}. Only subscription and usage changes apply.`;
}

export function buildActiveProductsFromQuotation(quotation) {
  if (!quotation?.assignments?.length) {
    return [];
  }

  return quotation.assignments.map((assignment) => ({
    key: activeProductKey(quotation.leadId, assignment.productId, assignment.branchId),
    productId: assignment.productId,
    branchId: assignment.branchId,
    billingBranchId: assignment.billingBranchId,
    config: assignment.config,
    changeType: assignment.changeType || CHANGE_TYPES.NEW,
    implementationPurchased: wasImplementationBilled(assignment.config),
    priceLabel: quotation.productSummary?.find(
      (item) =>
        item.productId === assignment.productId &&
        item.branchLabel === undefined
          ? true
          : true,
    )?.priceLabel,
    approvedAt: quotation.reviewedAt || quotation.submittedAt,
    quotationId: quotation.id,
  }));
}

export function mergeActiveProducts(existing, incoming) {
  const map = new Map((existing || []).map((entry) => [entry.key, entry]));

  for (const entry of incoming || []) {
    map.set(entry.key, entry);
  }

  return [...map.values()];
}

export function getActiveProducts(lead) {
  const inactiveBranchIds = getInactiveLeadBranchIds(lead);

  const fromActiveProducts = (Array.isArray(lead?.activeProducts) ? lead.activeProducts : []).filter(
    (entry) => !inactiveBranchIds.has(String(entry.branchId || "")),
  );

  const fromSubscriptions = (Array.isArray(lead?.subscriptions) ? lead.subscriptions : [])
    .filter((sub) => (sub.status || "active") === "active")
    .filter((sub) => !inactiveBranchIds.has(String(sub.branchId || "")))
    .map((sub) => ({
      key: sub.key,
      subscriptionId: sub.id,
      productId: sub.productId,
      branchId: sub.branchId,
      billingBranchId: sub.billingBranchId || sub.branchId,
      changeType: sub.changeType,
      config: sub.entitlementConfig || sub.config,
      priceLabel: sub.priceLabel,
      approvedAt: sub.approvedAt || sub.startsAt,
      paymentConfirmedAt: sub.paymentConfirmedAt,
      quotationId: sub.quotationId,
      implementationPurchased: sub.implementationPurchased,
      renewsAt: sub.renewsAt,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
      cancelEffectiveAt: sub.cancelEffectiveAt || null,
      status: sub.status || "active",
    }));

  if (!fromSubscriptions.length) {
    return fromActiveProducts;
  }

  // Merge: subscriptions win per product+branch, but keep OTC-paid / implementing
  // products from active_products that do not have a subscription yet.
  // Preserve go-live lifecycle from active_products when subscriptions omit it.
  const byLocation = new Map();
  for (const entry of fromActiveProducts) {
    byLocation.set(`${entry.productId}:${entry.branchId}`, entry);
  }
  for (const entry of fromSubscriptions) {
    const key = `${entry.productId}:${entry.branchId}`;
    const existing = byLocation.get(key);
    byLocation.set(key, {
      ...existing,
      ...entry,
      lifecycleStatus: entry.lifecycleStatus || existing?.lifecycleStatus || null,
      goLiveId: entry.goLiveId || existing?.goLiveId || null,
    });
  }
  return [...byLocation.values()];
}

export function isProductActiveAnywhere(lead, productId) {
  return getActiveProducts(lead).some((entry) => entry.productId === productId);
}

export function getActiveAtBranch(lead, productId, branchId) {
  return getActiveProducts(lead).find(
    (entry) => entry.productId === productId && entry.branchId === branchId,
  );
}

export function inferDefaultChangeType(lead, productId, branchId) {
  const atBranch = getActiveAtBranch(lead, productId, branchId);
  if (atBranch && isActivePaidSubscription(atBranch)) {
    return CHANGE_TYPES.ADDON;
  }

  if (isProductActiveAnywhere(lead, productId)) {
    const paidElsewhere = getActiveProducts(lead).some(
      (entry) =>
        entry.productId === productId &&
        entry.branchId !== branchId &&
        isActivePaidSubscription(entry),
    );
    if (paidElsewhere) {
      return CHANGE_TYPES.ADDON;
    }
  }

  return CHANGE_TYPES.NEW;
}

export function getChangeTypeLabel(changeType) {
  if (changeType === CHANGE_TYPES.RENEWAL || changeType === "renewal") {
    return "Renewal";
  }
  return CHANGE_TYPE_OPTIONS.find((option) => option.value === changeType)?.label || "New purchase";
}

export function normalizeProductKeyParam(value = "") {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function findActiveProductByKey(products, productKey) {
  const list = Array.isArray(products) ? products : [];
  const decoded = normalizeProductKeyParam(productKey);

  for (const candidate of [decoded, productKey]) {
    const match = list.find((entry) => entry.key === candidate);
    if (match) {
      return match;
    }
  }

  const parts = decoded.split(":");
  if (parts.length >= 3) {
    const branchId = parts[parts.length - 1];
    const productId = parts[parts.length - 2];
    return (
      list.find((entry) => entry.productId === productId && entry.branchId === branchId) || null
    );
  }

  return null;
}

export function buildProductOverviewPath(basePath, leadId, productKey) {
  const encodedKey = encodeURIComponent(productKey || "");
  return `${basePath}/leads/${leadId}/products/${encodedKey}`;
}

export function buildSalesWorkspaceProductOverviewPath(leadId, productKey) {
  const encodedKey = encodeURIComponent(productKey || "");
  return `/products/${leadId}/products/${encodedKey}`;
}

export function getProductCardStatus(lead, productId) {
  const entries = getActiveProducts(lead).filter((entry) => entry.productId === productId);
  if (!entries.length) {
    return null;
  }

  // Prefer a true live subscription when any branch is commercially active.
  if (entries.some((entry) => isActivePaidSubscription(entry))) {
    return {
      label: "Active",
      tone: "active",
    };
  }

  const lifecycleOrder = [
    "awaiting_subscription_payment",
    "uat_expired",
    "uat",
    "awaiting_implementation",
  ];
  for (const status of lifecycleOrder) {
    const match = entries.find((entry) => entry.lifecycleStatus === status);
    if (match) {
      return { label: goLiveStatusLabel(status), tone: "progress" };
    }
  }

  // OTC paid without lifecycle/subscription — still implementing, not Active.
  if (entries.some((entry) => entry.paymentConfirmedAt && !entry.subscriptionId)) {
    return { label: goLiveStatusLabel("awaiting_implementation"), tone: "progress" };
  }

  return null;
}

export function suggestChangeTypeFromPrices(previousPrice, nextPrice) {
  if (!Number.isFinite(previousPrice) || !Number.isFinite(nextPrice)) {
    return CHANGE_TYPES.UPGRADE;
  }

  if (nextPrice > previousPrice) {
    return CHANGE_TYPES.UPGRADE;
  }

  if (nextPrice < previousPrice) {
    return CHANGE_TYPES.UPGRADE;
  }

  return CHANGE_TYPES.UPGRADE;
}
