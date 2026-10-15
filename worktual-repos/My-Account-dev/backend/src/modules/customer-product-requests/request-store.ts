import crypto from "node:crypto";

import { REQUEST_KINDS } from "../branch-requests/cancellation-requests.js";
import { pool } from "../../db/pool.js";
import {
  cancelCustomerProductRequestRow,
  fulfillCustomerProductRequestRow,
  insertCustomerProductRequest,
  selectCustomerProductRequest,
  selectCustomerProductRequestById,
  selectCustomerProductRequests,
  selectCustomerProductRequestsByLeadId,
  selectCustomerProductRequestsByLeadIds,
  selectAllCustomerProductRequests,
  selectSubmittedCustomerProductRequests,
  selectSubmittedProductRequestsByLeadId,
  fulfillProductRequestsWithApprovedQuotations,
  touchCustomerProductRequest,
  updateCustomerProductRequestAssignments,
  updateCustomerProductRequestDetails,
} from "../../repositories/raw/customerProductRequests.repo.js";
import {
  selectAssignmentsByQuotation,
  selectLatestQuotationsByProductRequestIds,
} from "../../repositories/raw/quotations.repo.js";
import { QUOTATION_STATUSES } from "../../lib/statuses.js";
import { selectOpenCancellationRequest } from "../../repositories/raw/branchCancellationRequests.repo.js";
import { selectActiveSubscriptionByProductLocation } from "../../repositories/raw/subscriptions.repo.js";
import { selectGoLiveByOrganization } from "../../repositories/raw/productGoLive.repo.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { isHigherPlanThan } from "../../lib/ccaasPlans.js";
import { isProductActiveAnywhere } from "../../lib/activeProducts.js";
import { getProductName, PRODUCT_CATALOG } from "../../lib/productCatalog.js";
import { publishRequestEvent } from "../../infra/events.js";

const INQUIRY_REQUEST_TYPE = "inquiry";
const ALL_PRODUCTS_OWNED_MESSAGE =
  "All catalog products are already on your account. Request an upgrade instead.";

const BRANCH_DROP_CONFLICT_MESSAGE =
  "This branch has an open cancellation request and cannot accept product changes.";
const PRODUCT_CANCEL_CONFLICT_MESSAGE =
  "This product has an open cancellation request and cannot be upgraded.";
const UPGRADE_PLAN_CONFLICT_MESSAGE =
  "Upgrade requests must select a plan higher than your current plan.";

export class OpenProductRequestConflictError extends Error {
  constructor(existingRequest: any, productId: any, branchId: any) {
    const isInquiry =
      String(existingRequest?.requestType || "").trim().toLowerCase() === "inquiry";
    const productLabel = String(productId || "product").trim() || "product";
    super(
      isInquiry
        ? "An open product inquiry already exists. Notify sales again instead of creating another."
        : `An open request already exists for ${productLabel}. Edit that request or notify sales again.`,
    );
    this.name = "OpenProductRequestConflictError";
    (this as any).code = "OPEN_PRODUCT_REQUEST";
    (this as any).existingRequest = existingRequest;
    (this as any).productId = productId || null;
    (this as any).branchId = branchId || null;
  }
}

export class AlreadyOwnedProductError extends Error {
  constructor(productId: any) {
    const label = getProductName(productId) || String(productId || "product").trim() || "product";
    super(`${label} is already on your account. Request an upgrade instead of a new purchase.`);
    this.name = "AlreadyOwnedProductError";
    (this as any).code = "ALREADY_OWNED_PRODUCT";
    (this as any).productId = productId || null;
  }
}

function assignmentProductBranchKey(entry: any) {
  const productId = String(entry?.productId || entry?.product_id || "").trim();
  const branchId = String(entry?.branchId || entry?.branch_id || "hq").trim() || "hq";
  return productId ? `${productId}::${branchId}` : "";
}

function canEditOpenProductRequest(request: any) {
  const display = String(request?.displayStatus || "").trim();
  return display === "open" || display === "rejected";
}

function canNotifyOpenProductRequest(request: any) {
  const display = String(request?.displayStatus || "").trim();
  return (
    display === "open" ||
    display === "rejected" ||
    display === "awaiting_finance" ||
    display === "approved"
  );
}

async function findOpenProductRequestConflict({
  organizationId,
  assignments,
  ignoreRequestId = null,
}: any) {
  const rows = await selectSubmittedCustomerProductRequests(organizationId);
  if (!rows.length) {
    return null;
  }

  const enriched = await enrichRequestsWithLinkedQuotations(
    await enrichRequestsWithSalesperson(rows.map(mapRequestRow)),
  );
  const ignoreId = ignoreRequestId ? String(ignoreRequestId) : null;
  const requestedKeys = new Set(
    (assignments || []).map(assignmentProductBranchKey).filter(Boolean),
  );

  for (const existing of enriched) {
    if (ignoreId && String(existing.id) === ignoreId) {
      continue;
    }
    if (!canNotifyOpenProductRequest(existing)) {
      continue;
    }

    for (const entry of existing.assignments || []) {
      const key = assignmentProductBranchKey(entry);
      if (!key || !requestedKeys.has(key)) {
        continue;
      }
      const [productId, branchId] = key.split("::");
      return { existingRequest: existing, productId, branchId };
    }
  }

  return null;
}

