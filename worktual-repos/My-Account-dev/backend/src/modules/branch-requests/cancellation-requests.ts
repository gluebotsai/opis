import crypto from "node:crypto";

import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { cancelProductAtBranch, dropBranch, isBranchInactive, scheduleCancelProductAtBranch, scheduleDropBranch, clearScheduledProductCancellation, clearScheduledBranchDropAtLocation } from "./lifecycle.js";
import {
  deleteActiveProductRow,
  insertBranchCancellationRequest,
  resolveBranchCancellationRequest,
  selectAdminCancellationRequests,
  selectBranchCancellationRequestById,
  selectBranchCancellationRequestsByOrganization,
  selectOrganizationLocation,
  selectPendingCancellationRequest,
  withdrawBranchCancellationRequest,
} from "../../repositories/raw/branchCancellationRequests.repo.js";
import {
  selectSubscriptionById,
  selectSubscriptionByQuotationProductLocation,
} from "../../repositories/raw/subscriptions.repo.js";
import { publishCancellationEvent } from "../../infra/events.js";

export const REQUEST_KINDS = {
  CANCEL_PRODUCT: "cancel_product",
  DROP_BRANCH: "drop_branch",
};

export const REQUEST_STATUSES = {
  SUBMITTED: "submitted",
  AUTO_ESCALATED: "auto_escalated",
  APPROVED: "approved",
  APPROVED_SCHEDULED: "approved_scheduled",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
};

export const EFFECTIVE_TIMINGS = {
  IMMEDIATE: "immediate",
  END_OF_PERIOD: "end_of_period",
};

export const TRIGGER_SOURCES = {
  CUSTOMER: "customer",
  SYSTEM_UNPAID_INITIAL: "system_unpaid_initial",
  SYSTEM_UNPAID_RENEWAL: "system_unpaid_renewal",
};

function generateRequestNumber() {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `BCR-${year}-${suffix}`;
}

function mapRequestRow(row: any) {
  if (!row) {
    return null;
  }

  const entry = rowToCamel(row);
  return {
    id: entry!.id,
    requestNumber: entry!.requestNumber,
    organizationId: entry!.organizationId,
    customerUserId: entry!.customerUserId || null,
    sourceLeadId: entry!.sourceLeadId,
    requestKind: entry!.requestKind,
    branchId: entry!.branchId,
    productId: entry!.productId || null,
    subscriptionId: entry!.subscriptionId || null,
    status: entry!.status,
    triggerSource: entry!.triggerSource || TRIGGER_SOURCES.CUSTOMER,
    graceDeadlineAt: toIso(entry!.graceDeadlineAt),
    relatedQuotationId: entry!.relatedQuotationId || null,
    effectiveTiming: entry!.effectiveTiming || EFFECTIVE_TIMINGS.END_OF_PERIOD,
    effectiveAt: toIso(entry!.effectiveAt),
    customerNote: entry!.customerNote || "",
    adminNote: entry!.adminNote || "",
    tenantId: entry!.tenantId || "",
    companyName: entry!.companyName || entry!.orgCompanyName || "",
    contactEmail: entry!.contactEmail || "",
    resolvedAt: toIso(entry!.resolvedAt),
    resolvedBy: entry!.resolvedBy || "",
    createdAt: toIso(entry!.createdAt),
    updatedAt: toIso(entry!.updatedAt),
  };
}

function assertBranchScope(user: any, branchId: any) {
  if (String(user.branchId || "") !== String(branchId || "")) {
    throw new Error("Branch portal users can only act on their assigned branch.");
  }
}

async function validateLocationActive(client: any, organizationId: any, branchId: any) {
  if (await isBranchInactive(client, organizationId, branchId)) {
    throw new Error("This branch is inactive and cannot accept new requests.");
  }

  const locationRow = await selectOrganizationLocation(client, organizationId, branchId);
  if (locationRow?.scheduled_drop_at) {
    throw new Error("This branch is already scheduled to drop.");
  }
}

