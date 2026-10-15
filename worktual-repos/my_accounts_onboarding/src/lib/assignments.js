import { createId } from "./id.js";
import { formatBranchLabel, getBranchById, getBranchCountry, HQ_BRANCH_ID } from "./leads.js";
import {
  CHANGE_TYPES,
  getChangeTypeLabel,
  resolveReturningProductConfig,
} from "./activeProducts.js";

export const INVOICE_MODES = {
  CONSOLIDATED: "consolidated",
  PER_BRANCH: "per_branch",
};

/** Invoice is always issued to the branch where the product runs. */
export function tieBillingToBranch(assignment) {
  const branchId = assignment.branchId || HQ_BRANCH_ID;

  return {
    ...assignment,
    branchId,
    billingTargetId: branchId,
  };
}

export function normalizeAssignmentsBilling(assignments) {
  return (assignments || []).map(tieBillingToBranch);
}

export function requiresPerBranchInvoicing(assignments, lead) {
  if (!assignments?.length) {
    return false;
  }

  const branchIds = new Set(assignments.map((entry) => entry.branchId || HQ_BRANCH_ID));
  if (branchIds.size > 1) {
    return true;
  }

  const countries = new Set(
    assignments
      .map((entry) => getBranchCountry(lead, entry.branchId || HQ_BRANCH_ID))
      .filter(Boolean),
  );

  return countries.size > 1;
}

export function resolveInvoiceMode(assignments, lead, requestedMode = INVOICE_MODES.CONSOLIDATED) {
  if (requiresPerBranchInvoicing(assignments, lead)) {
    return INVOICE_MODES.PER_BRANCH;
  }

  return requestedMode || INVOICE_MODES.CONSOLIDATED;
}

export function validateBranchScopedBilling(assignments) {
  for (const assignment of assignments || []) {
    const branchId = assignment.branchId || HQ_BRANCH_ID;
    const billingTargetId = assignment.billingTargetId || branchId;

    if (billingTargetId !== branchId) {
      return "Each product must be invoiced to the same branch where it is used.";
    }
  }

  return "";
}

export function validateInvoiceModeForAssignments(assignments, lead, invoiceMode) {
  const billingError = validateBranchScopedBilling(assignments);
  if (billingError) {
    return billingError;
  }

  if (invoiceMode === INVOICE_MODES.CONSOLIDATED && requiresPerBranchInvoicing(assignments, lead)) {
    return "Use separate invoices per branch. Combined invoices are not allowed across branches or countries.";
  }

  return "";
}

export function createAssignment(productId, branchId, _billingTargetId, config, changeType = CHANGE_TYPES.NEW) {
  const resolvedBranchId = branchId || HQ_BRANCH_ID;

  return {
    id: createId(),
    productId,
    branchId: resolvedBranchId,
    billingTargetId: resolvedBranchId,
    changeType,
    config,
  };
}

export function createAssignmentsForProducts(
  selectedProductIds,
  branches,
  createInitialConfig,
  getProduct,
  lead,
  inferChangeType,
) {
  const defaultBranchId = branches[0]?.id || HQ_BRANCH_ID;

  return selectedProductIds.map((productId) => {
    const product = getProduct(productId);
    const branchId = defaultBranchId;
    const changeType = inferChangeType
      ? inferChangeType(lead, productId, branchId)
      : CHANGE_TYPES.NEW;
    const existing = lead?.activeProducts?.find(
      (entry) => entry.productId === productId && entry.branchId === branchId,
    );
    const config = resolveReturningProductConfig({
      lead,
      productId,
      branchId,
      changeType,
      createInitialConfig: (selectedProduct) => createInitialConfig(selectedProduct, branchId),
      product,
      existingAtBranch: existing,
    });

    return createAssignment(productId, branchId, branchId, config, changeType);
  });
}

export function groupAssignmentsByBillingTarget(assignments) {
  const groups = new Map();

  for (const assignment of normalizeAssignmentsBilling(assignments)) {
    const key = assignment.branchId || HQ_BRANCH_ID;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(assignment);
  }

  return groups;
}

export function buildBranchSummary(assignments, lead) {
  const branchIds = new Set(assignments.map((entry) => entry.branchId));
  const billingIds = new Set(assignments.map((entry) => entry.billingTargetId));

  return {
    productCount: assignments.length,
    branchCount: branchIds.size,
    billingGroupCount: billingIds.size,
    branchLabels: [...branchIds].map((id) => formatBranchLabel(lead, id)),
  };
}

export function buildProductSummary(assignments, lead, productCatalog, getConfiguredPrice) {
  return assignments.map((assignment) => {
    const product = productCatalog.find((entry) => entry.id === assignment.productId);
    const config = assignment.config;
    const price = config && getConfiguredPrice ? getConfiguredPrice(config) : 0;

    return {
      productId: assignment.productId,
      name: product?.name || assignment.productId,
      branchLabel: formatBranchLabel(lead, assignment.branchId),
      billingLabel: formatBranchLabel(lead, assignment.branchId),
      changeType: assignment.changeType || CHANGE_TYPES.NEW,
      changeTypeLabel: getChangeTypeLabel(assignment.changeType || CHANGE_TYPES.NEW),
      priceLabel: config?.currency
        ? `${config.currency} ${price.toLocaleString()}`
        : "Price pending",
    };
  });
}

export function resolveBillingAddress(lead, billingTargetId) {
  const branch = getBranchById(lead, billingTargetId);
  return branch?.address || lead?.billingAddress || "—";
}

export function billingGroupLabel(lead, billingTargetId) {
  return formatBranchLabel(lead, billingTargetId);
}

export function assignmentDisplayLabel(assignment, lead, productCatalog) {
  const product = productCatalog.find((entry) => entry.id === assignment.productId);
  const branchLabel = formatBranchLabel(lead, assignment.branchId);
  const productName = product?.name || assignment.productId;

  return `${productName} — ${branchLabel}`;
}