async function assertNoOpenProductRequestConflict({
  organizationId,
  assignments,
  ignoreRequestId = null,
}: any) {
  const conflict = await findOpenProductRequestConflict({
    organizationId,
    assignments,
    ignoreRequestId,
  });
  if (!conflict) {
    return;
  }
  throw new OpenProductRequestConflictError(
    conflict.existingRequest,
    conflict.productId,
    conflict.branchId,
  );
}

function readSubscriptionLicenseTier(subscriptionRow: any) {
  if (!subscriptionRow) {
    return "";
  }

  const entry = rowToCamel(subscriptionRow);
  const config = entry!.entitlementConfig;
  if (!config) {
    return "";
  }

  if (typeof config === "string") {
    try {
      return String(JSON.parse(config).licenseTier || "").trim();
    } catch {
      return "";
    }
  }

  return String((config as any).licenseTier || "").trim();
}

async function assertUpgradePlanIsHigher({ organizationId, assignments }: any) {
  for (const assignment of assignments) {
    const changeType = String(assignment.changeType || "new").trim().toLowerCase();
    if (changeType !== "upgrade") {
      continue;
    }

    const productId = String(assignment.productId || "").trim();
    if (productId !== "contact-center") {
      continue;
    }

    const branchId = String(assignment.branchId || "hq").trim();
    const requestedTier = String(assignment.config?.licenseTier || "").trim();
    if (!requestedTier) {
      throw new Error(UPGRADE_PLAN_CONFLICT_MESSAGE);
    }

    const subscription = await selectActiveSubscriptionByProductLocation(pool, {
      organizationId,
      branchId,
      productId,
    });
    const currentTier = readSubscriptionLicenseTier(subscription);
    if (!isHigherPlanThan(currentTier, requestedTier)) {
      throw new Error(UPGRADE_PLAN_CONFLICT_MESSAGE);
    }
  }
}

/**
 * Block "new purchase" requests for products the org already owns — including
 * OTC-paid products still in implementation / UAT (active_products or go-live,
 * not yet a live subscription).
 */
async function assertNoAlreadyOwnedNewProduct({
  organizationId,
  sourceLeadId,
  assignments,
}: any) {
  const newAssignments = (Array.isArray(assignments) ? assignments : []).filter(
    (assignment: any) => String(assignment.changeType || "new").trim().toLowerCase() === "new",
  );
  if (!newAssignments.length) {
    return;
  }

  let lead = null;
  if (sourceLeadId) {
    const { getLeadById } = await import("../leads/lead-store.js");
    lead = await getLeadById(sourceLeadId);
  }

  const goLiveRows = organizationId
    ? await selectGoLiveByOrganization(pool, organizationId)
    : [];

  for (const assignment of newAssignments) {
    const productId = String(assignment.productId || "").trim();
    if (!productId) {
      continue;
    }

    if (lead && isProductActiveAnywhere(lead, productId)) {
      throw new AlreadyOwnedProductError(productId);
    }

    const ownedInGoLive = goLiveRows.some(
      (row: any) => String(row.product_id || row.productId || "").trim() === productId,
    );
    if (ownedInGoLive) {
      throw new AlreadyOwnedProductError(productId);
    }
  }
}

async function collectOwnedCatalogProductIds({ organizationId, sourceLeadId }: any) {
  const owned = new Set<string>();

  let lead = null;
  if (sourceLeadId) {
    const { getLeadById } = await import("../leads/lead-store.js");
    lead = await getLeadById(sourceLeadId);
  }

  const goLiveRows = organizationId
    ? await selectGoLiveByOrganization(pool, organizationId)
    : [];

  for (const product of PRODUCT_CATALOG) {
    const productId = String(product.id || "").trim();
    if (!productId) {
      continue;
    }
    if (lead && isProductActiveAnywhere(lead, productId)) {
      owned.add(productId);
      continue;
    }
    const ownedInGoLive = goLiveRows.some(
      (row: any) => String(row.product_id || row.productId || "").trim() === productId,
    );
    if (ownedInGoLive) {
      owned.add(productId);
    }
  }

  return owned;
}

async function assertCustomerCanSubmitProductInquiry({ organizationId, sourceLeadId }: any) {
  const owned = await collectOwnedCatalogProductIds({ organizationId, sourceLeadId });
  if (PRODUCT_CATALOG.every((product) => owned.has(String(product.id)))) {
    throw new Error(ALL_PRODUCTS_OWNED_MESSAGE);
  }
}

async function assertNoOpenInquiryRequest({ organizationId, ignoreRequestId = null }: any) {
  const rows = await selectSubmittedCustomerProductRequests(organizationId);
  if (!rows.length) {
    return;
  }

  const enriched = await enrichRequestsWithLinkedQuotations(
    await enrichRequestsWithSalesperson(rows.map(mapRequestRow)),
  );
  const ignoreId = ignoreRequestId ? String(ignoreRequestId) : null;

  for (const existing of enriched) {
    if (ignoreId && String(existing.id) === ignoreId) {
      continue;
    }
    if (String(existing.requestType || "").trim().toLowerCase() !== INQUIRY_REQUEST_TYPE) {
      continue;
    }
    if (!canNotifyOpenProductRequest(existing)) {
      continue;
    }
    throw new OpenProductRequestConflictError(existing, null, null);
  }
}

function isInquiryRequestType(requestType: any) {
  return String(requestType || "").trim().toLowerCase() === INQUIRY_REQUEST_TYPE;
}

async function emitReconciledProductRequestEvents(rows: any[]) {
  for (const row of rows || []) {
    const mapped = mapRequestRow(row);
    emitProductRequestEvent("product_request.fulfilled", mapped);
  }
}