function normalizeEffectiveTiming(value: any, { triggerSource }: any = {}) {
  const timing = String(value || "").trim();
  if (timing === EFFECTIVE_TIMINGS.IMMEDIATE || timing === EFFECTIVE_TIMINGS.END_OF_PERIOD) {
    return timing;
  }

  if (
    triggerSource === TRIGGER_SOURCES.SYSTEM_UNPAID_INITIAL ||
    triggerSource === TRIGGER_SOURCES.SYSTEM_UNPAID_RENEWAL
  ) {
    return EFFECTIVE_TIMINGS.IMMEDIATE;
  }

  return EFFECTIVE_TIMINGS.END_OF_PERIOD;
}

function resolveApprovalTiming(request: any, adminOverride: any) {
  const override = String(adminOverride || "").trim();
  if (override === EFFECTIVE_TIMINGS.IMMEDIATE || override === EFFECTIVE_TIMINGS.END_OF_PERIOD) {
    return override;
  }

  return normalizeEffectiveTiming(request.effectiveTiming, { triggerSource: request.triggerSource });
}

function emitCancellationEvent(event: any, request: any) {
  if (!request?.id) {
    return;
  }

  void publishCancellationEvent(event, {
    requestId: request.id,
    organizationId: request.organizationId,
    requestKind: request.requestKind,
    status: request.status,
    branchId: request.branchId,
    subscriptionId: request.subscriptionId || null,
    leadId: request.sourceLeadId || null,
  });
}

export async function listCustomerCancellationRequests(organizationId: any, { branchId = null }: any = {}) {
  const rows = await selectBranchCancellationRequestsByOrganization(pool, organizationId, branchId);
  return rows.map(mapRequestRow);
}

export async function getCancellationRequest(requestId: any) {
  const row = await selectBranchCancellationRequestById(pool, requestId);
  return mapRequestRow(row);
}

export async function createCustomerCancellationRequest({
  organizationId,
  customerUserId,
  customerUser,
  sourceLeadId,
  requestKind,
  branchId,
  productId = null,
  subscriptionId = null,
  customerNote = "",
  effectiveTiming = EFFECTIVE_TIMINGS.END_OF_PERIOD,
  tenantId = "",
  companyName = "",
  contactEmail = "",
}: any) {
  if (!Object.values(REQUEST_KINDS).includes(requestKind)) {
    throw new Error("Invalid cancellation request kind.");
  }

  const resolvedBranchId = String(branchId || "").trim();
  if (!resolvedBranchId) {
    throw new Error("Branch location is required.");
  }

  assertBranchScope(customerUser, resolvedBranchId);

  return withTransaction(async (client: any) => {
    await validateLocationActive(client, organizationId, resolvedBranchId);

    if (requestKind === REQUEST_KINDS.CANCEL_PRODUCT) {
      if (!subscriptionId) {
        throw new Error("Subscription is required to cancel a product.");
      }

      const subRow = await selectSubscriptionById(client, subscriptionId);
      if (!subRow) {
        throw new Error("Subscription not found.");
      }

      const sub = rowToCamel(subRow);
      if (sub!.organizationId !== organizationId) {
        throw new Error("Subscription does not belong to this organization.");
      }
      if (sub!.branchId !== resolvedBranchId) {
        throw new Error("Subscription branch does not match the request.");
      }
      if (sub!.status === "cancelled") {
        throw new Error("This product subscription is already cancelled.");
      }
      if (sub!.cancelAtPeriodEnd) {
        throw new Error("This product is already scheduled to cancel.");
      }

      const pending = await selectPendingCancellationRequest(client, {
        organizationId,
        branchId: resolvedBranchId,
        subscriptionId,
        requestKind,
      });
      if (pending) {
        throw new Error("A pending cancellation request already exists for this product.");
      }
    }

    if (requestKind === REQUEST_KINDS.DROP_BRANCH) {
      const pending = await selectPendingCancellationRequest(client, {
        organizationId,
        branchId: resolvedBranchId,
        subscriptionId: null,
        requestKind,
      });
      if (pending) {
        throw new Error("A pending branch drop request already exists.");
      }
    }

    const timing = normalizeEffectiveTiming(effectiveTiming, { triggerSource: TRIGGER_SOURCES.CUSTOMER });

    const row = await insertBranchCancellationRequest(client, [
      generateRequestNumber(),
      organizationId,
      customerUserId,
      sourceLeadId,
      requestKind,
      resolvedBranchId,
      productId,
      subscriptionId,
      REQUEST_STATUSES.SUBMITTED,
      TRIGGER_SOURCES.CUSTOMER,
      null,
      null,
      customerNote,
      tenantId,
      companyName,
      contactEmail,
      timing,
      null,
    ]);

    const request = mapRequestRow(row);
    emitCancellationEvent("cancellation.submitted", request);
    return request;
  });
}

