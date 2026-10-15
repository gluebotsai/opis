import crypto from "node:crypto";

import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { activeProductKey } from "../subscriptions/active-product-key.js";
import { subscriptionKey } from "../subscriptions/subscription-key.js";
import { ensureAssignmentBranchRows, getLeadById, loadLeadSnapshot, updateLeadStatus } from "../leads/lead-store.js";
import {
  resolveBranchLabel,
  resolveBranchWorkEmail,
} from "../leads/contact-validation.js";
import { validateAssignmentsForDuplicatePurchase } from "../payments/duplicatePurchase.js";
import { isBillingChangePhase } from "../payments/billingPhases.js";
import { isMidPeriodAddonBilling } from "../../lib/midPeriodAddons.js";
import {
  resolveCcaasNumberEntitlementCounts,
  syncCcaasNumberEntitlementFields,
} from "../../lib/ccaasConfiguration.js";
import { LEAD_STATUSES, QUOTATION_STATUSES } from "../../lib/statuses.js";
import {
  transitionQuotationStatus,
  updateLeadStatusRow,
} from "../../repositories/functions/quotations.repo.js";
import * as quotationsRepo from "../../repositories/raw/quotations.repo.js";
import * as branchPaymentsRepo from "../../repositories/raw/branchPayments.repo.js";
import * as paymentsRepo from "../../repositories/raw/payments.repo.js";
import { publishQuotationEvent } from "../../infra/events.js";
import { resolveLeadPortalEventContext } from "../leads/portal-event-context.js";
import { selectOrganizationByLeadId } from "../../repositories/raw/organizations.repo.js";
import { isBranchInactive } from "../branch-requests/lifecycle.js";
import { shouldSkipCancelledSubscriptionResurrection } from "../subscriptions/resurrection.js";
import { selectSubscriptionByKey } from "../../repositories/raw/subscriptions.repo.js";

function mapQuotationTransitionError(error: any, action = "approve") {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("QUOTATION_NOT_FOUND")) {
    return null;
  }
  if (message.includes("ALREADY_APPROVED")) {
    throw new Error(
      "This quotation is already approved. Refresh the queue and approve again to retry payment link generation.",
    );
  }
  if (message.includes("INVALID_STATUS:")) {
    const status = message.split("INVALID_STATUS:")[1] || "unknown";
    if (action === "reject") {
      throw new Error("Only pending quotations can be rejected.");
    }
    if (action === "revert-approval") {
      throw new Error(
        `Only approved unpaid quotations can be reverted. Current status: ${status}.`,
      );
    }
    throw new Error(`Only pending quotations can be approved. Current status: ${status}.`);
  }
  throw error;
}

export { QUOTATION_STATUSES };

async function publishLeadQuotationEvent(
  event: string,
  quotation: any,
  extra: Record<string, unknown> = {},
) {
  if (!quotation?.id) {
    return;
  }
  const portal = await resolveLeadPortalEventContext(quotation.leadId);
  void publishQuotationEvent(event, {
    quotationId: quotation.id,
    leadId: quotation.leadId,
    status: quotation.status,
    ...portal,
    ...extra,
  });

  if (!portal.partnerId && !portal.resellerId) {
    return;
  }

  const { queuePortalQuotationSubmittedEmail, queuePortalQuotationApprovedEmail, queuePortalQuotationRejectedEmail } =
    await import("../../infra/notify.js");
  if (event === "quotation.submitted") {
    void queuePortalQuotationSubmittedEmail(quotation.id);
  } else if (event === "quotation.approved") {
    void queuePortalQuotationApprovedEmail(quotation.id);
  } else if (event === "quotation.rejected") {
    void queuePortalQuotationRejectedEmail(quotation.id);
  }
}

function wasImplementationPurchased(config: any) {
  if (!config) {
    return false;
  }

  if (config.implementationPurchased === true) {
    return true;
  }

  const implementationCost = Number(config.implementationCost);
  const implementationFee = Number(config.implementationFee);
  const hasFee =
    (Number.isFinite(implementationCost) && implementationCost > 0) ||
    (Number.isFinite(implementationFee) && implementationFee > 0);

  return config.implementationEnabled === true && hasFee;
}

/**
 * New purchases that still owe implementation must enter a gross fee > 0.
 * Net OTC of 0 after a 100% implementation discount is allowed; fee entered as 0 is not.
 */
function assertPositiveImplementationFeesForNewPurchase(assignments: any[] = []) {
  for (const assignment of assignments) {
    const config = assignment?.config || {};
    const changeType = String(assignment?.changeType || config.changeType || "new").toLowerCase();
    if (changeType === "renewal" || changeType === "go_live" || config.isRenewalQuote === true) {
      continue;
    }
    if (isMidPeriodAddonBilling(config)) {
      continue;
    }
    if (config.implementationPurchased === true) {
      continue;
    }

    const raw = config.implementationFee ?? config.implementationCost;
    const normalized =
      raw === null || raw === undefined
        ? ""
        : typeof raw === "string"
          ? raw.trim()
          : raw;
    const fee = normalized === "" ? NaN : Number(normalized);
    if (!Number.isFinite(fee) || fee <= 0) {
      throw new Error(
        "Implementation fee must be greater than zero before submitting to finance. A full implementation discount is allowed; entering 0 as the fee is not.",
      );
    }
  }
}

function assignmentHasRequiredBasePlan(config: any = {}) {
  if (isMidPeriodAddonBilling(config)) {
    return true;
  }

  const mode = String(config.pricingMode || config.productId || "").toLowerCase();

  switch (mode) {
    case "ccaas":
    case "contact-center":
      return Boolean(config.licenseTier);
    case "crm":
      if (config.usersEnabled === false) return false;
      return Boolean(config.userCount);
    case "ticketing":
      if (config.usersEnabled === false) return false;
      return Boolean(config.userCount);
    case "cdp":
      if (config.platformEnabled === false) return false;
      return Boolean(config.monthlyBasePrice);
    case "campaign":
      if (config.basePlanEnabled === false) return false;
      return Boolean(config.monthlyBasePrice);
    case "value-management":
      if (config.subscriptionEnabled === false) return false;
      return Boolean(config.monthlyBasePrice);
    default:
      return Boolean(
        config.basePrice || config.monthlyBasePrice || config.licenseTier || config.userCount,
      );
  }
}

/**
 * New / full quotes require a configured base plan. Mid-period add-on quotes may omit it.
 */
function assertBasePlanForNewPurchase(assignments: any[] = []) {
  for (const assignment of assignments) {
    const config = assignment?.config || {};
    const changeType = String(assignment?.changeType || config.changeType || "new").toLowerCase();
    if (changeType === "renewal" || changeType === "go_live" || config.isRenewalQuote === true) {
      continue;
    }
    if (isMidPeriodAddonBilling(config)) {
      continue;
    }
    if (!assignmentHasRequiredBasePlan(config)) {
      throw new Error("Base plan is required before submitting to finance.");
    }
  }
}

function buildActiveProductsPayload(quotation: any, assignments: any, productSummary: any) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return (productSummary || []).map((item: any) => ({
      key: activeProductKey(quotation.leadId, item.productId || item.name, "hq"),
      productId: item.productId || "",
      branchId: "hq",
      billingBranchId: "hq",
      changeType: item.changeType || "new",
      priceLabel: item.priceLabel || "",
      approvedAt: quotation.reviewedAt || quotation.submittedAt,
      quotationId: quotation.id,
    }));
  }

  return assignments.map((assignment) => ({
    key: activeProductKey(quotation.leadId, assignment.productId, assignment.branchId),
    productId: assignment.productId,
    branchId: assignment.branchId,
    billingBranchId: assignment.branchId || assignment.billingBranchId,
    changeType: assignment.changeType || "new",
    config: assignment.config || null,
    implementationPurchased: wasImplementationPurchased(assignment.config),
    priceLabel:
      productSummary?.find((item: any) => item.productId === assignment.productId)?.priceLabel || "",
    approvedAt: quotation.reviewedAt || quotation.submittedAt,
    quotationId: quotation.id,
  }));
}

async function loadAssignments(client: any, quotationId: any) {
  const rows = await quotationsRepo.selectAssignmentsByQuotation(client, quotationId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    const branchId = (entry as any).branchId || "hq";

    return {
      id: (entry as any).id,
      productId: (entry as any).productId,
      branchId,
      billingBranchId: branchId,
      changeType: (entry as any).changeType || "new",
      config: (entry as any).config || null,
    };
  });
}

async function loadProductSummary(client: any, quotationId: any) {
  const rows = await quotationsRepo.selectProductSummaryByQuotation(client, quotationId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      productId: (entry as any).productId,
      name: (entry as any).name,
      priceLabel: (entry as any).priceLabel,
      branchLabel: (entry as any).branchLabel,
      billingLabel: (entry as any).billingLabel,
      changeTypeLabel: (entry as any).changeTypeLabel,
    };
  });
}

async function loadInvoices(client: any, quotationId: any, { includePdfs = true } = {}) {
  const rows = includePdfs
    ? await quotationsRepo.selectInvoicesByQuotation(client, quotationId)
    : await quotationsRepo.selectInvoicesByQuotationForList(client, quotationId);

  return rows.map((row: any) => {
    const entry = rowToCamel(row);
    return {
      fileName: (entry as any).fileName,
      pdfBase64: includePdfs ? (entry as any).pdfBase64 || "" : "",
      hasPdf: includePdfs ? Boolean((entry as any).pdfBase64) : (entry as any).hasPdf === true,
      billingBranchId: (entry as any).billingBranchId,
      branchLabel: (entry as any).branchLabel,
      subtotal: (entry as any).subtotal !== null ? Number((entry as any).subtotal) : null,
      grandTotal: (entry as any).grandTotal !== null ? Number((entry as any).grandTotal) : null,
    };
  });
}