async function reconcileStuckProductRequests({
  leadId = null,
  organizationId = null,
}: { leadId?: string | null; organizationId?: string | null } = {}) {
  // Only fulfill requests already linked on a quotation (source_product_request_id).
  // Never auto-attach / auto-close notify-only "inquiry" requests against unrelated quotes —
  // that hid empty-note "Request new product" inquiries from sales as soon as the account
  // had any approved/paid history.
  const reconciled = await fulfillProductRequestsWithApprovedQuotations(pool, {
    leadId,
    organizationId,
  });
  await emitReconciledProductRequestEvents(reconciled);
  return reconciled.length;
}

/**
 * When sales quotes without an explicit link, attach the lead's sole open *configured*
 * product request. Notify-only inquiries are never auto-linked — sales must open from
 * the Customer product requests CTA so the inquiry stays visible until they act on it.
 */
export async function resolveSourceProductRequestIdForQuotation(
  leadId: any,
  explicitRequestId: any = null,
) {
  if (explicitRequestId) {
    return explicitRequestId;
  }
  if (!leadId) {
    return null;
  }

  const candidates = await selectSubmittedProductRequestsByLeadId(pool, leadId);
  const openConfigured = candidates.filter(
    (row: any) => !isInquiryRequestType(row.request_type),
  );
  if (openConfigured.length === 1) {
    return openConfigured[0].id;
  }
  return null;
}

function defaultInquiryProductSummary() {
  return [
    {
      name: "New product inquiry",
      changeType: INQUIRY_REQUEST_TYPE,
      changeTypeLabel: "Inquiry",
      priceLabel: "Pending sales follow-up",
    },
  ];
}

async function assertNoConflictingCancellation({ organizationId, assignments }: any) {
  for (const assignment of assignments) {
    const branchId = String(assignment.branchId || "hq").trim();
    const changeType = String(assignment.changeType || "new").trim().toLowerCase();
    const productId = assignment.productId ? String(assignment.productId).trim() : null;

    const branchDrop = await selectOpenCancellationRequest(pool, {
      organizationId,
      branchId,
      requestKind: REQUEST_KINDS.DROP_BRANCH,
    });

    if (branchDrop) {
      throw new Error(BRANCH_DROP_CONFLICT_MESSAGE);
    }

    if (changeType !== "upgrade" && changeType !== "addon") {
      continue;
    }

    let subscriptionId = assignment.subscriptionId ? String(assignment.subscriptionId).trim() : null;

    if (!subscriptionId && productId) {
      const subscription = await selectActiveSubscriptionByProductLocation(pool, {
        organizationId,
        branchId,
        productId,
      });
      subscriptionId = subscription?.id || null;
    }

    const productCancellation = await selectOpenCancellationRequest(pool, {
      organizationId,
      branchId,
      requestKind: REQUEST_KINDS.CANCEL_PRODUCT,
      subscriptionId,
      productId,
    });

    if (productCancellation) {
      throw new Error(PRODUCT_CANCEL_CONFLICT_MESSAGE);
    }
  }
}

function generateRequestNumber() {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `REQ-${year}-${suffix}`;
}

function mapRequestRow(row: any) {
  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    requestNumber: entry!.requestNumber,
    organizationId: entry!.organizationId,
    customerUserId: entry!.customerUserId,
    sourceLeadId: entry!.sourceLeadId,
    requestType: entry!.requestType,
    status: entry!.status || "submitted",
    assignments: entry!.assignments || [],
    productSummary: entry!.productSummary || [],
    branchSummary: entry!.branchSummary || null,
    newBranches: Array.isArray(entry!.newBranches) ? entry!.newBranches : [],
    customerNote: entry!.customerNote || "",
    tenantId: entry!.tenantId || "",
    companyName: entry!.companyName || "",
    contactEmail: entry!.contactEmail || "",
    salespersonName: null,
    salespersonEmail: null,
    linkedQuotationId: null,
    linkedQuotationStatus: null,
    displayStatus: deriveProductRequestDisplayStatus(entry!.status || "submitted", null),
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

function emitProductRequestEvent(event: any, request: any) {
  if (!request?.id) {
    return;
  }
  void publishRequestEvent(event, {
    requestId: request.id,
    organizationId: request.organizationId,
    leadId: request.sourceLeadId || null,
    status: request.status,
    requestType: request.requestType || null,
  });
}

/**
 * Derive sales-dashboard finance stage from portal request status + linked quote.
 * @returns {"open"|"awaiting_finance"|"approved"|"rejected"|"fulfilled"|"cancelled"}
 */
export function deriveProductRequestDisplayStatus(requestStatus: any, quotationStatus: any) {
  const status = String(requestStatus || "submitted").trim().toLowerCase();
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "fulfilled") {
    return "fulfilled";
  }

  const quoteStatus = String(quotationStatus || "").trim();
  if (quoteStatus === QUOTATION_STATUSES.PENDING) {
    return "awaiting_finance";
  }
  if (quoteStatus === QUOTATION_STATUSES.APPROVED || quoteStatus === QUOTATION_STATUSES.PAID) {
    return "approved";
  }
  if (quoteStatus === QUOTATION_STATUSES.REJECTED) {
    return "rejected";
  }

  return "open";
}

