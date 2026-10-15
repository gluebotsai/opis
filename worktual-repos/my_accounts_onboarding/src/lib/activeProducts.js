export const CHANGE_TYPES = {
  NEW: "new",
  UPGRADE: "upgrade",
  DOWNGRADE: "downgrade",
  ADDON: "addon",
};

export const CHANGE_TYPE_OPTIONS = [
  { value: CHANGE_TYPES.NEW, label: "New purchase", description: "First time buying this product." },
  {
    value: CHANGE_TYPES.UPGRADE,
    label: "Upgrade",
    description: "Increase plan, users, or capacity on an existing subscription.",
  },
  {
    value: CHANGE_TYPES.DOWNGRADE,
    label: "Downgrade",
    description: "Reduce plan, users, or capacity on an existing subscription.",
  },
  {
    value: CHANGE_TYPES.ADDON,
    label: "Add-on",
    description: "Optional extra module alongside an existing product.",
  },
];

export function activeProductKey(leadId, productId, branchId) {
  return `${leadId}:${productId}:${branchId}`;
}

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

export function getSubscriptionRenewsAt(entry) {
  if (entry?.renewsAt) {
    return new Date(entry.renewsAt);
  }

  const approvedAt = entry?.approvedAt ? new Date(entry.approvedAt) : new Date();
  const billingCycle = entry?.config?.billingCycle === "yearly" ? "yearly" : "monthly";
  return billingCycle === "yearly" ? addYears(approvedAt, 1) : addMonths(approvedAt, 1);
}

/** Paid and still within the current subscription window. */
export function isActivePaidSubscription(entry, now = new Date()) {
  if (!entry?.productId || !entry?.branchId) {
    return false;
  }

  if (!entry.paymentConfirmedAt) {
    return false;
  }

  return getSubscriptionRenewsAt(entry) > now;
}

export function findDuplicateNewPurchase(lead, productId, branchId) {
  const atBranch = getActiveAtBranch(lead, productId, branchId);
  if (atBranch && isActivePaidSubscription(atBranch)) {
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
      (entry.implementationPurchased === true || wasImplementationBilled(entry.config)),
  );
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
    billingTargetId: assignment.billingTargetId,
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
  if (Array.isArray(lead?.subscriptions) && lead.subscriptions.length > 0) {
    return lead.subscriptions
      .filter((sub) => (sub.status || "active") === "active")
      .map((sub) => ({
      key: sub.key,
      subscriptionId: sub.id,
      productId: sub.productId,
      branchId: sub.locationId || sub.branchId,
      billingTargetId: sub.billingTargetId || sub.locationId || sub.branchId,
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
  }

  return Array.isArray(lead?.activeProducts) ? lead.activeProducts : [];
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
  if (atBranch) {
    return CHANGE_TYPES.UPGRADE;
  }

  if (isProductActiveAnywhere(lead, productId)) {
    return CHANGE_TYPES.ADDON;
  }

  return CHANGE_TYPES.NEW;
}

export function getChangeTypeLabel(changeType) {
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
  if (!isProductActiveAnywhere(lead, productId)) {
    return null;
  }

  return {
    label: "Active",
    tone: "active",
  };
}

export function suggestChangeTypeFromPrices(previousPrice, nextPrice) {
  if (!Number.isFinite(previousPrice) || !Number.isFinite(nextPrice)) {
    return CHANGE_TYPES.UPGRADE;
  }

  if (nextPrice > previousPrice) {
    return CHANGE_TYPES.UPGRADE;
  }

  if (nextPrice < previousPrice) {
    return CHANGE_TYPES.DOWNGRADE;
  }

  return CHANGE_TYPES.UPGRADE;
}