async function loadPayment(client: any, quotationId: any) {
  const row = await quotationsRepo.selectPaymentByQuotation(client, quotationId);

  if (!row) {
    return null;
  }

  const payment = rowToCamel(row);
  const branchRows = await branchPaymentsRepo.selectBranchPaymentsByQuotationId(client, quotationId);
  const branchPayments = branchRows.map(hydrateBranchPaymentRow);

  return {
    provider: (payment as any).provider,
    paymentLinkUrl: (payment as any).paymentLinkUrl,
    paymentLinkId: (payment as any).paymentLinkId,
    subtotal: (payment as any).subtotal !== null ? Number((payment as any).subtotal) : null,
    grandTotal: (payment as any).grandTotal !== null ? Number((payment as any).grandTotal) : null,
    currency: (payment as any).currency,
    gstRate: (payment as any).gstRate !== null ? Number((payment as any).gstRate) : null,
    amountLabel: (payment as any).amountLabel,
    status: (payment as any).status || "pending",
    paidAt: toIso((payment as any).paidAt),
    paymentReportedAt: toIso((payment as any).paymentReportedAt),
    paymentReportedBy: (payment as any).paymentReportedBy || null,
    financeConfirmedAt: toIso((payment as any).financeConfirmedAt),
    financeConfirmedBy: (payment as any).financeConfirmedBy || null,
    welcomeEmailStatus: (payment as any).welcomeEmailStatus || null,
    welcomeEmailSentAt: toIso((payment as any).welcomeEmailSentAt),
    welcomeEmailLastError: (payment as any).welcomeEmailLastError || null,
    welcomeEmailAttempts:
      (payment as any).welcomeEmailAttempts !== null && (payment as any).welcomeEmailAttempts !== undefined
        ? Number((payment as any).welcomeEmailAttempts)
        : 0,
    financeAlertStatus: (payment as any).financeAlertStatus || null,
    financeAlertSentAt: toIso((payment as any).financeAlertSentAt),
    financeAlertLastError: (payment as any).financeAlertLastError || null,
    financeAlertAttempts:
      (payment as any).financeAlertAttempts !== null && (payment as any).financeAlertAttempts !== undefined
        ? Number((payment as any).financeAlertAttempts)
        : 0,
    internalCredentialsStatus: (payment as any).internalCredentialsStatus || null,
    internalCredentialsSentAt: toIso((payment as any).internalCredentialsSentAt),
    internalCredentialsLastError: (payment as any).internalCredentialsLastError || null,
    providerPaymentId: (payment as any).providerPaymentId || null,
    failureReason: (payment as any).failureReason || null,
    dryRun: (payment as any).dryRun === true,
    updatedAt: toIso((payment as any).updatedAt),
    branchPayments,
  };
}

function hydrateBranchPaymentRow(row: any) {
  const payment = rowToCamel(row);
  return {
    id: (payment as any).id,
    billingBranchId: (payment as any).billingBranchId,
    branchLabel: (payment as any).branchLabel || (payment as any).billingBranchId || "",
    provider: (payment as any).provider,
    paymentLinkUrl: (payment as any).paymentLinkUrl,
    paymentLinkId: (payment as any).paymentLinkId,
    subtotal: (payment as any).subtotal !== null ? Number((payment as any).subtotal) : null,
    grandTotal: (payment as any).grandTotal !== null ? Number((payment as any).grandTotal) : null,
    currency: (payment as any).currency,
    amountLabel: (payment as any).amountLabel,
    status: (payment as any).status || "pending",
    paidAt: toIso((payment as any).paidAt),
    paymentReportedAt: toIso((payment as any).paymentReportedAt),
    paymentReportedBy: (payment as any).paymentReportedBy || null,
    financeConfirmedAt: toIso((payment as any).financeConfirmedAt),
    financeConfirmedBy: (payment as any).financeConfirmedBy || null,
    providerPaymentId: (payment as any).providerPaymentId || null,
    failureReason: (payment as any).failureReason || null,
    dryRun: (payment as any).dryRun === true,
    updatedAt: toIso((payment as any).updatedAt),
  };
}

export function hasAllBranchPaymentLinks(payment: any) {
  if (!payment?.branchPayments?.length) {
    return Boolean(payment?.paymentLinkUrl);
  }

  return payment.branchPayments.every((entry: any) => Boolean(entry.paymentLinkUrl));
}

/** Temporary leads: finance approval only — no payment link / portal fulfillment. */
export function isTemporaryQuotation(quotation: any) {
  if (!quotation) {
    return false;
  }
  if (quotation.skipPaymentLink === true) {
    return true;
  }
  const lead = quotation.lead || {};
  return (
    String(quotation.leadKind || "").toLowerCase() === "temporary" ||
    String(lead.leadKind || "").toLowerCase() === "temporary"
  );
}

async function hydrateQuotation(client: any, row: any, { includePdfs = true } = {}) {
  const base = rowToCamel(row);
  const assignments = await loadAssignments(client, (base as any).id);
  const productSummary = (await loadProductSummary(client, (base as any).id)).map((item: any) => {
    const assignment = assignments.find((entry: any) => entry.productId === item.productId);
    const periodStart = assignment?.config?.periodStart || null;
    const periodEnd = assignment?.config?.periodEnd || null;
    let periodLabel = assignment?.config?.periodLabel || null;
    if (!periodLabel && periodStart && periodEnd) {
      try {
        const start = new Date(periodStart);
        const end = new Date(periodEnd);
        periodLabel = `${start.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })} to ${end.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}`;
      } catch {
        periodLabel = `${periodStart} to ${periodEnd}`;
      }
    }
    const changeType =
      assignment?.changeType ||
      (assignment?.config?.isRenewalQuote || assignment?.config?.changeType === "renewal"
        ? "renewal"
        : null);

    return {
      ...item,
      ...(changeType ? { changeType } : {}),
      changeTypeLabel:
        changeType === "renewal" ? "Renewal" : item.changeTypeLabel || item.changeTypeLabel,
      periodStart,
      periodEnd,
      periodLabel,
    };
  });
  const invoices = await loadInvoices(client, (base as any).id, { includePdfs });
  const payment = await loadPayment(client, (base as any).id);
  const hasInvoice = includePdfs
    ? Boolean((base as any).pdfBase64) || invoices.some((entry: any) => Boolean(entry.pdfBase64))
    : (base as any).hasPdf === true || invoices.some((entry: any) => entry.hasPdf === true);

  return {
    id: (base as any).id,
    leadId: (base as any).leadId,
    lead: (base as any).leadSnapshot || null,
    fileName: (base as any).fileName || "",
    pdfBase64: includePdfs ? (base as any).pdfBase64 || "" : "",
    invoiceNumber: (base as any).invoiceNumber || "",
    hasInvoice,
    productSummary,
    assignments,
    invoiceMode: (base as any).invoiceMode || "consolidated",
    branchSummary: (base as any).branchSummary || null,
    invoices,
    grandTotal: (base as any).grandTotal !== null ? Number((base as any).grandTotal) : null,
    subtotal: (base as any).subtotal !== null ? Number((base as any).subtotal) : null,
    currency: (base as any).currency || "INR",
    gstRate: (base as any).gstRate !== null ? Number((base as any).gstRate) : 0.18,
    payment,
    submittedBy: (base as any).submittedBy || "",
    submittedAt: toIso((base as any).submittedAt),
    status: (base as any).status,
    financeNote: (base as any).financeNote || "",
    reviewedAt: toIso((base as any).reviewedAt),
    reviewedBy: (base as any).reviewedBy || null,
    version: (base as any).version ?? 1,
    submissionBatchId: (base as any).submissionBatchId || null,
    sourceProductRequestId: (base as any).sourceProductRequestId || null,
    billingPhase: (base as any).billingPhase || "standard",
    leadKind:
      String((base as any).leadSnapshot?.leadKind || "").toLowerCase() === "temporary"
        ? "temporary"
        : "standard",
    skipPaymentLink:
      (base as any).leadSnapshot?.skipPaymentLink === true ||
      String((base as any).leadSnapshot?.leadKind || "").toLowerCase() === "temporary",
  };
}

/** Strip PDF payloads for finance queue / approve-reject API responses. */
export function toFinanceQueueQuotation(quotation: any) {
  if (!quotation) {
    return null;
  }

  const invoices = Array.isArray(quotation.invoices) ? quotation.invoices : [];
  const hasInvoice = Boolean(
    quotation.hasInvoice ||
      quotation.pdfBase64 ||
      invoices.some((entry: any) => entry?.hasPdf || entry?.pdfBase64),
  );

  return {
    ...quotation,
    pdfBase64: "",
    hasInvoice,
    isTemporary: isTemporaryQuotation(quotation),
    skipPaymentLink: isTemporaryQuotation(quotation),
    invoices: invoices.map((entry: any) => ({
      ...entry,
      pdfBase64: "",
      hasPdf: Boolean(entry?.hasPdf || entry?.pdfBase64),
    })),
  };
}