async function enrichRequestsWithLinkedQuotations(requests: any) {
  if (!Array.isArray(requests) || requests.length === 0) {
    return requests;
  }

  const requestIds = requests.map((request) => request.id).filter(Boolean);
  const quoteRows = await selectLatestQuotationsByProductRequestIds(pool, requestIds);
  const byRequestId = new Map(
    quoteRows.map((row: any) => [
      String(row.source_product_request_id),
      { id: row.id, status: row.status },
    ]),
  );

  return requests.map((request) => {
    const linked = byRequestId.get(String(request.id)) || null;
    return {
      ...request,
      linkedQuotationId: (linked as any)?.id || null,
      linkedQuotationStatus: (linked as any)?.status || null,
      displayStatus: deriveProductRequestDisplayStatus(request.status, (linked as any)?.status || null),
    };
  });
}

/** Lead assignee first, then creator — same order as product-request mail routing. */
async function resolveSalespersonForLead(sourceLeadId: any) {
  if (!sourceLeadId) {
    return { salespersonName: null, salespersonEmail: null };
  }

  const { getLeadOwnership } = await import("../leads/lead-store.js");
  const { getUserById, isSalesFacingUser, isUserActive } = await import("../users/user-store.js");
  const ownership = await getLeadOwnership(sourceLeadId);
  const candidates = [ownership?.assignedUserId, ownership?.createdByUserId].filter(Boolean);

  for (const userId of candidates) {
    const user = await getUserById(userId);
    if (!isUserActive(user) || !isSalesFacingUser(user)) {
      continue;
    }
    const email = String((user as any)!.email || "").trim();
    const name = String((user as any)!.displayName || email || "").trim();
    if (!name && !email) {
      continue;
    }
    return {
      salespersonName: name || email || null,
      salespersonEmail: email || null,
    };
  }

  return { salespersonName: null, salespersonEmail: null };
}

async function enrichRequestsWithSalesperson(requests: any) {
  if (!Array.isArray(requests) || requests.length === 0) {
    return requests;
  }

  const leadIds = [
    ...new Set(requests.map((request) => request.sourceLeadId).filter(Boolean).map(String)),
  ];
  const byLeadId = new Map();
  await Promise.all(
    leadIds.map(async (leadId) => {
      byLeadId.set(leadId, await resolveSalespersonForLead(leadId));
    }),
  );

  return requests.map((request) => {
    const salesperson = request.sourceLeadId
      ? byLeadId.get(String(request.sourceLeadId))
      : null;
    return {
      ...request,
      salespersonName: salesperson?.salespersonName || null,
      salespersonEmail: salesperson?.salespersonEmail || null,
    };
  });
}

async function enrichRequestWithSalesperson(request: any) {
  if (!request) {
    return null;
  }
  const [enriched] = await enrichRequestsWithSalesperson([request]);
  return enriched;
}

export async function listCustomerProductRequests(organizationId: any, { branchId = null }: any = {}) {
  await reconcileStuckProductRequests({ organizationId });
  const rows = await selectCustomerProductRequests(organizationId);
  let mapped = rows.map(mapRequestRow);

  if (branchId) {
    const scopedBranchId = String(branchId);
    mapped = mapped.filter((request) => {
      // Notify-only inquiries have no assignments — still visible to every branch portal user.
      if (String(request.requestType || "").trim().toLowerCase() === INQUIRY_REQUEST_TYPE) {
        return true;
      }
      const assignments = Array.isArray(request.assignments) ? request.assignments : [];
      if (!assignments.length) {
        return false;
      }
      return assignments.some(
        (entry) => String(entry.branchId || "hq") === scopedBranchId,
      );
    });
  }

  return enrichRequestsWithLinkedQuotations(await enrichRequestsWithSalesperson(mapped));
}

export async function listCustomerProductRequestsForLead(sourceLeadId: any) {
  if (!sourceLeadId) {
    return [];
  }

  await reconcileStuckProductRequests({ leadId: sourceLeadId });
  const rows = await selectCustomerProductRequestsByLeadId(sourceLeadId);
  const withSalesperson = await enrichRequestsWithSalesperson(rows.map(mapRequestRow));
  return enrichRequestsWithLinkedQuotations(withSalesperson);
}

/** Open enough that sales should still act (matches frontend isOpenSalesProductRequest). */
function isOpenSalesProductRequest(request: any) {
  const displayStatus = String(request?.displayStatus || "").trim();
  return (
    displayStatus === "open" ||
    displayStatus === "awaiting_finance" ||
    displayStatus === "rejected"
  );
}

/**
 * Open product requests for the sales dashboard.
 * Scoped to leads the sales user owns (created or assigned), matching lead list visibility
 * and product-request mail recipients. When createdByUserId is null (sales admin “all”),
 * returns open requests across all customers.
 */
export async function listOpenCustomerProductRequestsForSales({
  createdByUserId = null,
}: any = {}) {
  let rows;

  if (createdByUserId) {
    const { selectLeadsOwnedByUser } = await import("../../repositories/raw/leads.repo.js");
    const ownedLeads = await selectLeadsOwnedByUser(pool, createdByUserId);
    const leadIds = ownedLeads.map((row: any) => row.id).filter(Boolean);
    if (!leadIds.length) {
      return [];
    }
    for (const leadId of leadIds) {
      await reconcileStuckProductRequests({ leadId });
    }
    rows = await selectCustomerProductRequestsByLeadIds(leadIds);
  } else {
    await reconcileStuckProductRequests();
    rows = await selectAllCustomerProductRequests();
  }

  if (!rows.length) {
    return [];
  }

  const enriched = await enrichRequestsWithLinkedQuotations(
    await enrichRequestsWithSalesperson(rows.map(mapRequestRow)),
  );

  return enriched.filter(isOpenSalesProductRequest);
}

