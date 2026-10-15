import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { getProductName } from "../../lib/productCatalog.js";
import { getLeadById } from "../leads/lead-store.js";
import {
  BILLING_PHASES,
  billingChangePhaseLabel,
  isBillingChangePhase,
  isMrrAdjustmentBillingPhase,
  isRenewalCancelBillingPhase,
} from "../payments/billingPhases.js";
import { createQuotationsForFinance, getQuotation } from "../quotations/quotation-store.js";
import { QUOTATION_STATUSES } from "../../lib/statuses.js";
import { transitionQuotationStatus } from "../../repositories/functions/quotations.repo.js";
import * as quotationsRepo from "../../repositories/raw/quotations.repo.js";
import { cancelRenewalEventsForSubscription } from "../../repositories/raw/renewals.repo.js";
import {
  selectSubscriptionById,
  updateSubscriptionMrr,
} from "../../repositories/raw/subscriptions.repo.js";
import { publishQuotationEvent } from "../../infra/events.js";
import { resolveLeadPortalEventContext } from "../leads/portal-event-context.js";

const OPEN_SALES_STATUSES = [
  QUOTATION_STATUSES.PENDING,
  QUOTATION_STATUSES.APPROVED,
  QUOTATION_STATUSES.REJECTED,
];

const OPEN_BILLING_CHANGE_STATUSES = [QUOTATION_STATUSES.PENDING, QUOTATION_STATUSES.APPROVED];

const BILLING_CHANGE_PHASES = [BILLING_PHASES.MRR_ADJUSTMENT, BILLING_PHASES.RENEWAL_CANCEL];

function formatMoneyLabel(amount: any, currency = "INR") {
  const value = Number(amount) || 0;
  return `${currency} ${value.toLocaleString("en-IN")}`;
}

function quotationScopeProductKey(productId: any, branchId: any) {
  if (!productId) {
    return null;
  }
  return `${String(productId)}::${String(branchId || "hq")}`;
}