async function upsertActiveProducts(client: any, quotation: any, assignments: any, productSummary: any) {
  const payload = buildActiveProductsPayload(quotation, assignments, productSummary);

  for (const entry of payload) {
    await quotationsRepo.upsertActiveProduct(client, [
        entry.key,
        quotation.leadId,
        entry.productId,
        entry.branchId,
        entry.billingBranchId || entry.branchId,
        entry.changeType || "new",
        JSON.stringify(entry.config || null),
        entry.implementationPurchased === true,
        entry.priceLabel || "",
        quotation.id,
        entry.approvedAt || new Date().toISOString(),
    ]);
  }
}

async function filterAssignmentsSkippingCancelledOrInactive(client: any, quotation: any, assignments: any) {
  if (!assignments?.length) {
    return [];
  }

  // Resolve prospect/org id without converting — finance approve must not pull
  // the lead off the pipeline list via converted_organization_id.
  let organizationId =
    quotation.lead?.organizationId ||
    quotation.lead?.convertedOrganizationId ||
    null;
  if (!organizationId && quotation.leadId) {
    try {
      const existing = await selectOrganizationByLeadId(client, quotation.leadId);
      organizationId = existing?.id || null;
    } catch {
      organizationId = null;
    }
  }

  if (!organizationId) {
    return assignments;
  }

  const kept = [];
  for (const assignment of assignments) {
    const branchId = assignment.branchId || "hq";
    if (await isBranchInactive(client, organizationId, branchId)) {
      continue;
    }
    const key = subscriptionKey(organizationId, assignment.productId, branchId);
    const existing = await selectSubscriptionByKey(client, key);
    if (shouldSkipCancelledSubscriptionResurrection(existing, quotation.id)) {
      continue;
    }
    kept.push(assignment);
  }
  return kept;
}

/**
 * Backfill active_products from quotation assignments/summary when missing.
 * Safe to call repeatedly — no-op when rows already exist for this lead+quotation.
 */
export async function ensureActiveProductsForQuotation(quotationId: any, client = null) {
  const work = async (c: any) => {
    const quotationRow = await quotationsRepo.selectQuotationById(c, quotationId);

    if (!quotationRow) {
      return { created: false, count: 0, skipped: true, reason: "quotation_not_found" };
    }

    const quotation = await hydrateQuotation(c, quotationRow);

    const existingCount = await quotationsRepo.countActiveProductsForQuotation(
      c,
      quotationId,
      quotation.leadId,
    );
    if (existingCount > 0) {
      return { created: false, count: existingCount };
    }

    const hasProducts =
      (quotation.assignments?.length || 0) > 0 || (quotation.productSummary?.length || 0) > 0;

    if (!hasProducts) {
      return { created: false, count: 0, skipped: true, reason: "no_product_data" };
    }

    const assignments = await filterAssignmentsSkippingCancelledOrInactive(
      c,
      quotation,
      quotation.assignments || [],
    );

    if (!assignments.length) {
      return {
        created: false,
        count: 0,
        skipped: true,
        reason: "all_assignments_cancelled_or_inactive",
      };
    }

    await ensureAssignmentBranchRows(
      c,
      quotation.leadId,
      quotation.lead,
      assignments,
    );

    await upsertActiveProducts(c, quotation, assignments, quotation.productSummary);

    const count = await quotationsRepo.countActiveProductsForQuotation(
      c,
      quotationId,
      quotation.leadId,
    );

    return { created: true, count };
  };

  if (client) {
    return work(client);
  }

  return withTransaction(work);
}

export async function listQuotations() {
  const client = await pool.connect();
  try {
    const rows = await quotationsRepo.selectAllQuotationsForList(client);
    const quotations = [];

    for (const row of rows) {
      quotations.push(await hydrateQuotation(client, row, { includePdfs: false }));
    }

    return quotations;
  } finally {
    client.release();
  }
}

export async function listQuotationStatuses() {
  const rows = await quotationsRepo.selectQuotationStatusRows(pool);

  const latestByLeadId = new Map();
  const activeProductsByLeadId = new Map();

  for (const row of rows) {
    const entry = rowToCamel(row);
    if (!(entry as any).leadId) {
      continue;
    }

    if (
      ((entry as any).status === QUOTATION_STATUSES.APPROVED ||
        (entry as any).status === QUOTATION_STATUSES.PAID) &&
      !activeProductsByLeadId.has((entry as any).leadId)
    ) {
      const productRows = await quotationsRepo.selectActiveProductsByLead(pool, (entry as any).leadId);
      activeProductsByLeadId.set(
        (entry as any).leadId,
        productRows.map((productRow: any) => {
          const product = rowToCamel(productRow);
          return {
            key: (product as any).key,
            productId: (product as any).productId,
            branchId: (product as any).branchId,
            billingBranchId: (product as any).billingBranchId,
            changeType: (product as any).changeType || "new",
            config: (product as any).config || null,
            implementationPurchased: (product as any).implementationPurchased === true,
            priceLabel: (product as any).priceLabel || "",
            approvedAt: toIso((product as any).approvedAt),
            quotationId: (product as any).quotationId,
          };
        }),
      );
    }

    if (latestByLeadId.has((entry as any).leadId)) {
      continue;
    }

    latestByLeadId.set((entry as any).leadId, {
      leadId: (entry as any).leadId,
      status: (entry as any).status,
      financeNote: (entry as any).financeNote || "",
      reviewedAt: toIso((entry as any).reviewedAt),
      reviewedBy: (entry as any).reviewedBy || "",
      submittedAt: toIso((entry as any).submittedAt),
      quotationId: (entry as any).quotationId,
      activeProducts: activeProductsByLeadId.get((entry as any).leadId) || [],
      payment:
        (entry as any).paymentLinkUrl || (entry as any).paymentGrandTotal
          ? {
              paymentLinkUrl: (entry as any).paymentLinkUrl || "",
              grandTotal:
                (entry as any).paymentGrandTotal !== null && (entry as any).paymentGrandTotal !== undefined
                  ? Number((entry as any).paymentGrandTotal)
                  : null,
              currency: (entry as any).paymentCurrency || (entry as any).currency || "INR",
              status: (entry as any).paymentStatus || "pending",
              paidAt: toIso((entry as any).paymentPaidAt),
            }
          : null,
      grandTotal:
        (entry as any).grandTotal !== null && (entry as any).grandTotal !== undefined
          ? Number((entry as any).grandTotal)
          : (entry as any).paymentGrandTotal !== null && (entry as any).paymentGrandTotal !== undefined
            ? Number((entry as any).paymentGrandTotal)
            : null,
      currency: (entry as any).currency || (entry as any).paymentCurrency || "INR",
    });
  }

  return [...latestByLeadId.values()].map((entry) => ({
    ...entry,
    activeProducts: activeProductsByLeadId.get(entry.leadId) || entry.activeProducts || [],
  }));
}

export async function getQuotation(id: any, { includePdfs = true } = {}) {
  const client = await pool.connect();
  try {
    const row = await quotationsRepo.selectQuotationById(client, id);
    if (!row) {
      return null;
    }

    return hydrateQuotation(client, row, { includePdfs });
  } finally {
    client.release();
  }
}