export async function getCustomerProductRequest(requestId: any, organizationId: any) {
  const row = await selectCustomerProductRequest(requestId, organizationId);
  if (!row) {
    return null;
  }
  const [enriched] = await enrichRequestsWithLinkedQuotations([
    await enrichRequestWithSalesperson(mapRequestRow(row)),
  ]);
  return enriched;
}

export async function getCustomerProductRequestById(requestId: any) {
  const row = await selectCustomerProductRequestById(pool, requestId);
  return row ? enrichRequestWithSalesperson(mapRequestRow(row)) : null;
}

function normalizeNewBranches(newBranches: any[] = []) {
  if (!Array.isArray(newBranches)) {
    return [];
  }

  return newBranches
    .map((entry) => ({
      id: String((entry as any)?.id || "").trim(),
      label: String((entry as any)?.label || "").trim() || "Branch",
      address: String((entry as any)?.address || "").trim(),
      country: String((entry as any)?.country || "").trim(),
      state: String((entry as any)?.state || "").trim(),
      taxNumber: String((entry as any)?.taxNumber || "").trim(),
      industryType: String((entry as any)?.industryType || "").trim(),
      businessType: String((entry as any)?.businessType || "").trim(),
      companySize: String((entry as any)?.companySize || "").trim(),
      websiteUrl: String((entry as any)?.websiteUrl || "").trim(),
      contactName: String((entry as any)?.contactName || "").trim(),
      designation: String((entry as any)?.designation || "").trim(),
      workEmail: String((entry as any)?.workEmail || "").trim(),
      mobileCountryCode: String((entry as any)?.mobileCountryCode || "+91").trim(),
      mobileNumber: String((entry as any)?.mobileNumber || "").trim(),
      secondaryMobileCountryCode: String((entry as any)?.secondaryMobileCountryCode || "+91").trim(),
      secondaryMobileNumber: String((entry as any)?.secondaryMobileNumber || "").trim(),
    }))
    .filter((entry) => entry.id && entry.address);
}

function assertNewBranchesHaveProducts(newBranches: any, assignments: any) {
  if (!newBranches.length) {
    return;
  }

  const assignedBranchIds = new Set(
    (assignments || []).map((entry: any) => String(entry.branchId || entry.billingBranchId || "").trim()),
  );

  for (const branch of newBranches) {
    if (!assignedBranchIds.has(branch.id)) {
      throw new Error(
        `New branch "${branch.label}" must include at least one product purchase in this request.`,
      );
    }
    if (!branch.taxNumber) {
      throw new Error(`Tax number is required for new branch "${branch.label}".`);
    }
    if (!branch.mobileNumber) {
      throw new Error(`Mobile number is required for new branch "${branch.label}".`);
    }
    if (!branch.workEmail) {
      throw new Error(`Work email is required for new branch "${branch.label}".`);
    }
    if (!branch.country) {
      throw new Error(`Country is required for new branch "${branch.label}".`);
    }
  }
}

export async function createCustomerProductRequest({
  organizationId,
  customerUserId,
  sourceLeadId,
  requestType = "new",
  assignments = [],
  productSummary = [],
  branchSummary = null,
  newBranches = [],
  customerNote = "",
  tenantId = "",
  companyName = "",
  contactEmail = "",
}: any) {
  const normalizedRequestType = isInquiryRequestType(requestType)
    ? INQUIRY_REQUEST_TYPE
    : String(requestType || "new").trim() || "new";
  const normalizedAssignments = Array.isArray(assignments) ? assignments : [];
  const note = String(customerNote || "").trim();

  if (normalizedRequestType === INQUIRY_REQUEST_TYPE) {
    if (normalizedAssignments.length > 0) {
      throw new Error("Product inquiry requests cannot include product configurations.");
    }
    if (!note) {
      throw new Error("A note for sales is required for product inquiries.");
    }
    if (!sourceLeadId) {
      throw new Error("Linked sales account not found for this customer.");
    }

    await assertCustomerCanSubmitProductInquiry({ organizationId, sourceLeadId });
    await assertNoOpenInquiryRequest({ organizationId });

    const inquirySummary =
      Array.isArray(productSummary) && productSummary.length
        ? productSummary
        : defaultInquiryProductSummary();

    const row = await insertCustomerProductRequest([
      generateRequestNumber(),
      organizationId,
      customerUserId,
      sourceLeadId,
      INQUIRY_REQUEST_TYPE,
      JSON.stringify([]),
      JSON.stringify(inquirySummary),
      null,
      note,
      tenantId,
      companyName,
      contactEmail,
      JSON.stringify([]),
    ]);

    const base = mapRequestRow(row);
    emitProductRequestEvent("product_request.submitted", base);
    const mapped = await enrichRequestWithSalesperson(base);
    return mapped;
  }

  if (!normalizedAssignments.length) {
    throw new Error("At least one product assignment is required.");
  }

  const normalizedNewBranches = normalizeNewBranches(newBranches);
  assertNewBranchesHaveProducts(normalizedNewBranches, normalizedAssignments);

  if (normalizedNewBranches.length) {
    const { getLeadById } = await import("../leads/lead-store.js");
    const { validateLeadPayload } = await import("../leads/contact-validation.js");
    const lead = await getLeadById(sourceLeadId);
    if (!lead) {
      throw new Error("Linked sales account not found for this customer.");
    }
    const existingAddresses = Array.isArray(lead.additionalAddresses)
      ? lead.additionalAddresses
      : [];
    const mergedAddresses = [...existingAddresses];
    for (const branch of normalizedNewBranches) {
      const index = mergedAddresses.findIndex((entry) => String(entry.id) === branch.id);
      if (index >= 0) {
        mergedAddresses[index] = branch;
      } else {
        mergedAddresses.push(branch);
      }
    }
    await validateLeadPayload(
      {
        workEmail: lead.workEmail || contactEmail || "",
        adminEmail: lead.adminEmail || "",
        mobileCountryCode: lead.mobileCountryCode || "+91",
        mobileNumber: lead.mobileNumber || "",
        secondaryMobileCountryCode: lead.secondaryMobileCountryCode || "+91",
        secondaryMobileNumber: lead.secondaryMobileNumber || "",
        taxNumber: lead.taxNumber || "",
        state: lead.state || "",
        country: lead.country || normalizedNewBranches[0]?.country || "",
        billingAddress: lead.billingAddress || "",
        additionalAddresses: mergedAddresses,
      },
      { ignoreLeadId: sourceLeadId },
    );
  }

  await assertNoConflictingCancellation({ organizationId, assignments: normalizedAssignments });
  await assertUpgradePlanIsHigher({ organizationId, assignments: normalizedAssignments });
  await assertNoAlreadyOwnedNewProduct({
    organizationId,
    sourceLeadId,
    assignments: normalizedAssignments,
  });
  await assertNoOpenProductRequestConflict({
    organizationId,
    assignments: normalizedAssignments,
  });

  const row = await insertCustomerProductRequest([
    generateRequestNumber(),
    organizationId,
    customerUserId,
    sourceLeadId,
    normalizedRequestType,
    JSON.stringify(normalizedAssignments),
    JSON.stringify(productSummary),
    branchSummary ? JSON.stringify(branchSummary) : null,
    note,
    tenantId,
    companyName,
    contactEmail,
    JSON.stringify(normalizedNewBranches),
  ]);

  const base = mapRequestRow(row);
  emitProductRequestEvent("product_request.submitted", base);
  const mapped = await enrichRequestWithSalesperson(base);
  return mapped;
}