export async function withdrawCancellationRequest(requestId: any, organizationId: any, customerUserId: any) {
  return withTransaction(async (client: any) => {
    const existing = await selectBranchCancellationRequestById(client, requestId);
    if (!existing) {
      throw new Error("Cancellation request not found.");
    }

    const row = await withdrawBranchCancellationRequest(
      client,
      requestId,
      organizationId,
      customerUserId,
    );

    if (!row) {
      throw new Error("This cancellation request can no longer be withdrawn.");
    }

    const request = mapRequestRow(row);
    if (request!.status === REQUEST_STATUSES.WITHDRAWN && existing.status === "approved_scheduled") {
      if (request!.requestKind === REQUEST_KINDS.CANCEL_PRODUCT && request!.subscriptionId) {
        await clearScheduledProductCancellation(client, request!.subscriptionId);
      } else if (request!.requestKind === REQUEST_KINDS.DROP_BRANCH) {
        await clearScheduledBranchDropAtLocation(client, request!.organizationId, request!.branchId);
      }
    }

    emitCancellationEvent("cancellation.withdrawn", request);
    return request;
  });
}

export async function listAdminCancellationRequests(filters: any = {}) {
  const rows = await selectAdminCancellationRequests(pool, filters);
  return rows.map(mapRequestRow);
}

export async function approveCancellationRequest(
  requestId: any,
  { adminUser, adminNote = "", effectiveTiming = null }: any = {},
) {
  return withTransaction(async (client: any) => {
    const existing = await selectBranchCancellationRequestById(client, requestId);
    if (!existing) {
      throw new Error("Cancellation request not found.");
    }

    const request = mapRequestRow(existing);
    if (![REQUEST_STATUSES.SUBMITTED, REQUEST_STATUSES.AUTO_ESCALATED].includes((request!.status as any))) {
      throw new Error("This request has already been resolved.");
    }

    const timing = resolveApprovalTiming(request, effectiveTiming);
    const reason = adminNote || request!.customerNote || "Approved cancellation request";
    let executionResult = null;
    let resolvedStatus = REQUEST_STATUSES.APPROVED;
    let effectiveAt = null;

    if (request!.requestKind === REQUEST_KINDS.CANCEL_PRODUCT) {
      let subscriptionId = request!.subscriptionId;
      if (!subscriptionId && request!.relatedQuotationId && request!.productId) {
        const matched = await selectSubscriptionByQuotationProductLocation(client, {
          quotationId: request!.relatedQuotationId,
          productId: request!.productId,
          branchId: request!.branchId,
          organizationId: request!.organizationId,
        });
        subscriptionId = matched?.id || null;
      }

      if (subscriptionId) {
        if (timing === EFFECTIVE_TIMINGS.END_OF_PERIOD) {
          executionResult = await scheduleCancelProductAtBranch(client, {
            subscriptionId,
            requestId: request!.id,
            adminUser,
            reason,
          });
          resolvedStatus = REQUEST_STATUSES.APPROVED_SCHEDULED;
          effectiveAt = executionResult.effectiveAt;
        } else {
          executionResult = await cancelProductAtBranch(client, {
            subscriptionId,
            adminUser,
            reason,
          });
        }
      } else if (
        request!.triggerSource === TRIGGER_SOURCES.SYSTEM_UNPAID_INITIAL ||
        request!.relatedQuotationId
      ) {
        // Unpaid-initial cancels may have no subscription row yet — clear approved product marker.
        if (request!.sourceLeadId && request!.productId && request!.branchId) {
          await deleteActiveProductRow(
            client,
            request!.sourceLeadId,
            request!.productId,
            request!.branchId,
          );
        }
        executionResult = {
          unpaidInitial: true,
          subscriptionId: null,
          relatedQuotationId: request!.relatedQuotationId || null,
        };
      } else {
        throw new Error("This cancellation request is missing a subscription and cannot be approved.");
      }
    } else if (request!.requestKind === REQUEST_KINDS.DROP_BRANCH) {
      if (timing === EFFECTIVE_TIMINGS.END_OF_PERIOD) {
        executionResult = await scheduleDropBranch(client, {
          organizationId: request!.organizationId,
          branchId: request!.branchId,
          requestId: request!.id,
          adminUser,
          reason,
        });
        resolvedStatus = REQUEST_STATUSES.APPROVED_SCHEDULED;
        effectiveAt = executionResult.effectiveAt;
      } else {
        executionResult = await dropBranch(client, {
          organizationId: request!.organizationId,
          branchId: request!.branchId,
          adminUser,
          reason,
        });
      }
    } else {
      throw new Error("Unsupported request kind.");
    }

    const resolved = await resolveBranchCancellationRequest(client, requestId, {
      status: resolvedStatus,
      adminNote,
      resolvedBy: adminUser,
      effectiveAt,
    });

    const mapped = mapRequestRow(resolved);
    emitCancellationEvent("cancellation.approved", mapped);

    return {
      request: mapped,
      executionResult,
      effectiveTiming: timing,
    };
  });
}

