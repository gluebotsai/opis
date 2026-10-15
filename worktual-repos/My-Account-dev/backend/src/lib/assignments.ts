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
export function tieBillingToBranch(assignment: any) {
  const branchId = assignment.branchId || HQ_BRANCH_ID;

  return {
    ...assignment,
    branchId,
    billingBranchId: branchId,
  };
}

export function normalizeAssignmentsBilling(assignments: any) {
  return (assignments || []).map(tieBillingToBranch);
}

export function requiresPerBranchInvoicing(assignments: any, lead: any) {
  if (!assignments?.length) {
    return false;
  }

  const branchIds = new Set(assignments.map((entry: any) => entry.branchId || HQ_BRANCH_ID));
  if (branchIds.size > 1) {
    return true;
  }

  const countries = new Set(
    assignments
      .map((entry: any) => getBranchCountry(lead, entry.branchId || HQ_BRANCH_ID))
      .filter(Boolean),
  );

  return countries.size > 1;
}

export function resolveInvoiceMode(assignments: any, lead: any, requestedMode: any = INVOICE_MODES.CONSOLIDATED) {
  if (requiresPerBranchInvoicing(assignments, lead)) {
    return INVOICE_MODES.PER_BRANCH;
  }

  return requestedMode || INVOICE_MODES.CONSOLIDATED;
}

export function validateBranchScopedBilling(assignments: any) {
  for (const assignment of assignments || []) {
    const branchId = assignment.branchId || HQ_BRANCH_ID;
    const billingBranchId = assignment.billingBranchId || branchId;

    if (billingBranchId !== branchId) {
      return "Each product must be invoiced to the same branch where it is used.";
    }
  }

  return "";
}

export function validateInvoiceModeForAssignments(assignments: any, lead: any, invoiceMode: any) {
  const billingError = validateBranchScopedBilling(assignments);
  if (billingError) {
    return billingError;
  }

  if (invoiceMode === INVOICE_MODES.CONSOLIDATED && requiresPerBranchInvoicing(assignments, lead)) {
    return "Use separate invoices per branch. Combined invoices are not allowed across branches or countries.";
  }

  return "";
}

/** Branches not yet used by another row of the same product in the current quote. */
export function unusedBranchesForProduct(assignments: any, branches: any, productId: any, excludeAssignmentId: any = null) {
  const used = new Set(
    (assignments || [])
      .filter((entry: any) => entry.productId === productId && entry.id !== excludeAssignmentId)
      .map((entry: any) => entry.branchId || HQ_BRANCH_ID),
  );
  return (branches || []).filter((branch: any) => !used.has(branch.id));
}

export function createAssignment(productId: any, branchId: any, _billingBranchId: any, config: any, changeType: any = CHANGE_TYPES.NEW) {
  const resolvedBranchId = branchId || HQ_BRANCH_ID;

  return {
    id: createId(),
    productId,
    branchId: resolvedBranchId,
    billingBranchId: resolvedBranchId,
    changeType,
    config,
  };
}

export function createAssignmentsForProducts(
  selectedProductIds: any,
  branches: any,
  createInitialConfig: any,
  getProduct: any,
  lead: any,
  inferChangeType: any,
) {
  const defaultBranchId = branches[0]?.id || HQ_BRANCH_ID;

  return selectedProductIds.map((productId: any) => {
    const product = getProduct(productId);
    const branchId = defaultBranchId;
    const changeType = inferChangeType
      ? inferChangeType(lead, productId, branchId)
      : CHANGE_TYPES.NEW;
    const existing = lead?.activeProducts?.find(
      (entry: any) => entry.productId === productId && entry.branchId === branchId,
    );
    const config = resolveReturningProductConfig({
      lead,
      productId,
      branchId,
      changeType,
      createInitialConfig: (selectedProduct: any) => createInitialConfig(selectedProduct, branchId),
      product,
      existingAtBranch: existing,
    });

    return createAssignment(productId, branchId, branchId, config, changeType);
  });
}

export function groupAssignmentsByBillingTarget(assignments: any) {
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

export function buildBranchSummary(assignments: any, lead: any) {
  const branchIds = new Set(assignments.map((entry: any) => entry.branchId));
  const billingIds = new Set(assignments.map((entry: any) => entry.billingBranchId));

  return {
    productCount: assignments.length,
    branchCount: branchIds.size,
    billingGroupCount: billingIds.size,
    branchLabels: [...branchIds].map((id: any) => formatBranchLabel(lead, id)),
  };
}

export function buildProductSummary(assignments: any, lead: any, productCatalog: any, getConfiguredPrice: any) {
  return assignments.map((assignment: any) => {
    const product = productCatalog.find((entry: any) => entry.id === assignment.productId);
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

export function resolveBillingAddress(lead: any, billingBranchId: any) {
  const branch = getBranchById(lead, billingBranchId);
  return branch?.address || lead?.billingAddress || "—";
}

export function billingGroupLabel(lead: any, billingBranchId: any) {
  return formatBranchLabel(lead, billingBranchId);
}

export function assignmentDisplayLabel(assignment: any, lead: any, productCatalog: any) {
  const product = productCatalog.find((entry: any) => entry.id === assignment.productId);
  const branchLabel = formatBranchLabel(lead, assignment.branchId);
  const productName = product?.name || assignment.productId;

  return `${productName} — ${branchLabel}`;
}