export async function updateCustomerProductRequest({
  requestId,
  organizationId,
  requestType = "new",
  assignments = [],
  productSummary = [],
  branchSummary = null,
  newBranches = [],
  customerNote = "",
  sourceLeadId = null,
  contactEmail = "",
}: any) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new Error("At least one product assignment is required.");
  }

  const existing = await getCustomerProductRequest(requestId, organizationId);
  if (!existing) {
    throw new Error("Product request not found.");
  }
  if (String(existing.status || "") !== "submitted") {
    throw new Error("This request can no longer be edited.");
  }
  if (String(existing.requestType || "").trim().toLowerCase() === "inquiry") {
    throw new Error("Product inquiries cannot be edited. Notify sales again instead.");
  }
  if (!canEditOpenProductRequest(existing)) {
    throw new Error(
      "This request already has a quotation in progress. Notify sales again instead of editing.",
    );
  }

  const normalizedNewBranches = normalizeNewBranches(newBranches);
  assertNewBranchesHaveProducts(normalizedNewBranches, assignments);

  if (normalizedNewBranches.length && sourceLeadId) {
    const { getLeadById } = await import("../leads/lead-store.js");
    const { validateLeadPayload } = await import("../leads/contact-validation.js");
    const lead = await getLeadById(sourceLeadId);
    if (!lead) {
      throw new Error("Linked sales account not found for this customer.");
    }
    const existingAddresses = Array.isArray(lead.additionalAddresses)
      ? lead.additionalAddresses
      : [];
    const mergedAddresses = [...existingAddresses];
    for (const branch of normalizedNewBranches) {
      const index = mergedAddresses.findIndex((entry) => String(entry.id) === branch.id);
      if (index >= 0) {
        mergedAddresses[index] = branch;
      } else {
        mergedAddresses.push(branch);
      }
    }
    await validateLeadPayload(
      {
        workEmail: lead.workEmail || contactEmail || "",
        adminEmail: lead.adminEmail || "",
        mobileCountryCode: lead.mobileCountryCode || "+91",
        mobileNumber: lead.mobileNumber || "",
        secondaryMobileCountryCode: lead.secondaryMobileCountryCode || "+91",
        secondaryMobileNumber: lead.secondaryMobileNumber || "",
        taxNumber: lead.taxNumber || "",
        state: lead.state || "",
        country: lead.country || normalizedNewBranches[0]?.country || "",
        billingAddress: lead.billingAddress || "",
        additionalAddresses: mergedAddresses,
      },
      { ignoreLeadId: sourceLeadId },
    );
  }

  await assertNoConflictingCancellation({ organizationId, assignments });
  await assertUpgradePlanIsHigher({ organizationId, assignments });
  await assertNoAlreadyOwnedNewProduct({
    organizationId,
    sourceLeadId: sourceLeadId || existing.sourceLeadId,
    assignments,
  });
  await assertNoOpenProductRequestConflict({
    organizationId,
    assignments,
    ignoreRequestId: requestId,
  });

  const row = await updateCustomerProductRequestDetails(requestId, organizationId, {
    requestType,
    assignments,
    productSummary,
    branchSummary,
    newBranches: normalizedNewBranches,
    customerNote,
  });

  if (!row) {
    throw new Error("This request can no longer be edited.");
  }

  const updated = await getCustomerProductRequest(requestId, organizationId);
  emitProductRequestEvent("product_request.updated", updated);
  return updated;
}