export async function rejectCancellationRequest(requestId: any, { adminUser, adminNote = "" }: any = {}) {
  if (!adminNote?.trim()) {
    throw new Error("A rejection note is required.");
  }

  const resolved = await resolveBranchCancellationRequest(pool, requestId, {
    status: REQUEST_STATUSES.REJECTED,
    adminNote: adminNote.trim(),
    resolvedBy: adminUser,
  });

  if (!resolved) {
    throw new Error("Cancellation request not found or already resolved.");
  }

  const mapped = mapRequestRow(resolved);
  emitCancellationEvent("cancellation.rejected", mapped);
  return mapped;
}

export async function adminDropBranchDirect({
  organizationId,
  branchId,
  adminUser,
  reason = "Branch dropped by Worktual admin",
  effectiveTiming = EFFECTIVE_TIMINGS.IMMEDIATE,
}: any) {
  if (effectiveTiming === EFFECTIVE_TIMINGS.END_OF_PERIOD) {
    return withTransaction((client: any) =>
      scheduleDropBranch(client, {
        organizationId,
        branchId,
        requestId: null,
        adminUser,
        reason,
      }),
    );
  }

  return withTransaction((client: any) =>
    dropBranch(client, { organizationId, branchId, adminUser, reason }),
  );
}

export async function createSystemCancellationRequest(
  {
    organizationId,
    sourceLeadId,
    requestKind,
    branchId,
    productId = null,
    subscriptionId = null,
    triggerSource,
    graceDeadlineAt,
    relatedQuotationId = null,
    customerNote = "",
    companyName = "",
    tenantId = "",
  }: any,
  client: any = null,
) {
  const resolvedBranchId = String(branchId || "").trim();
  if (!resolvedBranchId) {
    return null;
  }

  const runner = client || pool;

  if (await isBranchInactive(runner, organizationId, resolvedBranchId)) {
    return null;
  }

  const pending = await selectPendingCancellationRequest(runner, {
    organizationId,
    branchId: resolvedBranchId,
    subscriptionId: requestKind === REQUEST_KINDS.CANCEL_PRODUCT ? subscriptionId : null,
    requestKind,
  });
  if (pending) {
    return mapRequestRow(pending);
  }

  const row = await insertBranchCancellationRequest(runner, [
    generateRequestNumber(),
    organizationId,
    null,
    sourceLeadId,
    requestKind,
    resolvedBranchId,
    productId,
    subscriptionId,
    REQUEST_STATUSES.AUTO_ESCALATED,
    triggerSource,
    graceDeadlineAt,
    relatedQuotationId,
    customerNote,
    tenantId,
    companyName,
    "",
    EFFECTIVE_TIMINGS.IMMEDIATE,
    null,
  ]);

  return mapRequestRow(row);
}

export async function getOrganizationLocationStatus(organizationId: any, branchId: any) {
  const row = await selectOrganizationLocation(pool, organizationId, branchId);
  if (!row) {
    return { status: "unknown", label: "Branch" };
  }
  return {
    status: row.status || "active",
    label: row.label || "Branch",
  };
}