function formatBatchAmount(currency: any, total: any) {
  const code = currency || "INR";
  const value = Number(total || 0);
  return `${code} ${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function aggregateBatchStatus(branchPayments: any) {
  if (!branchPayments.length) {
    return "pending";
  }
  const paidCount = branchPayments.filter((entry: any) => entry.status === "paid").length;
  if (paidCount === branchPayments.length) {
    return "paid";
  }
  if (paidCount > 0) {
    return "partial";
  }
  if (branchPayments.some((entry: any) => entry.status === "reported")) {
    return "reported";
  }
  if (branchPayments.some((entry: any) => entry.status === "failed")) {
    return "failed";
  }
  return "pending";
}

/**
 * Build a synthetic branch payment entry from a per-branch quotation and its payment,
 * so the multi-branch payment UI can render one row per branch.
 */
function branchPaymentFromQuotation(quotation: any) {
  const payment = quotation.payment || {};
  const billingBranchId = resolveQuotationBillingBranchId(quotation);
  const branchLabel =
    quotation.invoices?.[0]?.branchLabel ||
    quotation.branchSummary?.branchLabel ||
    quotation.branchSummary?.branchLabels?.[0] ||
    billingBranchId;

  return {
    quotationId: quotation.id,
    billingBranchId,
    branchLabel,
    provider: payment.provider || null,
    paymentLinkUrl: payment.paymentLinkUrl || null,
    paymentLinkId: payment.paymentLinkId || null,
    subtotal: payment.subtotal ?? null,
    grandTotal: payment.grandTotal ?? null,
    currency: payment.currency || quotation.currency || "INR",
    amountLabel: payment.amountLabel || null,
    status: payment.status || "pending",
    paidAt: payment.paidAt || null,
    paymentReportedAt: payment.paymentReportedAt || null,
    financeConfirmedAt: payment.financeConfirmedAt || null,
    failureReason: payment.failureReason || null,
    updatedAt: payment.updatedAt || null,
  };
}

export async function getApprovedQuotationPayment(leadId: any) {
  const client = await pool.connect();
  try {
    const rows = await quotationsRepo.selectLatestPaidBatchQuotations(
      client,
      leadId,
      [QUOTATION_STATUSES.APPROVED, QUOTATION_STATUSES.PAID],
    );

    if (!rows.length) {
      return null;
    }

    const quotations = [];
    for (const row of rows) {
      quotations.push(await hydrateQuotation(client, row));
    }

    if (quotations.length === 1) {
      return {
        ...quotations[0],
        payment: attachProductSummaryToPayment((quotations as any)[0].payment, (quotations as any)),
      };
    }

    // Primary = most recent submission; the batch is ordered submitted_at ASC.
    const primary = quotations[quotations.length - 1];

    const branchPayments = [];
    const seenBranchIds = new Set();
    for (const quotation of quotations) {
      const entry = branchPaymentFromQuotation(quotation);
      if (seenBranchIds.has(entry.billingBranchId)) {
        continue;
      }
      seenBranchIds.add(entry.billingBranchId);
      branchPayments.push(entry);
    }

    const mergedInvoices = quotations.flatMap((quotation) => quotation.invoices || []);
    const currency = (primary as any).payment?.currency || (primary as any).currency || "INR";
    const totalGrand = branchPayments.reduce(
      (sum, entry) => sum + Number(entry.grandTotal || 0),
      0,
    );

    return {
      ...primary,
      invoices: mergedInvoices,
      payment: attachProductSummaryToPayment(
        {
          ...(primary as any).payment,
          status: aggregateBatchStatus(branchPayments),
          grandTotal: totalGrand,
          currency,
          amountLabel: formatBatchAmount(currency, totalGrand),
          branchPayments,
        },
        (quotations as any),
      ),
    };
  } finally {
    client.release();
  }
}

function mergeQuotationProductSummaries(quotations = []) {
  return quotations.flatMap((quotation) =>
    ((quotation as any).productSummary || []).map((item: any) => ({
      productId: item.productId || "",
      name: item.name || item.productId || "Product",
      branchLabel: item.branchLabel || item.billingLabel || "",
      billingLabel: item.billingLabel || item.branchLabel || "",
    })),
  );
}

function attachProductSummaryToPayment(payment: any, quotations = []) {
  if (!payment) {
    return payment;
  }

  return {
    ...payment,
    productSummary: mergeQuotationProductSummaries(quotations),
  };
}

function latestPaidAt(group: any, branchPayments: any) {
  const candidates = [];
  for (const quotation of group) {
    if (quotation.payment?.paidAt) {
      candidates.push(quotation.payment.paidAt);
    }
  }
  for (const entry of branchPayments) {
    if (entry?.paidAt) {
      candidates.push(entry.paidAt);
    }
  }
  if (!candidates.length) {
    return null;
  }
  return candidates
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => b.time - a.time)[0]?.value || candidates[0];
}

function buildPaidPaymentSummary(group: any) {
  // group = hydrated quotations sharing a submission batch (submitted_at ASC handled by caller).
  const primary = group[group.length - 1];
  const currency = primary.payment?.currency || primary.currency || "INR";

  let branchPayments = [];
  if (group.length > 1) {
    const seen = new Set();
    for (const quotation of group) {
      const entry = branchPaymentFromQuotation(quotation);
      if (seen.has(entry.billingBranchId)) {
        continue;
      }
      seen.add(entry.billingBranchId);
      branchPayments.push(entry);
    }
  } else if (
    Array.isArray(primary.payment?.branchPayments) &&
    primary.payment.branchPayments.length
  ) {
    branchPayments = primary.payment.branchPayments;
  }

  const grandTotal = branchPayments.length
    ? branchPayments.reduce((sum: any, entry: any) => sum + Number(entry.grandTotal || 0), 0)
    : Number(primary.payment?.grandTotal || 0);

  const status = branchPayments.length
    ? aggregateBatchStatus(branchPayments)
    : primary.payment?.status || "pending";

  const amountLabel = branchPayments.length
    ? formatBatchAmount(currency, grandTotal)
    : primary.payment?.amountLabel || formatBatchAmount(currency, grandTotal);

  const productSummary = mergeQuotationProductSummaries(group);

  const hasInvoice = group.some(
    (quotation: any) =>
      Boolean(quotation.pdfBase64) ||
      (quotation.invoices || []).some((invoice: any) => Boolean(invoice.pdfBase64)),
  );

  const invoiceMode =
    group.some((quotation: any) => quotation.invoiceMode === "per_branch") ||
    branchPayments.length > 1 ||
    group.length > 1
      ? "per_branch"
      : primary.invoiceMode || "consolidated";

  return {
    quotationId: primary.id,
    quotationIds: group.map((quotation: any) => quotation.id),
    submissionBatchId: primary.submissionBatchId || null,
    invoiceNumber: primary.fileName || primary.id,
    invoiceMode,
    canViewByProduct: productSummary.length > 1,
    canViewByLocation: invoiceMode === "per_branch" || branchPayments.length > 1 || group.length > 1,
    status,
    currency,
    grandTotal,
    amountLabel,
    paidAt: latestPaidAt(group, branchPayments),
    updatedAt: primary.payment?.updatedAt || null,
    failureReason: primary.payment?.failureReason || null,
    provider: primary.payment?.provider || null,
    branchPayments: branchPayments.map((entry: any) => ({
      quotationId: entry.quotationId || primary.id,
      billingBranchId: entry.billingBranchId,
      branchLabel: entry.branchLabel || entry.billingBranchId || "",
      amountLabel:
        entry.amountLabel || formatBatchAmount(entry.currency || currency, entry.grandTotal || 0),
      grandTotal: Number(entry.grandTotal || 0),
      status: entry.status || "pending",
      paidAt: entry.paidAt || null,
      failureReason: entry.failureReason || null,
      provider: entry.provider || null,
    })),
    productSummary,
    hasInvoice,
  };
}

/**
 * Paid and failed invoice/quotation batches for a lead, newest activity first.
 * Quantities/amounts only — no PDF payloads (fetched separately for detail view).
 */
export async function getLeadPaidPayments(leadId: any) {
  const client = await pool.connect();
  try {
    const rows = await quotationsRepo.selectPaidQuotations(client, leadId, [
      QUOTATION_STATUSES.APPROVED,
      QUOTATION_STATUSES.PAID,
    ]);

    if (!rows.length) {
      return [];
    }

    const quotations = [];
    for (const row of rows) {
      quotations.push(await hydrateQuotation(client, row));
    }

    const groups = new Map();
    for (const quotation of quotations) {
      const key = quotation.submissionBatchId || quotation.id;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(quotation);
    }

    const payments = [];
    for (const group of groups.values()) {
      // Order within a batch by submission time ASC so "primary" is the latest.
      group.sort((a: any, b: any) => {
        const at = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return at - bt;
      });
      payments.push(buildPaidPaymentSummary(group));
    }

    payments.sort((a, b) => {
      const at = a.paidAt
        ? new Date(a.paidAt).getTime()
        : a.updatedAt
          ? new Date(a.updatedAt).getTime()
          : 0;
      const bt = b.paidAt
        ? new Date(b.paidAt).getTime()
        : b.updatedAt
          ? new Date(b.updatedAt).getTime()
          : 0;
      return bt - at;
    });

    return payments;
  } finally {
    client.release();
  }
}

function invoicePreviewEntriesFromQuotation(quotation: any) {
  const stored = Array.isArray(quotation.invoices) ? quotation.invoices : [];
  const withPdf = stored.filter((invoice: any) => Boolean(invoice?.pdfBase64));
  if (withPdf.length) {
    return withPdf.map((invoice: any) => {
      const label =
        invoice.branchLabel ||
        invoice.billingLabel ||
        invoice.fileName ||
        "Invoice";
      return {
        fileName: invoice.fileName,
        pdfBase64: invoice.pdfBase64 || "",
        billingBranchId: invoice.billingBranchId || null,
        branchLabel: label,
        billingLabel: label,
      };
    });
  }

  if (!quotation.pdfBase64) {
    return [];
  }

  const label =
    quotation.branchSummary?.branchLabel ||
    quotation.branchSummary?.billingBranchId ||
    quotation.fileName ||
    "Invoice";

  return [
    {
      fileName: quotation.fileName,
      pdfBase64: quotation.pdfBase64 || "",
      billingBranchId: quotation.branchSummary?.billingBranchId || null,
      branchLabel: label,
      billingLabel: label,
    },
  ];
}

async function buildPerProductInvoiceEntries(leadId: any, batchQuotations: any) {
  const liveLead = await getLeadById(leadId);
  const snapshotLead = batchQuotations[0]?.lead || null;
  if (!liveLead && !snapshotLead) {
    return [];
  }
  const lead = {
    ...(snapshotLead || {}),
    ...(liveLead || {}),
    companyName: liveLead?.companyName || snapshotLead?.companyName || "",
  };

  const { PRODUCT_CATALOG, getProductName } = await import("../../lib/productCatalog.js");
  const { buildQuotationInvoice } = await import("../../lib/invoice.js");
  const { loadInvoiceLogoFromFile } = await import("../billing/invoice-logo.js");
  const logoAsset = loadInvoiceLogoFromFile();

  const products = PRODUCT_CATALOG.map((entry) => ({
    id: entry.id,
    name: getProductName(entry.id) || entry.name,
  }));

  const assignments = [];
  for (const quotation of batchQuotations) {
    for (const assignment of quotation.assignments || []) {
      assignments.push(assignment);
      if (!products.some((entry) => entry.id === assignment.productId)) {
        products.push({
          id: assignment.productId,
          name: getProductName(assignment.productId) || assignment.productId,
        });
      }
    }
  }

  const productInvoices = [];
  for (const [index, assignment] of assignments.entries()) {
    try {
      const built = await buildQuotationInvoice({
        lead,
        products,
        assignments: [assignment],
        invoiceMode: "consolidated",
        logoAsset,
        skipLogo: !logoAsset,
      });
      const branchLabel =
        assignment.billingLabel ||
        assignment.branchLabel ||
        (built.invoices?.[0] as any)?.branchLabel ||
        "";
      const productName =
        getProductName(assignment.productId) ||
        products.find((entry) => entry.id === assignment.productId)?.name ||
        assignment.productId;
      const label = branchLabel ? `${productName} · ${branchLabel}` : productName;

      productInvoices.push({
        id: `${assignment.productId || "product"}-${assignment.branchId || assignment.billingBranchId || index}`,
        productId: assignment.productId || "",
        branchId: assignment.branchId || assignment.billingBranchId || "",
        branchLabel,
        label,
        billingLabel: label,
        fileName: built.fileName || `invoice-${assignment.productId || index}.pdf`,
        pdfBase64: built.pdfBase64 || built.invoices?.[0]?.pdfBase64 || "",
      });
    } catch (error) {
      console.warn(
        `[quotations] Could not build per-product invoice for ${assignment.productId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return productInvoices.filter((entry) => Boolean(entry.pdfBase64));
}

/**
 * Invoice PDFs for one quotation (and its submission batch when present), scoped to the lead.
 * Returns preview-friendly shape consumed by buildQuotationPreviewEntries — including
 * separate per-location PDFs when the quote was submitted as per_branch.
 * Pass { includeProductSplit: true } to also generate one PDF per product assignment.
 */
export async function getQuotationInvoiceForLead(leadId: any, quotationId: any, options = {}) {
  const includeProductSplit = Boolean((options as any).includeProductSplit);
  const client = await pool.connect();
  try {
    const row = await quotationsRepo.selectQuotationById(client, quotationId);
    if (!row) {
      return null;
    }

    const quotation = await hydrateQuotation(client, row);
    if (String(quotation.leadId) !== String(leadId)) {
      return null;
    }

    let batchQuotations = [quotation];
    if (quotation.submissionBatchId) {
      const batchRows = await quotationsRepo.selectQuotationsBySubmissionBatch(
        client,
        leadId,
        quotation.submissionBatchId,
      );
      if (batchRows.length) {
        batchQuotations = [];
        for (const batchRow of batchRows) {
          batchQuotations.push(await hydrateQuotation(client, batchRow));
        }
      }
    }

    const invoices = [];
    const seen = new Set();
    for (const entryQuotation of batchQuotations) {
      for (const invoice of invoicePreviewEntriesFromQuotation(entryQuotation)) {
        const key = `${invoice.billingBranchId || ""}::${invoice.fileName || ""}::${invoice.pdfBase64?.slice(0, 32) || ""}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        invoices.push(invoice);
      }
    }

    const invoiceMode =
      batchQuotations.length > 1 || invoices.length > 1
        ? "per_branch"
        : quotation.invoiceMode || "consolidated";

    const productInvoices = includeProductSplit
      ? await buildPerProductInvoiceEntries(leadId, batchQuotations)
      : [];

    return {
      quotationId: quotation.id,
      quotationIds: batchQuotations.map((entry) => entry.id),
      fileName: quotation.fileName,
      pdfBase64: quotation.pdfBase64 || "",
      invoiceMode,
      invoices,
      productInvoices,
      canViewByProduct: productInvoices.length > 1,
    };
  } finally {
    client.release();
  }
}

function payloadIsRenewalQuote(payload = {}) {
  return ((payload as any).assignments || []).some(
    (assignment: any) =>
      assignment?.config?.isRenewalQuote === true ||
      assignment?.changeType === "renewal" ||
      assignment?.config?.changeType === "renewal",
  );
}

/**
 * Once a lead has any Paid quotation they are a customer.
 * Finance approve / reject / revert must not demote them to Approved / Pending / Rejected
 * (Customers list + Sales Total customers KPI keep active orgs / Paid / Partially paid;
 * Products pipeline continues to exclude Paid / Partially paid).
 *
 * Partially paid only when Paid history + an Approved (awaiting payment) quote —
 * Pending Finance Review alone must not flip Customers by status to Partially paid.
 *
 * Pure helper — exported for unit tests.
 */
export function resolveLeadStatusPreservingCustomer(
  nonRejectedStatuses: string[],
  fallbackStatus: string,
) {
  const hasPaid = nonRejectedStatuses.some((status) => status === QUOTATION_STATUSES.PAID);
  if (!hasPaid) {
    return fallbackStatus;
  }

  const allPaid =
    nonRejectedStatuses.length > 0 &&
    nonRejectedStatuses.every((status) => status === QUOTATION_STATUSES.PAID);
  if (allPaid) {
    return QUOTATION_STATUSES.PAID;
  }

  const hasApprovedAwaitingPayment = nonRejectedStatuses.some(
    (status) => status === QUOTATION_STATUSES.APPROVED,
  );
  return hasApprovedAwaitingPayment
    ? LEAD_STATUSES.PARTIALLY_PAID
    : QUOTATION_STATUSES.PAID;
}

async function loadNonRejectedQuotationStatuses(client: any, leadId: any) {
  const { rows } = await client.query(
    `SELECT status FROM quotations WHERE lead_id = $1 AND status <> $2`,
    [leadId, QUOTATION_STATUSES.REJECTED],
  );
  return rows.map((row: any) => row.status);
}

async function updateLeadStatusPreservingCustomer(
  client: any,
  leadId: any,
  fallbackStatus: string,
) {
  if (!leadId) {
    return;
  }
  const statuses = await loadNonRejectedQuotationStatuses(client, leadId);
  const next = resolveLeadStatusPreservingCustomer(statuses, fallbackStatus);
  await updateLeadStatusRow(client, leadId, next);
}

/**
 * New sales quotes move first-time leads to Pending Finance Review.
 * Renewal quotes on an already-paid customer must not bounce the lead back to Pending —
 * that race was failing smoke-test-payments after day-20 immediate renewal creation.
 * Existing customers stay Paid while the new quote awaits finance; Partially paid
 * is applied only after finance approve (Approved + Paid history).
 */
async function updateLeadStatusForNewQuotation(client: any, payload: any) {
  const leadId = payload.leadId;
  if (!leadId) {
    return;
  }

  if (
    payload.skipLeadStatusUpdate === true ||
    isBillingChangePhase(payload.billingPhase || payload.payment?.billingPhase)
  ) {
    return;
  }

  const { rows: paidRows } = await client.query(
    `SELECT 1 FROM quotations WHERE lead_id = $1 AND status = $2 LIMIT 1`,
    [leadId, QUOTATION_STATUSES.PAID],
  );
  const hasPaidQuotation = paidRows.length > 0;

  if (payloadIsRenewalQuote(payload) && hasPaidQuotation) {
    return;
  }

  if (hasPaidQuotation) {
    await updateLeadStatus(client, leadId, QUOTATION_STATUSES.PAID);
    return;
  }

  await updateLeadStatus(client, leadId, QUOTATION_STATUSES.PENDING);
}

export async function createQuotation(payload: any) {
  let effectivePayload = payload;
  const { resolveSourceProductRequestIdForQuotation } = await import(
    "../customer-product-requests/request-store.js"
  );
  const resolvedRequestId = await resolveSourceProductRequestIdForQuotation(
    payload.leadId,
    payload.sourceProductRequestId || null,
  );
  if (resolvedRequestId && !payload.sourceProductRequestId) {
    effectivePayload = { ...payload, sourceProductRequestId: resolvedRequestId };
  }
  if (effectivePayload.sourceProductRequestId) {
    const { materializeProductRequestNewBranches } = await import("../customer-product-requests/request-store.js");
    await materializeProductRequestNewBranches(effectivePayload.sourceProductRequestId);
    const refreshedLead = await getLeadById(effectivePayload.leadId);
    if (refreshedLead) {
      effectivePayload = { ...effectivePayload, lead: refreshedLead };
    }
  }

  const quotation = await withTransaction(async (client) => {
    const duplicate = await quotationsRepo.selectDuplicateQuotation(
      client,
      effectivePayload.leadId,
      effectivePayload.fileName || "",
      effectivePayload.pdfBase64 || "",
    );

    if (duplicate) {
      const existing = await quotationsRepo.selectQuotationById(client, duplicate.id);
      return hydrateQuotation(client, existing);
    }

    const leadSnapshot =
      effectivePayload.lead || (await loadLeadSnapshot(client, effectivePayload.leadId));
    const isTemporary =
      effectivePayload.skipPaymentLink === true ||
      String(effectivePayload.leadKind || "").toLowerCase() === "temporary" ||
      String(leadSnapshot?.leadKind || "").toLowerCase() === "temporary";
    const stampedLeadSnapshot = leadSnapshot
      ? {
          ...leadSnapshot,
          leadKind: isTemporary ? "temporary" : leadSnapshot.leadKind || "standard",
          skipPaymentLink: isTemporary,
          temporaryInvoiceContents:
            effectivePayload.temporaryInvoiceContents ||
            leadSnapshot.temporaryInvoiceContents ||
            null,
        }
      : leadSnapshot;

    const billingPhase =
      effectivePayload.billingPhase || effectivePayload.payment?.billingPhase || "standard";
    const isBillingChange = isBillingChangePhase(billingPhase);

    if (!isBillingChange) {
      assertBasePlanForNewPurchase(effectivePayload.assignments);
      assertPositiveImplementationFeesForNewPurchase(effectivePayload.assignments);
    }

    if (!isBillingChange && effectivePayload.skipDuplicatePurchaseCheck !== true) {
      await validateAssignmentsForDuplicatePurchase(
        effectivePayload.leadId,
        effectivePayload.assignments,
        {
          financeOverride: effectivePayload.financeOverride === true,
          overrideNote: effectivePayload.overrideNote || "",
        },
        (client as any),
      );
    }

    if (leadSnapshot && !isBillingChange) {
      await ensureAssignmentBranchRows(
        client,
        effectivePayload.leadId,
        leadSnapshot,
        effectivePayload.assignments,
      );
    }

    const quotationId = crypto.randomUUID();
    const submittedAt = new Date().toISOString();

    const {
      allocateNextInvoiceNumber,
      bankDetailsFromSettings,
    } = await import("../invoice-settings/store.js");
    const invoiceSettingsRepo = await import("../../repositories/raw/invoiceSettings.repo.js");
    const allocated = await allocateNextInvoiceNumber(client);
    const invoiceNumber = allocated.invoiceNumber;

    let pdfBase64 = effectivePayload.pdfBase64 || null;
    let fileName = effectivePayload.fileName || null;
    let invoicesPayload = Array.isArray(effectivePayload.invoices)
      ? [...effectivePayload.invoices]
      : [];

    const temporaryInvoiceContents =
      effectivePayload.temporaryInvoiceContents ||
      stampedLeadSnapshot?.temporaryInvoiceContents ||
      null;

    const canRebuildPdf =
      (Array.isArray(effectivePayload.assignments) && effectivePayload.assignments.length > 0) ||
      (effectivePayload.productConfigs &&
        typeof effectivePayload.productConfigs === "object" &&
        Object.keys(effectivePayload.productConfigs).length > 0);

    if (canRebuildPdf && stampedLeadSnapshot) {
      try {
        const settingsRow = await invoiceSettingsRepo.selectInvoiceSettings(client);
        const { rowToCamel } = await import("../../db/util.js");
        const settingsCamel = rowToCamel(settingsRow) as any;
        const bankDetails = bankDetailsFromSettings({
          accountName: settingsCamel?.accountName || "",
          bankName: settingsCamel?.bankName || "",
          accountNumber: settingsCamel?.accountNumber || "",
          ifsc: settingsCamel?.ifsc || "",
          branch: settingsCamel?.branch || "",
        });
        const invoicePrefix =
          String(settingsCamel?.invoicePrefix || allocated.prefix || "WIPL").trim() || "WIPL";
        const { PRODUCT_CATALOG, getProductName } = await import("../../lib/productCatalog.js");
        const { buildQuotationInvoice } = await import("../../lib/invoice.js");
        const { loadInvoiceLogoFromFile } = await import("../billing/invoice-logo.js");
        const logoAsset = loadInvoiceLogoFromFile();

        const products =
          Array.isArray(effectivePayload.products) && effectivePayload.products.length
            ? effectivePayload.products
            : PRODUCT_CATALOG.map((entry) => ({
                id: entry.id,
                name: getProductName(entry.id) || entry.name,
              }));

        for (const assignment of effectivePayload.assignments || []) {
          if (!products.some((entry: any) => entry.id === assignment.productId)) {
            products.push({
              id: assignment.productId,
              name: getProductName(assignment.productId) || assignment.productId,
            });
          }
        }

        const built = await buildQuotationInvoice({
          lead: stampedLeadSnapshot,
          products,
          productConfigs: effectivePayload.productConfigs || {},
          assignments: effectivePayload.assignments || [],
          invoiceMode: effectivePayload.invoiceMode || "consolidated",
          logoAsset,
          skipLogo: !logoAsset,
          temporaryInvoiceContents,
          invoiceNumber,
          invoicePrefix,
          bankDetails,
        });

        pdfBase64 = built.pdfBase64 || built.invoices?.[0]?.pdfBase64 || pdfBase64;
        fileName = built.fileName || built.invoices?.[0]?.fileName || fileName;
        if (Array.isArray(built.invoices) && built.invoices.length) {
          invoicesPayload = built.invoices.map((invoice: any) => ({
            fileName: invoice.fileName || null,
            pdfBase64: invoice.pdfBase64 || null,
            billingBranchId: invoice.billingBranchId || null,
            branchLabel: invoice.branchLabel || invoice.label || null,
            subtotal: invoice.subtotal ?? null,
            grandTotal: invoice.grandTotal ?? null,
          }));
        }
      } catch (error) {
        console.warn(
          `[quotations] invoice PDF rebuild failed for allocated ${invoiceNumber}; keeping client PDF:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    const row = await quotationsRepo.insertQuotation(client, [
      quotationId,
      effectivePayload.leadId,
      JSON.stringify(stampedLeadSnapshot || null),
      fileName,
      pdfBase64,
      effectivePayload.invoiceMode || "consolidated",
      JSON.stringify(effectivePayload.branchSummary || null),
      effectivePayload.subtotal ?? effectivePayload.payment?.subtotal ?? null,
      effectivePayload.grandTotal ?? effectivePayload.payment?.grandTotal ?? null,
      effectivePayload.currency || effectivePayload.payment?.currency || "INR",
      effectivePayload.gstRate ?? effectivePayload.payment?.gstRate ?? 0.18,
      QUOTATION_STATUSES.PENDING,
      effectivePayload.submittedBy || "",
      submittedAt,
      effectivePayload.submissionBatchId || quotationId,
      effectivePayload.sourceProductRequestId || null,
      billingPhase,
      invoiceNumber,
    ]);

    for (const assignment of effectivePayload.assignments || []) {
      const branchId = assignment.branchId || "hq";
      let config = assignment.config || null;
      let agentCount = null;
      let includedNumberCount = null;
      let queueCapacityCount = null;
      let totalNumberCount = null;
      if (config && (assignment.productId === "contact-center" || config.pricingMode === "ccaas")) {
        config = syncCcaasNumberEntitlementFields({ ...config, pricingMode: "ccaas" });
        const counts = resolveCcaasNumberEntitlementCounts(config);
        agentCount = counts.agentCount;
        includedNumberCount = counts.includedNumberCount;
        queueCapacityCount = counts.queueCapacityCount;
        totalNumberCount = counts.totalNumberEntitlement;
      }

      await quotationsRepo.insertProductAssignment(client, [
        crypto.randomUUID(),
        quotationId,
        effectivePayload.leadId,
        assignment.productId,
        branchId,
        branchId,
        assignment.changeType || "new",
        JSON.stringify(config),
        agentCount,
        includedNumberCount,
        queueCapacityCount,
        totalNumberCount,
      ]);
    }

    for (const item of effectivePayload.productSummary || []) {
      await quotationsRepo.insertProductSummaryItem(client, [
        quotationId,
        item.productId || null,
        item.name || null,
        item.priceLabel || null,
        item.branchLabel || null,
        item.billingLabel || null,
        item.changeTypeLabel || null,
      ]);
    }

    for (const invoice of invoicesPayload) {
      await quotationsRepo.insertQuotationInvoice(client, [
        quotationId,
        invoice.fileName || null,
        invoice.pdfBase64 || null,
        invoice.billingBranchId || null,
        invoice.branchLabel || null,
        invoice.subtotal ?? null,
        invoice.grandTotal ?? null,
      ]);
    }

    await updateLeadStatusForNewQuotation(client, effectivePayload);

    return hydrateQuotation(client, row);
  });

  if (quotation) {
    void publishLeadQuotationEvent("quotation.submitted", quotation);
  }

  return quotation;
}

/**
 * Submit one finance quotation per billing branch when multiple invoices/branches exist.
 * Single-branch deals still create one quotation.
 */
export async function createQuotationsForFinance(payload: any) {
  const invoices = Array.isArray(payload.invoices) ? payload.invoices : [];
  const assignments = Array.isArray(payload.assignments) ? payload.assignments : [];

  const branchInvoiceKeys = [
    ...new Set(
      invoices
        .map((invoice: any) => String(invoice?.billingBranchId || "").trim())
        .filter(Boolean),
    ),
  ];

  const submissionBatchId = crypto.randomUUID();

  if (branchInvoiceKeys.length <= 1) {
    const quotation = await createQuotation({ ...payload, submissionBatchId });
    return { quotations: quotation ? [quotation] : [] };
  }

  const quotations = [];

  for (const invoice of invoices) {
    const billingBranchId = String(invoice?.billingBranchId || "").trim();
    if (!billingBranchId) {
      continue;
    }

    const branchAssignments = assignments.filter(
      (assignment: any) =>
        String(assignment.billingBranchId || assignment.branchId || "hq") === billingBranchId,
    );

    if (!branchAssignments.length) {
      continue;
    }

    const branchLabel = String(invoice.branchLabel || "").trim() || billingBranchId;
    const branchProductSummary = (payload.productSummary || []).filter((item: any) => {
      const itemBranchLabel = String(item.branchLabel || "").trim();
      const itemBillingLabel = String(item.billingLabel || "").trim();
      if (itemBranchLabel && itemBranchLabel === branchLabel) {
        return true;
      }
      if (itemBillingLabel && itemBillingLabel === branchLabel) {
        return true;
      }

      const itemBranchId = String(item.billingBranchId || item.branchId || "").trim();
      return Boolean(itemBranchId) && itemBranchId === billingBranchId;
    });

    const branchPayload = {
      ...payload,
      submissionBatchId,
      fileName: invoice.fileName || payload.fileName,
      pdfBase64: invoice.pdfBase64 || payload.pdfBase64,
      assignments: branchAssignments,
      productSummary: branchProductSummary,
      invoices: [invoice],
      invoiceMode: "per_branch",
      branchSummary: {
        productCount: branchAssignments.length,
        branchCount: 1,
        billingGroupCount: 1,
        branchLabels: [branchLabel].filter(Boolean),
        billingBranchId,
        branchLabel,
      },
      subtotal: invoice.subtotal ?? null,
      grandTotal: invoice.grandTotal ?? null,
      payment: {
        ...(payload.payment || {}),
        subtotal: invoice.subtotal ?? payload.payment?.subtotal ?? null,
        grandTotal: invoice.grandTotal ?? payload.payment?.grandTotal ?? null,
        currency: payload.currency || payload.payment?.currency || "INR",
      },
    };

    const quotation = await createQuotation(branchPayload);
    if (quotation) {
      quotations.push(quotation);
    }
  }

  if (!quotations.length) {
    throw new Error("Could not create per-branch quotations. Check branch invoices and product assignments.");
  }

  return { quotations };
}

export async function attachPaymentToQuotation(id: any, payment: any) {
  return withTransaction(async (client) => {
    await quotationsRepo.upsertPayment(client, [
      id,
      payment.provider || null,
      payment.paymentLinkUrl || null,
      payment.paymentLinkId || null,
      payment.subtotal ?? null,
      payment.grandTotal ?? null,
      payment.currency || null,
      payment.gstRate ?? null,
      payment.amountLabel || null,
      payment.status || "pending",
      payment.dryRun === true,
    ]);

    const row = await quotationsRepo.selectQuotationById(client, id);
    if (!row) {
      return null;
    }

    return hydrateQuotation(client, row, { includePdfs: false });
  });
}

/**
 * For >₹25L offline invoices: create a pending bank_transfer payment row
 * (no payment link) so finance can report / mark paid.
 */
export async function ensureOfflineBankTransferPayment(quotation: any) {
  if (!quotation?.id) {
    return quotation;
  }
  if (quotation.payment) {
    return quotation;
  }

  const {
    applyPaymentProviderPolicy,
    formatPaymentAmount,
    resolveQuotationPaymentAmount,
  } = await import("../payments/amount-policy.js");
  const { PAYMENT_PROVIDERS } = await import("../payments/constants.js");

  const { policy } = applyPaymentProviderPolicy(quotation, null);
  if (policy.mode !== "offline") {
    return quotation;
  }

  const amounts = resolveQuotationPaymentAmount(quotation);
  if (!amounts.grandTotal || amounts.grandTotal <= 0) {
    throw new Error(
      "Quotation amount must be greater than zero for offline bank-transfer payment tracking.",
    );
  }

  return attachPaymentToQuotation(quotation.id, {
    provider: PAYMENT_PROVIDERS.BANK_TRANSFER,
    paymentLinkUrl: null,
    paymentLinkId: null,
    subtotal: amounts.subtotal ?? null,
    grandTotal: amounts.grandTotal,
    currency: amounts.currency || "INR",
    gstRate: amounts.gstRate ?? quotation.gstRate ?? null,
    amountLabel: formatPaymentAmount(amounts.grandTotal, amounts.currency || "INR"),
    status: "pending",
    dryRun: false,
  });
}

/**
 * ₹0 invoices: attach a pending payment row with no payment link, then mark paid
 * and run the standard fulfillment + welcome-email path (skip customer payment step).
 */
export async function fulfillZeroValueQuotation(
  quotationId: any,
  {
    financeConfirmedBy = null,
    awaitFulfillment = true,
  }: { financeConfirmedBy?: string | null; awaitFulfillment?: boolean } = {},
) {
  const {
    formatPaymentAmount,
    isZeroValueQuotation,
    resolveQuotationPaymentAmount,
  } = await import("../payments/amount-policy.js");
  const { PAYMENT_PROVIDERS } = await import("../payments/constants.js");
  const { markQuotationPaymentPaid } = await import("../payments/fulfillment.js");

  let quotation = await getQuotation(quotationId, { includePdfs: false });
  if (!quotation) {
    throw new Error("Quotation not found.");
  }

  if (!isZeroValueQuotation(quotation)) {
    throw new Error("Quotation is not a zero-value invoice.");
  }

  const amounts = resolveQuotationPaymentAmount(quotation);
  if (!quotation.payment) {
    quotation = await attachPaymentToQuotation(quotationId, {
      provider: PAYMENT_PROVIDERS.MANUAL,
      paymentLinkUrl: null,
      paymentLinkId: null,
      subtotal: amounts.subtotal ?? 0,
      grandTotal: 0,
      currency: amounts.currency || "INR",
      gstRate: amounts.gstRate ?? quotation.gstRate ?? null,
      amountLabel: formatPaymentAmount(0, amounts.currency || "INR"),
      status: "pending",
      dryRun: false,
    });
  }

  const paid = await markQuotationPaymentPaid({
    quotationId,
    source: PAYMENT_PROVIDERS.MANUAL,
    financeConfirmedBy: financeConfirmedBy || null,
    sendNotifications: true,
    awaitFulfillment,
  } as any);

  return {
    quotation: paid.quotation || quotation,
    payment: paid.payment || (quotation as any)?.payment || null,
    notified: paid.notified,
    notificationQueued: paid.notificationQueued,
    alreadyPaid: paid.alreadyPaid === true,
  };
}

export async function attachBranchPaymentsToQuotation(id: any, { parentPayment, branchPayments }: any) {
  return withTransaction(async (client) => {
    await quotationsRepo.upsertPayment(client, [
      id,
      parentPayment.provider || null,
      null,
      null,
      parentPayment.subtotal ?? null,
      parentPayment.grandTotal ?? null,
      parentPayment.currency || null,
      parentPayment.gstRate ?? null,
      parentPayment.amountLabel || null,
      parentPayment.status || "pending",
      parentPayment.dryRun === true,
    ]);

    for (const branchPayment of branchPayments) {
      await branchPaymentsRepo.upsertBranchPayment(client, [
        id,
        branchPayment.billingBranchId,
        branchPayment.branchLabel || branchPayment.billingBranchId,
        branchPayment.provider || parentPayment.provider || null,
        branchPayment.paymentLinkUrl || null,
        branchPayment.paymentLinkId || null,
        branchPayment.subtotal ?? null,
        branchPayment.grandTotal ?? null,
        branchPayment.currency || parentPayment.currency || null,
        branchPayment.amountLabel || null,
        branchPayment.status || "pending",
        branchPayment.dryRun === true,
      ]);
    }

    const row = await quotationsRepo.selectQuotationById(client, id);
    if (!row) {
      return null;
    }

    return hydrateQuotation(client, row, { includePdfs: false });
  });
}

function resolveQuotationBillingBranchId(quotation: any) {
  const invoiceBranch = quotation?.invoices?.[0]?.billingBranchId;
  if (invoiceBranch) {
    return String(invoiceBranch);
  }
  const fromSummary = quotation?.branchSummary?.billingBranchId;
  if (fromSummary) {
    return String(fromSummary);
  }
  const assignment = Array.isArray(quotation?.assignments) ? quotation.assignments[0] : null;
  return String(assignment?.billingBranchId || assignment?.branchId || "hq");
}

async function assertBillingBranchHasWorkEmail(quotation: any) {
  const leadId = quotation?.leadId;
  if (!leadId) {
    throw new Error("Quotation is missing a lead.");
  }

  const liveLead = (await getLeadById(leadId)) || quotation.lead || {};
  const billingBranchId = resolveQuotationBillingBranchId(quotation);
  const workEmail = resolveBranchWorkEmail(liveLead, billingBranchId);
  if (workEmail) {
    return;
  }

  const label =
    quotation?.invoices?.[0]?.branchLabel ||
    quotation?.branchSummary?.branchLabel ||
    resolveBranchLabel(liveLead, billingBranchId);

  throw new Error(
    `Add a unique work email for ${label} before finance can approve.`,
  );
}

export async function approveQuotation(id: any, reviewerEmail: any, note = "", { deferEvent = false } = {}) {
  // Skip PDF base64 during approve — finance HTTP path must stay light; emails reload PDFs later.
  const existing = await getQuotation(id, { includePdfs: false });
  if (!existing) {
    return null;
  }
  if (existing.status !== QUOTATION_STATUSES.PENDING) {
    // Keep transition helper as source of truth for status messages.
  } else {
    await assertBillingBranchHasWorkEmail(existing);
  }

  const quotation = await withTransaction(async (client) => {
    let row;
    try {
      row = await transitionQuotationStatus(client, {
        quotationId: id,
        fromStatus: QUOTATION_STATUSES.PENDING,
        toStatus: QUOTATION_STATUSES.APPROVED,
        financeNote: note.trim(),
        reviewedBy: reviewerEmail,
      });
    } catch (error) {
      const mapped = mapQuotationTransitionError(error, "approve");
      if (mapped === null) {
        return null;
      }
      throw mapped;
    }

    const quotation = await hydrateQuotation(client, row, { includePdfs: false });
    await ensureAssignmentBranchRows(
      client,
      quotation.leadId,
      quotation.lead,
      quotation.assignments,
    );
    const productSync = await ensureActiveProductsForQuotation(quotation.id, (client as any));

    if (productSync.skipped && productSync.reason === "no_product_data") {
      throw new Error(
        "Cannot approve quotation without product assignments or a product summary.",
      );
    }

    // Existing customers → Partially paid (Paid history + Approved awaiting payment);
    // first-time leads → Approved.
    await updateLeadStatusPreservingCustomer(
      client,
      quotation.leadId,
      QUOTATION_STATUSES.APPROVED,
    );

    const { trimApprovedProductsFromLinkedRequest } = await import(
      "../customer-product-requests/request-store.js"
    );
    await trimApprovedProductsFromLinkedRequest(client, quotation);

    return quotation;
  });

  if (quotation && !deferEvent) {
    void publishLeadQuotationEvent("quotation.approved", quotation);
  }

  return quotation;
}

export function publishQuotationApprovedEvent(quotation: any) {
  void publishLeadQuotationEvent("quotation.approved", quotation);
}

export async function revertQuotationApproval(id: any) {
  return withTransaction(async (client) => {
    let row;
    try {
      row = await transitionQuotationStatus(client, {
        quotationId: id,
        fromStatus: QUOTATION_STATUSES.APPROVED,
        toStatus: QUOTATION_STATUSES.PENDING,
        clearReview: true,
      });
    } catch (error) {
      if (String((error as any)?.message || "").includes("QUOTATION_NOT_FOUND")) {
        return null;
      }
      if (String((error as any)?.message || "").includes("INVALID_STATUS:")) {
        return null;
      }
      throw error;
    }

    await quotationsRepo.deleteActiveProductsByQuotation(client, id);

    const quotation = await hydrateQuotation(client, row, { includePdfs: false });
    // Existing customers return to Paid while quote is Pending Finance Review again;
    // first-time leads → Pending Finance Review.
    await updateLeadStatusPreservingCustomer(
      client,
      quotation.leadId,
      QUOTATION_STATUSES.PENDING,
    );

    return quotation;
  });
}

function assertQuotationCanBeWithdrawnBySales(quotation: any) {
  if (!quotation) {
    return;
  }
  if (quotation.status !== QUOTATION_STATUSES.APPROVED) {
    throw new Error(
      `Only approved unpaid quotations can be reverted. Current status: ${quotation.status}.`,
    );
  }
  if (isTemporaryQuotation(quotation)) {
    throw new Error(
      "Temporary invoices have no payment link. Revert approval is only for online Approved invoices with a payment link.",
    );
  }

  const payment = quotation.payment;
  if (!payment) {
    throw new Error(
      "No payment record found. Revert approval is only available after finance issued an online payment link.",
    );
  }

  const status = String(payment.status || "").toLowerCase();
  if (["paid", "reported", "partial", "refunded"].includes(status)) {
    throw new Error(
      "This invoice cannot be reverted because payment was already paid or reported.",
    );
  }

  const branches = Array.isArray(payment.branchPayments) ? payment.branchPayments : [];
  if (
    branches.some((entry: any) =>
      ["paid", "reported", "partial"].includes(String(entry?.status || "").toLowerCase()),
    )
  ) {
    throw new Error(
      "This invoice cannot be reverted because one or more branch payments were already paid or reported.",
    );
  }

  const provider = String(payment.provider || "").toLowerCase();
  if (
    provider === "bank_transfer" ||
    provider === "manual" ||
    (!payment.paymentLinkId &&
      !branches.some((entry: any) => Boolean(entry?.paymentLinkId)))
  ) {
    throw new Error(
      "Revert approval is only available for online Approved invoices with a Stripe or Razorpay payment link.",
    );
  }
}

/**
 * Sales withdraw of finance approval for online Approved + unpaid invoices:
 * cancel provider payment links, clear DB links, move quote to Rejected so sales
 * must create and re-submit a new invoice (does not return to Pending Finance).
 */
export async function withdrawApprovedQuotationBySales(
  id: any,
  { actorEmail = "", note = "" } = {},
) {
  const existing = await getQuotation(id, { includePdfs: false });
  if (!existing) {
    return null;
  }

  assertQuotationCanBeWithdrawnBySales(existing);

  const {
    cancelQuotationPaymentLinks,
    quotationHasCancellableOnlinePaymentLinks,
  } = await import("../payments/paymentLinkCancel.js");

  if (!quotationHasCancellableOnlinePaymentLinks(existing)) {
    throw new Error(
      "No online payment links found to cancel. Revert is only available for Approved invoices with a Stripe or Razorpay payment link.",
    );
  }

  // Cancel provider links first so customers cannot pay after a failed DB write.
  await cancelQuotationPaymentLinks(existing);

  const actor = String(actorEmail || "").trim() || "sales";
  const trimmedNote = String(note || "").trim();
  const financeNote = trimmedNote
    ? `Reverted by sales: ${trimmedNote}`
    : "Reverted by sales: payment link cancelled; resubmit a new invoice to finance.";
  const failureReason = "Payment link cancelled — sales reverted finance approval.";

  const quotation = await withTransaction(async (client) => {
    const locked = await paymentsRepo.selectPaymentForUpdate(client, id);
    if (locked) {
      const lockedStatus = String(locked.status || "").toLowerCase();
      if (["paid", "reported", "partial", "refunded"].includes(lockedStatus)) {
        throw new Error(
          "This invoice cannot be reverted because payment was already paid or reported.",
        );
      }
    }

    const branchRows = await branchPaymentsRepo.selectBranchPaymentsByQuotationId(client, id);
    if (
      (branchRows || []).some((entry: any) =>
        ["paid", "reported", "partial"].includes(String(entry.status || "").toLowerCase()),
      )
    ) {
      throw new Error(
        "This invoice cannot be reverted because one or more branch payments were already paid or reported.",
      );
    }

    await branchPaymentsRepo.clearBranchPaymentLinksForSalesRevert(client, id, failureReason);
    await paymentsRepo.clearPaymentLinksForSalesRevert(client, id, failureReason);

    let row;
    try {
      row = await transitionQuotationStatus(client, {
        quotationId: id,
        fromStatus: QUOTATION_STATUSES.APPROVED,
        toStatus: QUOTATION_STATUSES.REJECTED,
        financeNote,
        reviewedBy: actor,
      });
    } catch (error) {
      const mapped = mapQuotationTransitionError(error, "revert-approval");
      if (mapped === null) {
        return null;
      }
      throw mapped;
    }

    await quotationsRepo.deleteActiveProductsByQuotation(client, id);

    const hydrated = await hydrateQuotation(client, row, { includePdfs: false });
    await updateLeadStatusPreservingCustomer(
      client,
      hydrated.leadId,
      QUOTATION_STATUSES.REJECTED,
    );
    return hydrated;
  });

  if (quotation) {
    void publishLeadQuotationEvent("quotation.rejected", quotation, {
      reason: "sales_revert_approval",
    });
  }

  return quotation;
}

export async function issueQuotationPaymentLink(
  quotationId: any,
  { provider }: any = {},
) {
  const quotation = await getQuotation(quotationId, { includePdfs: false });
  if (!quotation) {
    return null;
  }

  const { applyPaymentProviderPolicy } = await import("../payments/amount-policy.js");
  const { provider: resolvedProvider, policy } = applyPaymentProviderPolicy(quotation, provider);

  if (policy.mode === "offline") {
    throw new Error(
      policy.reason ||
        "Online payment links are not available for this invoice amount. Use offline payment.",
    );
  }

  const { createQuotationBranchPaymentLinks } = await import("../payments/runtime-service.js");
  const { parentPayment, branchPayments } = await createQuotationBranchPaymentLinks(quotation, {
    provider: resolvedProvider,
  });

  const updated =
    branchPayments.length > 0
      ? await attachBranchPaymentsToQuotation(quotationId, { parentPayment, branchPayments })
      : await attachPaymentToQuotation(quotationId, parentPayment);

  return { quotation: updated, payment: updated?.payment || parentPayment };
}

export async function rejectQuotation(id: any, reviewerEmail: any, note: any) {
  const trimmedNote = note?.trim();
  if (!trimmedNote) {
    throw new Error("A rejection note is required.");
  }

  const quotation = await withTransaction(async (client) => {
    let row;
    try {
      row = await transitionQuotationStatus(client, {
        quotationId: id,
        fromStatus: QUOTATION_STATUSES.PENDING,
        toStatus: QUOTATION_STATUSES.REJECTED,
        financeNote: trimmedNote,
        reviewedBy: reviewerEmail,
      });
    } catch (error) {
      const mapped = mapQuotationTransitionError(error, "reject");
      if (mapped === null) {
        return null;
      }
      throw mapped;
    }

    // Skip PDF base64 during reject — finance HTTP path must stay light; emails reload PDFs later.
    const hydrated = await hydrateQuotation(client, row, { includePdfs: false });
    // Billing-change / renewal-style rejections must not bounce a paid customer to Rejected.
    // Existing customers with prior Paid quotes stay Paid / Partially paid.
    if (!isBillingChangePhase(hydrated.billingPhase) && !payloadIsRenewalQuote(hydrated)) {
      await updateLeadStatusPreservingCustomer(
        client,
        hydrated.leadId,
        QUOTATION_STATUSES.REJECTED,
      );
    }
    return hydrated;
  });

  if (quotation) {
    void publishLeadQuotationEvent("quotation.rejected", quotation);
  }

  return quotation;
}