export async function renotifyCustomerProductRequest({ requestId, organizationId }: any) {
  const existing = await getCustomerProductRequest(requestId, organizationId);
  if (!existing) {
    return null;
  }
  if (String(existing.status || "") !== "submitted") {
    throw new Error("This request can no longer be sent to sales.");
  }
  if (!canNotifyOpenProductRequest(existing)) {
    throw new Error("This request is already completed or withdrawn.");
  }

  const touched = await touchCustomerProductRequest(requestId, organizationId);
  if (!touched) {
    return null;
  }

  const refreshed = await getCustomerProductRequest(requestId, organizationId);
  emitProductRequestEvent("product_request.updated", refreshed);
  return refreshed;
}

/**
 * Copy draft newBranches from a product request onto the lead additional addresses
 * (and branches table) so sales can quote. Does NOT refresh organization_locations —
 * portal Locations pick up the branch after payment/fulfillment.
 */
export async function materializeProductRequestNewBranches(requestId: any) {
  const row = await selectCustomerProductRequestById(pool, requestId);
  if (!row) {
    throw new Error("Product request not found.");
  }

  const newBranches = normalizeNewBranches(
    typeof row.new_branches === "string" ? JSON.parse(row.new_branches) : row.new_branches,
  );
  if (!newBranches.length) {
    return { materialized: false, leadId: row.source_lead_id, count: 0 };
  }

  const { getLeadById, updateLead } = await import("../leads/lead-store.js");
  const lead = await getLeadById(row.source_lead_id);
  if (!lead) {
    throw new Error("Linked lead not found for product request.");
  }

  const existing = Array.isArray(lead.additionalAddresses) ? lead.additionalAddresses : [];
  const byId = new Map(existing.map((entry: any) => [String(entry.id), entry]));
  for (const branch of newBranches) {
    byId.set(branch.id, { ...branch });
  }

  await updateLead(lead.id, {
    additionalAddresses: [...byId.values()],
  });

  return {
    materialized: true,
    leadId: lead.id,
    count: newBranches.length,
  };
}

export async function cancelCustomerProductRequest({
  requestId,
  organizationId,
  customerUserId,
}: any) {
  const row = await cancelCustomerProductRequestRow(requestId, organizationId, customerUserId);
  if (!row) {
    return null;
  }
  const mapped = await enrichRequestWithSalesperson(mapRequestRow(row));
  emitProductRequestEvent("product_request.cancelled", mapped);
  return mapped;
}

function assignmentKey(productId: any, branchId: any) {
  return `${String(productId || "").trim()}::${String(branchId || "hq").trim()}`;
}