function submittedAtMs(value: any) {
  if (!value) {
    return 0;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Group non-rejected assignment rows into per-quotation supersession scopes.
 * @param {Array<{ id: string, status?: string, submitted_at?: any, submittedAt?: any, source_product_request_id?: any, sourceProductRequestId?: any, product_id?: any, productId?: any, branch_id?: any, branchId?: any }>} rows
 */
export function buildNonRejectedQuotationScopes(rows: any[] = []) {
  const byId = new Map();
  for (const row of rows || []) {
    const id = row?.id;
    if (!id) {
      continue;
    }
    let scope = byId.get(id);
    if (!scope) {
      scope = {
        id,
        status: row.status || null,
        submittedAt: row.submitted_at ?? row.submittedAt ?? null,
        sourceProductRequestId:
          row.source_product_request_id || row.sourceProductRequestId || null,
        productKeys: new Set(),
      };
      byId.set(id, scope);
    }
    const key = quotationScopeProductKey(
      row.product_id ?? row.productId,
      row.branch_id ?? row.branchId,
    );
    if (key) {
      scope.productKeys.add(key);
    }
  }
  return [...byId.values()];
}

/**
 * Rejected open quotes stay visible for Redo until a newer non-rejected quote
 * covers the same product request or overlapping product+branch.
 */
export function isRejectedQuotationSuperseded(
  rejected: {
    id: any;
    submittedAt?: any;
    sourceProductRequestId?: any;
    assignments?: Array<{ productId?: any; branchId?: any }>;
    productSummary?: Array<{ productId?: any; branchId?: any }>;
  },
  scopes: Array<{
    id: any;
    submittedAt?: any;
    sourceProductRequestId?: any;
    productKeys?: Set<string>;
  }> = [],
) {
  if (!rejected?.id) {
    return false;
  }

  const rejectedMs = submittedAtMs(rejected.submittedAt);
  const rejectedRequestId = rejected.sourceProductRequestId || null;
  const rejectedKeys = new Set<string>();
  for (const entry of rejected.assignments || []) {
    const key = quotationScopeProductKey(entry?.productId, entry?.branchId);
    if (key) {
      rejectedKeys.add(key);
    }
  }
  if (rejectedKeys.size === 0) {
    for (const entry of rejected.productSummary || []) {
      const key = quotationScopeProductKey(entry?.productId, entry?.branchId);
      if (key) {
        rejectedKeys.add(key);
      }
    }
  }

  for (const scope of scopes) {
    if (!scope?.id || scope.id === rejected.id) {
      continue;
    }
    const scopeMs = submittedAtMs(scope.submittedAt);
    if (scopeMs < rejectedMs) {
      continue;
    }
    if (scopeMs === rejectedMs && String(scope.id) <= String(rejected.id)) {
      continue;
    }

    if (
      rejectedRequestId &&
      scope.sourceProductRequestId &&
      String(scope.sourceProductRequestId) === String(rejectedRequestId)
    ) {
      return true;
    }

    const scopeKeys = scope.productKeys || new Set();
    for (const key of rejectedKeys) {
      if (scopeKeys.has(key)) {
        return true;
      }
    }
  }

  return false;
}

export function filterOpenQuotationsHidingSupersededRejected(
  quotations: any[] = [],
  nonRejectedScopeRows: any[] = [],
) {
  const scopes = buildNonRejectedQuotationScopes(nonRejectedScopeRows);
  return (quotations || []).filter((quotation) => {
    if (quotation?.status !== QUOTATION_STATUSES.REJECTED) {
      return true;
    }
    return !isRejectedQuotationSuperseded(quotation, scopes);
  });
}

function salesStatusLabel(status: any, billingPhase: any) {
  if (status === QUOTATION_STATUSES.PENDING) {
    if (isBillingChangePhase(billingPhase)) {
      return "Waiting for finance approval";
    }
    return "Waiting for approval";
  }
  if (status === QUOTATION_STATUSES.APPROVED) {
    if (isBillingChangePhase(billingPhase)) {
      return billingChangePhaseLabel(billingPhase) || "Approved";
    }
    return "Awaiting payment";
  }
  if (status === QUOTATION_STATUSES.REJECTED) {
    return "Rejected";
  }
  return status || "Unknown";
}

function canViewInvoice(status: any, hasPdf: any) {
  if (!hasPdf) {
    return false;
  }
  return (
    status === QUOTATION_STATUSES.PENDING ||
    status === QUOTATION_STATUSES.APPROVED ||
    status === QUOTATION_STATUSES.REJECTED ||
    status === QUOTATION_STATUSES.PAID
  );
}

function canRedoPricing(status: any, billingPhase: any) {
  return status === QUOTATION_STATUSES.REJECTED && !isBillingChangePhase(billingPhase);
}

function canRedoBillingChange(status: any, billingPhase: any) {
  return status === QUOTATION_STATUSES.REJECTED && isBillingChangePhase(billingPhase);
}

function resolveBranchLabel(lead: any, branchId: any) {
  if (!branchId || branchId === "hq") {
    return lead?.companyName || "Head office";
  }
  const match = (lead?.additionalAddresses || []).find((entry: any) => entry.id === branchId);
  return match?.label || branchId;
}

function extractBillingChangeConfig(assignments = []) {
  for (const assignment of assignments) {
    const config = (assignment as any)?.config || {};
    if (config.isBillingChange || config.subscriptionId || config.subscription_id) {
      return {
        subscriptionId: config.subscriptionId || config.subscription_id || null,
        currentMrr:
          config.currentMrr !== undefined && config.currentMrr !== null
            ? Number(config.currentMrr)
            : null,
        proposedMonthlyPrice:
          config.proposedMonthlyPrice !== undefined && config.proposedMonthlyPrice !== null
            ? Number(config.proposedMonthlyPrice)
            : null,
        note: config.billingChangeNote || config.note || "",
        productId: (assignment as any).productId || null,
        branchId: (assignment as any).branchId || "hq",
      };
    }
  }
  return null;
}

export async function listOpenQuotationsForLead(leadId: any) {
  const [rows, nonRejectedScopeRows] = await Promise.all([
    quotationsRepo.selectOpenQuotationsByLeadId(pool, leadId, OPEN_SALES_STATUSES),
    quotationsRepo.selectNonRejectedQuotationScopesByLeadId(
      pool,
      leadId,
      QUOTATION_STATUSES.REJECTED,
    ),
  ]);
  const lead = await getLeadById(leadId);
  const quotations = [];

  for (const row of rows) {
    const base = rowToCamel(row);
    const assignments = (await quotationsRepo.selectAssignmentsByQuotation(pool, (base as any).id)).map(
      (entry: any) => {
        const mapped = rowToCamel(entry);
        return {
          ...mapped,
          config:
            typeof (mapped as any).config === "string"
              ? JSON.parse((mapped as any).config)
              : (mapped as any).config || null,
        };
      },
    );
    const productSummary = (await quotationsRepo.selectProductSummaryByQuotation(pool, (base as any).id)).map(
      (entry: any) => rowToCamel(entry),
    );
    const billingChange = extractBillingChangeConfig(assignments);
    const hasPdf = (base as any).hasPdf === true;
    const status = (base as any).status;
    const billingPhase = (base as any).billingPhase || BILLING_PHASES.STANDARD;

    quotations.push({
      id: (base as any).id,
      leadId: (base as any).leadId,
      status,
      statusLabel: salesStatusLabel(status, billingPhase),
      billingPhase,
      billingPhaseLabel: billingChangePhaseLabel(billingPhase),
      isBillingChange: isBillingChangePhase(billingPhase),
      fileName: (base as any).fileName || "",
      hasInvoice: hasPdf,
      canViewInvoice: canViewInvoice(status, hasPdf),
      canRedoPricing: canRedoPricing(status, billingPhase),
      canRedoBillingChange: canRedoBillingChange(status, billingPhase),
      sourceProductRequestId: (base as any).sourceProductRequestId || null,
      grandTotal: (base as any).grandTotal !== null ? Number((base as any).grandTotal) : null,
      subtotal: (base as any).subtotal !== null ? Number((base as any).subtotal) : null,
      currency: (base as any).currency || "INR",
      financeNote: (base as any).financeNote || "",
      submittedBy: (base as any).submittedBy || "",
      submittedAt: toIso((base as any).submittedAt),
      reviewedAt: toIso((base as any).reviewedAt),
      reviewedBy: (base as any).reviewedBy || null,
      productSummary: productSummary.map((item: any) => ({
        productId: item.productId || null,
        name: item.name || getProductName(item.productId) || "Product",
        priceLabel: item.priceLabel || "",
        branchLabel: item.branchLabel || "",
        billingLabel: item.billingLabel || "",
        changeTypeLabel: item.changeTypeLabel || "",
      })),
      assignments: assignments.map((entry: any) => ({
        productId: entry.productId,
        branchId: entry.branchId,
        billingBranchId: entry.billingBranchId || entry.branchId,
        changeType: entry.changeType,
        config: entry.config,
      })),
      billingChange,
      payment: (base as any).paymentId
        ? {
            id: (base as any).paymentId,
            status: (base as any).paymentStatus || "pending",
            paymentLinkUrl: (base as any).paymentLinkUrl || "",
            grandTotal:
              (base as any).paymentGrandTotal !== null && (base as any).paymentGrandTotal !== undefined
                ? Number((base as any).paymentGrandTotal)
                : null,
            paidAt: toIso((base as any).paymentPaidAt),
          }
        : null,
      branchLabel:
        productSummary[0]?.branchLabel ||
        resolveBranchLabel(lead, assignments[0]?.branchId || "hq"),
    });
  }

  // Hide Rejected rows once a newer Pending/Approved/Paid quote covers the same
  // product request or product+branch (Redo history stays in payment/audit elsewhere).
  return filterOpenQuotationsHidingSupersededRejected(quotations, nonRejectedScopeRows);
}

export async function createSubscriptionBillingChange({
  leadId,
  subscriptionId,
  type,
  proposedMonthlyPrice,
  note = "",
  submittedBy = "",
}: any) {
  const changeType = String(type || "").trim();
  if (
    changeType !== BILLING_PHASES.MRR_ADJUSTMENT &&
    changeType !== BILLING_PHASES.RENEWAL_CANCEL
  ) {
    const error = new Error("type must be mrr_adjustment or renewal_cancel.");
    (error as any).status = 400;
    throw error;
  }

  const lead = await getLeadById(leadId);
  if (!lead) {
    const error = new Error("Lead not found.");
    (error as any).status = 404;
    throw error;
  }

  const subscriptionRow = await selectSubscriptionById(pool, subscriptionId);
  if (!subscriptionRow) {
    const error = new Error("Subscription not found.");
    (error as any).status = 404;
    throw error;
  }

  const subscription = rowToCamel(subscriptionRow);
  if (String((subscription as any).sourceLeadId || "") !== String(leadId)) {
    const error = new Error("Subscription does not belong to this customer.");
    (error as any).status = 403;
    throw error;
  }
  if ((subscription as any).status !== "active") {
    const error = new Error("Only active subscriptions can change recurring billing.");
    (error as any).status = 400;
    throw error;
  }
  if (!(subscription as any).paymentConfirmedAt) {
    const error = new Error("Subscription payment must be confirmed before changing billing.");
    (error as any).status = 400;
    throw error;
  }

  const existing = await quotationsRepo.selectOpenBillingChangeQuotationsForSubscription(pool, {
    leadId,
    subscriptionId,
    phases: BILLING_CHANGE_PHASES,
    statuses: OPEN_BILLING_CHANGE_STATUSES,
  });
  if (existing.length) {
    const error = new Error(
      "A billing change for this subscription is already waiting for finance.",
    );
    (error as any).status = 409;
    throw error;
  }

  const entitlementConfig =
    typeof (subscription as any).entitlementConfig === "string"
      ? JSON.parse((subscription as any).entitlementConfig)
      : (subscription as any).entitlementConfig || {};
  const currency = entitlementConfig.currency || "INR";
  const currentMrr = Number((subscription as any).mrr) || 0;
  const productId = (subscription as any).productId;
  const branchId = (subscription as any).branchId || "hq";
  const branchLabel = resolveBranchLabel(lead, branchId);
  const productName = getProductName(productId);
  const trimmedNote = String(note || "").trim();

  let proposed = null;
  if (changeType === BILLING_PHASES.MRR_ADJUSTMENT) {
    proposed = Number(proposedMonthlyPrice);
    if (!Number.isFinite(proposed) || proposed < 0) {
      const error = new Error("proposedMonthlyPrice must be a non-negative number.");
      (error as any).status = 400;
      throw error;
    }
    if (Math.abs(proposed - currentMrr) < 0.0001) {
      const error = new Error("Proposed price must differ from the current monthly price.");
      (error as any).status = 400;
      throw error;
    }
  }

  const priceLabel =
    changeType === BILLING_PHASES.MRR_ADJUSTMENT
      ? `${formatMoneyLabel(currentMrr, currency)} → ${formatMoneyLabel(proposed, currency)}/mo`
      : "Cancel next renewal invoice";
  const changeTypeLabel = billingChangePhaseLabel(changeType);
  const amount = changeType === BILLING_PHASES.MRR_ADJUSTMENT ? proposed : 0;

  const payload = {
    leadId,
    lead,
    billingPhase: changeType,
    skipDuplicatePurchaseCheck: true,
    skipLeadStatusUpdate: true,
    assignments: [
      {
        productId,
        branchId,
        billingBranchId: branchId,
        changeType,
        config: {
          ...entitlementConfig,
          isBillingChange: true,
          billingChangeType: changeType,
          subscriptionId,
          currentMrr,
          proposedMonthlyPrice: proposed,
          billingChangeNote: trimmedNote,
          currency,
        },
      },
    ],
    productSummary: [
      {
        productId,
        name: productName,
        priceLabel,
        branchLabel,
        billingLabel: branchLabel,
        changeTypeLabel,
      },
    ],
    invoices: [],
    invoiceMode: "consolidated",
    branchSummary: {
      productCount: 1,
      branchCount: 1,
      billingGroupCount: 1,
      branchLabels: [branchLabel],
    },
    subtotal: amount,
    grandTotal: amount,
    currency,
    gstRate: 0,
    payment: {
      subtotal: amount,
      grandTotal: amount,
      currency,
      gstRate: 0,
      billingPhase: changeType,
    },
    submittedBy: submittedBy || "",
    fileName: `${changeType}-${productId}-${branchId}-${Date.now()}.pdf`,
    pdfBase64: null,
  };

  const { quotations } = await createQuotationsForFinance(payload);
  const quotation = quotations?.[0] || null;
  if (!quotation) {
    throw new Error("Could not create billing change request.");
  }

  return quotation;
}

async function supersedeOpenRenewalQuotations(client: any, subscriptionId: any) {
  const { rows } = await client.query(
    `SELECT re.id AS renewal_event_id, re.renewal_quotation_id, q.status
     FROM renewal_events re
     LEFT JOIN quotations q ON q.id = re.renewal_quotation_id
     WHERE re.subscription_id = $1
       AND re.status NOT IN ('completed', 'cancelled')
       AND re.renewal_quotation_id IS NOT NULL`,
    [subscriptionId],
  );

  for (const row of rows) {
    const status = row.status;
    if (status === QUOTATION_STATUSES.PENDING || status === QUOTATION_STATUSES.APPROVED) {
      try {
        await transitionQuotationStatus(client, {
          quotationId: row.renewal_quotation_id,
          fromStatus: status,
          toStatus: QUOTATION_STATUSES.REJECTED,
          financeNote: "Superseded by approved billing change.",
          reviewedBy: "system",
        });
      } catch {
        // Ignore transition races; renewal event cancel still proceeds.
      }
    }
  }

  await cancelRenewalEventsForSubscription(client, subscriptionId);
}

async function applyMrrAdjustment(client: any, quotation: any) {
  const billingChange = extractBillingChangeConfig(quotation.assignments || []);
  if (!billingChange?.subscriptionId) {
    throw new Error("MRR adjustment is missing subscription reference.");
  }
  if (!Number.isFinite(billingChange.proposedMonthlyPrice)) {
    throw new Error("MRR adjustment is missing proposed monthly price.");
  }

  const subscriptionRow = await selectSubscriptionById(client, billingChange.subscriptionId);
  if (!subscriptionRow) {
    throw new Error("Subscription not found for MRR adjustment.");
  }
  const subscription = rowToCamel(subscriptionRow);
  const entitlementConfig =
    typeof (subscription as any).entitlementConfig === "string"
      ? JSON.parse((subscription as any).entitlementConfig)
      : { ...((subscription as any).entitlementConfig || {}) };

  entitlementConfig.monthlyBasePrice = billingChange.proposedMonthlyPrice;
  const currency = entitlementConfig.currency || quotation.currency || "INR";
  const priceLabel = formatMoneyLabel(billingChange.proposedMonthlyPrice, currency);

  await updateSubscriptionMrr(client, billingChange.subscriptionId, {
    mrr: billingChange.proposedMonthlyPrice,
    entitlementConfig,
    priceLabel: `${priceLabel}/mo`,
  });

  // Drop open renewal quotes at the old price; next sweep regenerates from new MRR.
  const { rows: openRenewals } = await client.query(
    `SELECT re.id, re.renewal_quotation_id, re.status AS renewal_status, q.status AS quotation_status
     FROM renewal_events re
     LEFT JOIN quotations q ON q.id = re.renewal_quotation_id
     WHERE re.subscription_id = $1
       AND re.status NOT IN ('completed', 'cancelled')`,
    [billingChange.subscriptionId],
  );

  for (const row of openRenewals) {
    if (
      row.renewal_quotation_id &&
      (row.quotation_status === QUOTATION_STATUSES.PENDING ||
        row.quotation_status === QUOTATION_STATUSES.APPROVED)
    ) {
      try {
        await transitionQuotationStatus(client, {
          quotationId: row.renewal_quotation_id,
          fromStatus: row.quotation_status,
          toStatus: QUOTATION_STATUSES.REJECTED,
          financeNote: "Superseded by approved MRR change.",
          reviewedBy: "system",
        });
      } catch {
        // continue
      }
      await client.query(
        `UPDATE renewal_events
         SET renewal_quotation_id = NULL,
             status = CASE WHEN status = 'quoted' THEN 'pending_quote' ELSE status END,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
    }
  }

  return billingChange;
}

async function applyRenewalCancel(client: any, quotation: any) {
  const billingChange = extractBillingChangeConfig(quotation.assignments || []);
  if (!billingChange?.subscriptionId) {
    throw new Error("Renewal cancel is missing subscription reference.");
  }
  await supersedeOpenRenewalQuotations(client, billingChange.subscriptionId);
  return billingChange;
}

/**
 * Approve a billing-change quotation: apply side effects, mark Paid, do not issue payment links.
 */
export async function approveBillingChangeQuotation(id: any, reviewerEmail: any, note = "") {
  const existing = await getQuotation(id);
  if (!existing) {
    return null;
  }
  if (!isBillingChangePhase(existing.billingPhase)) {
    throw new Error("Quotation is not a billing change request.");
  }
  if (existing.status !== QUOTATION_STATUSES.PENDING) {
    throw new Error(
      `Cannot approve billing change in status "${existing.status}". Refresh the queue and try again.`,
    );
  }

  await withTransaction(async (client) => {
    try {
      await transitionQuotationStatus(client, {
        quotationId: id,
        fromStatus: QUOTATION_STATUSES.PENDING,
        toStatus: QUOTATION_STATUSES.APPROVED,
        financeNote: String(note || "").trim(),
        reviewedBy: reviewerEmail,
      });
    } catch (error) {
      if (String((error as any)?.message || "").includes("QUOTATION_NOT_FOUND")) {
        return;
      }
      throw error;
    }

    const approved = await quotationsRepo.selectQuotationById(client, id);
    const hydrated = rowToCamel(approved);
    const assignments = (await quotationsRepo.selectAssignmentsByQuotation(client, id)).map(
      (entry: any) => {
        const mapped = rowToCamel(entry);
        return {
          ...mapped,
          config:
            typeof (mapped as any).config === "string"
              ? JSON.parse((mapped as any).config)
              : (mapped as any).config || null,
        };
      },
    );
    const quotationLike = {
      ...hydrated,
      billingPhase: (hydrated as any).billingPhase,
      assignments,
      currency: (hydrated as any).currency,
    };

    if (isMrrAdjustmentBillingPhase(quotationLike.billingPhase)) {
      await applyMrrAdjustment(client, quotationLike);
    } else if (isRenewalCancelBillingPhase(quotationLike.billingPhase)) {
      await applyRenewalCancel(client, quotationLike);
    }

    await transitionQuotationStatus(client, {
      quotationId: id,
      fromStatus: QUOTATION_STATUSES.APPROVED,
      toStatus: QUOTATION_STATUSES.PAID,
      financeNote: String(note || "").trim(),
      reviewedBy: reviewerEmail,
    });
  });

  const finalQuotation = await getQuotation(id);
  if (!finalQuotation) {
    return null;
  }

  const portal = await resolveLeadPortalEventContext(finalQuotation.leadId);
  const portalPayload = {
    quotationId: finalQuotation.id,
    leadId: finalQuotation.leadId,
    status: finalQuotation.status,
    billingPhase: finalQuotation.billingPhase,
    ...portal,
  };
  void publishQuotationEvent("quotation.approved", portalPayload);
  void publishQuotationEvent("quotation.paid", portalPayload);

  return finalQuotation;
}

export async function subscriptionHasOpenBillingChange(subscriptionId: any) {
  const ids = await quotationsRepo.selectSubscriptionIdsWithOpenBillingChanges(pool, {
    phases: BILLING_CHANGE_PHASES,
    statuses: OPEN_BILLING_CHANGE_STATUSES,
  });
  return ids.includes(String(subscriptionId));
}

export async function listSubscriptionIdsBlockedFromAutoRenewal() {
  return quotationsRepo.selectSubscriptionIdsWithOpenBillingChanges(pool, {
    phases: BILLING_CHANGE_PHASES,
    statuses: OPEN_BILLING_CHANGE_STATUSES,
  });
}

export async function listSubscriptionIdsWithApprovedRenewalCancel() {
  const { rows } = await pool.query(
    `SELECT DISTINCT COALESCE(pa.config->>'subscriptionId', pa.config->>'subscription_id') AS subscription_id
     FROM quotations q
     JOIN product_assignments pa ON pa.quotation_id = q.id
     WHERE q.billing_phase = $1
       AND q.status = $2
       AND COALESCE(pa.config->>'subscriptionId', pa.config->>'subscription_id') IS NOT NULL
       AND q.reviewed_at >= NOW() - INTERVAL '45 days'`,
    [BILLING_PHASES.RENEWAL_CANCEL, QUOTATION_STATUSES.PAID],
  );
  return rows.map((row) => row.subscription_id).filter(Boolean);
}