function isAssignmentCoveredByPaidKeys(entry: any, paidKeys: any) {
  const productId = String(entry.productId || entry.product_id || "").trim();
  if (!productId) {
    return false;
  }
  const rawBranch = entry.branchId ?? entry.branch_id;
  const branchId = rawBranch == null || String(rawBranch).trim() === "" ? "" : String(rawBranch).trim();
  if (!branchId) {
    // Defensive: request row missing branch — covered if any paid branch for this product.
    const prefix = `${productId}::`;
    for (const key of paidKeys) {
      if (String(key).startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }
  return paidKeys.has(assignmentKey(productId, branchId));
}

function parseJsonList(value: any) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value: any) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function rebuildBranchSummary(assignments: any, previousSummary: any) {
  const branchIds = [
    ...new Set(
      assignments.map((entry: any) => String(entry.branchId || "hq").trim()).filter(Boolean),
    ),
  ];
  if (!branchIds.length) {
    return null;
  }

  const previous = parseJsonObject(previousSummary) || {};
  const previousLabels = Array.isArray(previous.branchLabels) ? previous.branchLabels : [];
  const labelById = new Map();
  if (Array.isArray(previous.branches)) {
    for (const branch of previous.branches) {
      const id = String(branch?.id || branch?.branchId || "").trim();
      if (id) {
        labelById.set(id, branch.label || branch.branchLabel || id);
      }
    }
  }

  const branchLabels = branchIds.map((id, index) => {
    if (labelById.has(id)) {
      return labelById.get(id);
    }
    if (previousLabels[index]) {
      return previousLabels[index];
    }
    return id === "hq" ? "HQ" : id;
  });

  return {
    ...previous,
    branchIds,
    branchLabels,
    branchLabel: branchLabels[0] || previous.branchLabel || "",
  };
}

/**
 * After Finance approves a quotation linked to a product request, remove the
 * approved product(s) from partial requests or close the request when fully covered
 * (including inquiry requests with no pre-configured assignments).
 */
export async function trimApprovedProductsFromLinkedRequest(client: any, quotation: any) {
  const requestId =
    quotation?.sourceProductRequestId || quotation?.source_product_request_id || null;
  if (!requestId || !quotation?.id) {
    return null;
  }

  const quoteAssignments =
    Array.isArray(quotation.assignments) && quotation.assignments.length
      ? quotation.assignments
      : (await selectAssignmentsByQuotation(client, quotation.id)).map((row: any) => ({
          productId: row.product_id,
          branchId: row.branch_id,
        }));

  const approvedProductIds = new Set(
    quoteAssignments
      .map((entry: any) => String(entry.productId || entry.product_id || "").trim())
      .filter(Boolean),
  );

  if (!approvedProductIds.size) {
    return null;
  }

  const requestRow = await selectCustomerProductRequestById(client, requestId);
  if (!requestRow || requestRow.status !== "submitted") {
    return null;
  }

  const assignments = parseJsonList(requestRow.assignments);
  const productSummary = parseJsonList(requestRow.product_summary);
  const isInquiry = isInquiryRequestType(requestRow.request_type);

  if (isInquiry || !assignments.length) {
    const row = await fulfillCustomerProductRequestRow(client, requestId);
    if (!row) {
      return null;
    }
    const mapped = mapRequestRow(row);
    emitProductRequestEvent("product_request.fulfilled", mapped);
    return mapped;
  }

  const remainingAssignments = assignments.filter(
    (entry) => !approvedProductIds.has(String(entry.productId || "").trim()),
  );
  const remainingSummary = productSummary.filter(
    (entry) => !approvedProductIds.has(String(entry.productId || "").trim()),
  );

  if (remainingAssignments.length === assignments.length) {
    return mapRequestRow(requestRow);
  }

  if (!remainingAssignments.length) {
    const row = await fulfillCustomerProductRequestRow(client, requestId);
    if (!row) {
      return null;
    }
    const mapped = mapRequestRow(row);
    emitProductRequestEvent("product_request.fulfilled", mapped);
    return mapped;
  }

  const branchSummary = rebuildBranchSummary(
    remainingAssignments,
    requestRow.branch_summary,
  );
  const updated = await updateCustomerProductRequestAssignments(client, requestId, {
    assignments: remainingAssignments,
    productSummary: remainingSummary,
    branchSummary,
  });
  if (!updated) {
    return null;
  }
  const mapped = mapRequestRow(updated);
  emitProductRequestEvent("product_request.updated", mapped);
  return mapped;
}

/**
 * After a quotation is Paid, mark the linked customer product request fulfilled
 * once remaining request assignments are covered by Paid quotes (or the request is empty).
 * Falls back to matching submitted requests whose assignments are covered by this quote.
 */
export async function fulfillLinkedProductRequestIfComplete(client: any, quotationRow: any) {
  if (!quotationRow?.id) {
    return null;
  }

  const quotationId = quotationRow.id;
  const leadId = quotationRow.lead_id || quotationRow.leadId;
  let requestId =
    quotationRow.source_product_request_id || quotationRow.sourceProductRequestId || null;

  const thisQuoteAssignments = await selectAssignmentsByQuotation(client, quotationId);
  const thisQuotePaidKeys = new Set(
    thisQuoteAssignments.map((row: any) => assignmentKey(row.product_id, row.branch_id)),
  );

  if (!requestId && leadId && thisQuotePaidKeys.size) {
    const candidates = await selectSubmittedProductRequestsByLeadId(client, leadId);
    for (const candidate of candidates) {
      const assignments = parseJsonList(candidate.assignments);
      // Inquiries have no product assignments — do not attach/fulfill them from an
      // unrelated paid quote. Only close inquiries when the quote was linked explicitly.
      if (!assignments.length) {
        continue;
      }
      const covered = assignments.every((entry) =>
        isAssignmentCoveredByPaidKeys(entry, thisQuotePaidKeys),
      );
      if (covered) {
        requestId = candidate.id;
        break;
      }
    }
  }

  if (!requestId) {
    return null;
  }

  // Persist link when resolved via fallback so later multi-quote coverage works.
  const existingLink =
    quotationRow.source_product_request_id || quotationRow.sourceProductRequestId || null;
  if (!existingLink) {
    await client.query(
      `UPDATE quotations
       SET source_product_request_id = $1
       WHERE id = $2 AND source_product_request_id IS NULL`,
      [requestId, quotationId],
    );
  }

  const requestRow = await selectCustomerProductRequestById(client, requestId);
  if (!requestRow || requestRow.status !== "submitted") {
    return null;
  }

  const remainingAssignments = parseJsonList(requestRow.assignments);

  // Request was fully trimmed on approve — close it once Paid.
  if (!remainingAssignments.length) {
    const row = await fulfillCustomerProductRequestRow(client, requestId);
    if (!row) {
      return null;
    }
    const mapped = mapRequestRow(row);
    emitProductRequestEvent("product_request.fulfilled", mapped);
    return mapped;
  }

  const { rows: linked } = await client.query(
    `SELECT id, status FROM quotations WHERE source_product_request_id = $1`,
    [requestId],
  );

  const paidQuoteIds = new Set(
    linked.filter((row: any) => row.status === QUOTATION_STATUSES.PAID).map((row: any) => row.id),
  );
  // Always count this paid quotation, even when the link was missing and resolved by fallback.
  paidQuoteIds.add(quotationId);

  const paidKeys = new Set(thisQuotePaidKeys);
  for (const paidId of paidQuoteIds) {
    if (paidId === quotationId) {
      continue;
    }
    const paidAssignments = await selectAssignmentsByQuotation(client, paidId);
    for (const row of paidAssignments) {
      paidKeys.add(assignmentKey(row.product_id, row.branch_id));
    }
  }

  const remainingCovered = remainingAssignments.every((entry) =>
    isAssignmentCoveredByPaidKeys(entry, paidKeys),
  );
  if (!remainingCovered) {
    return null;
  }

  const row = await fulfillCustomerProductRequestRow(client, requestId);
  if (!row) {
    return null;
  }
  const mapped = mapRequestRow(row);
  emitProductRequestEvent("product_request.fulfilled", mapped);
  return mapped;
}
