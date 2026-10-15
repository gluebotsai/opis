import crypto from "node:crypto";

import { pool, withTransaction } from "./db/pool.js";
import { rowToCamel, toIso } from "./db/util.js";
import { activeProductKey } from "./activeProductKey.js";
import { ensureAssignmentBranchRows, loadLeadSnapshot, updateLeadStatus } from "./leads.js";
import { validateAssignmentsForDuplicatePurchase } from "./payments/duplicatePurchase.js";
import { QUOTATION_STATUSES } from "./statuses.js";
import {
  transitionQuotationStatus,
  updateLeadStatusRow,
} from "./repositories/functions/quotations.repo.js";
import * as quotationsRepo from "./repositories/raw/quotations.repo.js";
import { publishQuotationEvent } from "./infra/events.js";

function mapQuotationTransitionError(error, action = "approve") {
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
    throw new Error(`Only pending quotations can be approved. Current status: ${status}.`);
  }
  throw error;
}

export { QUOTATION_STATUSES };

function wasImplementationPurchased(config) {
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

function buildActiveProductsPayload(quotation, assignments, productSummary) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return (productSummary || []).map((item) => ({
      key: activeProductKey(quotation.leadId, item.productId || item.name, "hq"),
      productId: item.productId || "",
      branchId: "hq",
      billingTargetId: "hq",
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
    billingTargetId: assignment.branchId || assignment.billingTargetId,
    changeType: assignment.changeType || "new",
    config: assignment.config || null,
    implementationPurchased: wasImplementationPurchased(assignment.config),
    priceLabel:
      productSummary?.find((item) => item.productId === assignment.productId)?.priceLabel || "",
    approvedAt: quotation.reviewedAt || quotation.submittedAt,
    quotationId: quotation.id,
  }));
}

async function loadAssignments(client, quotationId) {
  const rows = await quotationsRepo.selectAssignmentsByQuotation(client, quotationId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    const branchId = entry.branchId || "hq";

    return {
      id: entry.id,
      productId: entry.productId,
      branchId,
      billingTargetId: branchId,
      changeType: entry.changeType || "new",
      config: entry.config || null,
    };
  });
}

async function loadProductSummary(client, quotationId) {
  const rows = await quotationsRepo.selectProductSummaryByQuotation(client, quotationId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      productId: entry.productId,
      name: entry.name,
      priceLabel: entry.priceLabel,
      branchLabel: entry.branchLabel,
      billingLabel: entry.billingLabel,
      changeTypeLabel: entry.changeTypeLabel,
    };
  });
}

async function loadInvoices(client, quotationId) {
  const rows = await quotationsRepo.selectInvoicesByQuotation(client, quotationId);

  return rows.map((row) => {
    const entry = rowToCamel(row);
    return {
      fileName: entry.fileName,
      pdfBase64: entry.pdfBase64,
      billingTargetId: entry.billingTargetId,
      branchLabel: entry.branchLabel,
      subtotal: entry.subtotal !== null ? Number(entry.subtotal) : null,
      grandTotal: entry.grandTotal !== null ? Number(entry.grandTotal) : null,
    };
  });
}

async function loadPayment(client, quotationId) {
  const row = await quotationsRepo.selectPaymentByQuotation(client, quotationId);

  if (!row) {
    return null;
  }

  const payment = rowToCamel(row);
  return {
    provider: payment.provider,
    paymentLinkUrl: payment.paymentLinkUrl,
    paymentLinkId: payment.paymentLinkId,
    subtotal: payment.subtotal !== null ? Number(payment.subtotal) : null,
    grandTotal: payment.grandTotal !== null ? Number(payment.grandTotal) : null,
    currency: payment.currency,
    gstRate: payment.gstRate !== null ? Number(payment.gstRate) : null,
    amountLabel: payment.amountLabel,
    status: payment.status || "pending",
    paidAt: toIso(payment.paidAt),
    providerPaymentId: payment.providerPaymentId || null,
    failureReason: payment.failureReason || null,
    dryRun: payment.dryRun === true,
    updatedAt: toIso(payment.updatedAt),
  };
}

async function hydrateQuotation(client, row) {
  const base = rowToCamel(row);
  const assignments = await loadAssignments(client, base.id);
  const productSummary = await loadProductSummary(client, base.id);
  const invoices = await loadInvoices(client, base.id);
  const payment = await loadPayment(client, base.id);

  return {
    id: base.id,
    leadId: base.leadId,
    lead: base.leadSnapshot || null,
    fileName: base.fileName || "",
    pdfBase64: base.pdfBase64 || "",
    productSummary,
    assignments,
    invoiceMode: base.invoiceMode || "consolidated",
    branchSummary: base.branchSummary || null,
    invoices,
    grandTotal: base.grandTotal !== null ? Number(base.grandTotal) : null,
    subtotal: base.subtotal !== null ? Number(base.subtotal) : null,
    currency: base.currency || "INR",
    gstRate: base.gstRate !== null ? Number(base.gstRate) : 0.18,
    payment,
    submittedBy: base.submittedBy || "",
    submittedAt: toIso(base.submittedAt),
    status: base.status,
    financeNote: base.financeNote || "",
    reviewedAt: toIso(base.reviewedAt),
    reviewedBy: base.reviewedBy || null,
    version: base.version ?? 1,
  };
}

async function upsertActiveProducts(client, quotation, assignments, productSummary) {
  const payload = buildActiveProductsPayload(quotation, assignments, productSummary);

  for (const entry of payload) {
    await quotationsRepo.upsertActiveProduct(client, [
        entry.key,
        quotation.leadId,
        entry.productId,
        entry.branchId,
        entry.billingTargetId || entry.branchId,
        entry.changeType || "new",
        JSON.stringify(entry.config || null),
        entry.implementationPurchased === true,
        entry.priceLabel || "",
        quotation.id,
        entry.approvedAt || new Date().toISOString(),
    ]);
  }
}

/**
 * Backfill active_products from quotation assignments/summary when missing.
 * Safe to call repeatedly — no-op when rows already exist for this lead+quotation.
 */
export async function ensureActiveProductsForQuotation(quotationId, client = null) {
  const work = async (c) => {
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

    await ensureAssignmentBranchRows(
      c,
      quotation.leadId,
      quotation.lead,
      quotation.assignments,
    );

    await upsertActiveProducts(c, quotation, quotation.assignments, quotation.productSummary);

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
    const rows = await quotationsRepo.selectAllQuotations(client);
    const quotations = [];

    for (const row of rows) {
      quotations.push(await hydrateQuotation(client, row));
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
    if (!entry.leadId) {
      continue;
    }

    if (
      (entry.status === QUOTATION_STATUSES.APPROVED ||
        entry.status === QUOTATION_STATUSES.PAID) &&
      !activeProductsByLeadId.has(entry.leadId)
    ) {
      const productRows = await quotationsRepo.selectActiveProductsByLead(pool, entry.leadId);
      activeProductsByLeadId.set(
        entry.leadId,
        productRows.map((productRow) => {
          const product = rowToCamel(productRow);
          return {
            key: product.key,
            productId: product.productId,
            branchId: product.branchId,
            billingTargetId: product.billingTargetId,
            changeType: product.changeType || "new",
            config: product.config || null,
            implementationPurchased: product.implementationPurchased === true,
            priceLabel: product.priceLabel || "",
            approvedAt: toIso(product.approvedAt),
            quotationId: product.quotationId,
          };
        }),
      );
    }

    if (latestByLeadId.has(entry.leadId)) {
      continue;
    }

    latestByLeadId.set(entry.leadId, {
      leadId: entry.leadId,
      status: entry.status,
      financeNote: entry.financeNote || "",
      reviewedAt: toIso(entry.reviewedAt),
      reviewedBy: entry.reviewedBy || "",
      submittedAt: toIso(entry.submittedAt),
      quotationId: entry.quotationId,
      activeProducts: activeProductsByLeadId.get(entry.leadId) || [],
      payment:
        entry.paymentLinkUrl || entry.paymentGrandTotal
          ? {
              paymentLinkUrl: entry.paymentLinkUrl || "",
              grandTotal:
                entry.paymentGrandTotal !== null && entry.paymentGrandTotal !== undefined
                  ? Number(entry.paymentGrandTotal)
                  : null,
              currency: entry.paymentCurrency || entry.currency || "INR",
              status: entry.paymentStatus || "pending",
              paidAt: toIso(entry.paymentPaidAt),
            }
          : null,
      grandTotal:
        entry.grandTotal !== null && entry.grandTotal !== undefined
          ? Number(entry.grandTotal)
          : entry.paymentGrandTotal !== null && entry.paymentGrandTotal !== undefined
            ? Number(entry.paymentGrandTotal)
            : null,
      currency: entry.currency || entry.paymentCurrency || "INR",
    });
  }

  return [...latestByLeadId.values()].map((entry) => ({
    ...entry,
    activeProducts: activeProductsByLeadId.get(entry.leadId) || entry.activeProducts || [],
  }));
}

export async function getQuotation(id) {
  const client = await pool.connect();
  try {
    const row = await quotationsRepo.selectQuotationById(client, id);
    if (!row) {
      return null;
    }

    return hydrateQuotation(client, row);
  } finally {
    client.release();
  }
}

export async function getApprovedQuotationPayment(leadId) {
  const client = await pool.connect();
  try {
    const row = await quotationsRepo.selectApprovedQuotationWithPayment(
      client,
      leadId,
      [QUOTATION_STATUSES.APPROVED, QUOTATION_STATUSES.PAID],
    );

    if (!row) {
      return null;
    }

    return hydrateQuotation(client, row);
  } finally {
    client.release();
  }
}

export async function createQuotation(payload) {
  const quotation = await withTransaction(async (client) => {
    const duplicate = await quotationsRepo.selectDuplicateQuotation(
      client,
      payload.leadId,
      payload.fileName || "",
      payload.pdfBase64 || "",
    );

    if (duplicate) {
      const existing = await quotationsRepo.selectQuotationById(client, duplicate.id);
      return hydrateQuotation(client, existing);
    }

    const leadSnapshot =
      payload.lead || (await loadLeadSnapshot(client, payload.leadId));

    await validateAssignmentsForDuplicatePurchase(
      payload.leadId,
      payload.assignments,
      {
        financeOverride: payload.financeOverride === true,
        overrideNote: payload.overrideNote || "",
      },
      client,
    );

    if (leadSnapshot) {
      await ensureAssignmentBranchRows(
        client,
        payload.leadId,
        leadSnapshot,
        payload.assignments,
      );
    }

    const quotationId = crypto.randomUUID();
    const submittedAt = new Date().toISOString();

    const row = await quotationsRepo.insertQuotation(client, [
      quotationId,
      payload.leadId,
      JSON.stringify(payload.lead || null),
      payload.fileName || null,
      payload.pdfBase64 || null,
      payload.invoiceMode || "consolidated",
      JSON.stringify(payload.branchSummary || null),
      payload.subtotal ?? payload.payment?.subtotal ?? null,
      payload.grandTotal ?? payload.payment?.grandTotal ?? null,
      payload.currency || payload.payment?.currency || "INR",
      payload.gstRate ?? payload.payment?.gstRate ?? 0.18,
      QUOTATION_STATUSES.PENDING,
      payload.submittedBy || "",
      submittedAt,
    ]);

    for (const assignment of payload.assignments || []) {
      const branchId = assignment.branchId || "hq";

      await quotationsRepo.insertProductAssignment(client, [
        crypto.randomUUID(),
        quotationId,
        payload.leadId,
        assignment.productId,
        branchId,
        branchId,
        assignment.changeType || "new",
        JSON.stringify(assignment.config || null),
      ]);
    }

    for (const item of payload.productSummary || []) {
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

    for (const invoice of payload.invoices || []) {
      await quotationsRepo.insertQuotationInvoice(client, [
        quotationId,
        invoice.fileName || null,
        invoice.pdfBase64 || null,
        invoice.billingTargetId || null,
        invoice.branchLabel || null,
        invoice.subtotal ?? null,
        invoice.grandTotal ?? null,
      ]);
    }

    await updateLeadStatus(client, payload.leadId, QUOTATION_STATUSES.PENDING);

    return hydrateQuotation(client, row);
  });

  if (quotation) {
    void publishQuotationEvent("quotation.submitted", {
      quotationId: quotation.id,
      leadId: quotation.leadId,
      status: quotation.status,
    });
  }

  return quotation;
}

export async function attachPaymentToQuotation(id, payment) {
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

    return hydrateQuotation(client, row);
  });
}

export async function approveQuotation(id, reviewerEmail, note = "") {
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

    const quotation = await hydrateQuotation(client, row);
    await ensureAssignmentBranchRows(
      client,
      quotation.leadId,
      quotation.lead,
      quotation.assignments,
    );
    const productSync = await ensureActiveProductsForQuotation(quotation.id, client);

    if (productSync.skipped && productSync.reason === "no_product_data") {
      throw new Error(
        "Cannot approve quotation without product assignments or a product summary.",
      );
    }

    await updateLeadStatusRow(client, quotation.leadId, QUOTATION_STATUSES.APPROVED);

    return quotation;
  });

  if (quotation) {
    void publishQuotationEvent("quotation.approved", {
      quotationId: quotation.id,
      leadId: quotation.leadId,
      status: quotation.status,
    });
  }

  return quotation;
}

export async function revertQuotationApproval(id) {
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
      if (String(error?.message || "").includes("QUOTATION_NOT_FOUND")) {
        return null;
      }
      if (String(error?.message || "").includes("INVALID_STATUS:")) {
        return null;
      }
      throw error;
    }

    await quotationsRepo.deleteActiveProductsByQuotation(client, id);

    const quotation = await hydrateQuotation(client, row);
    await updateLeadStatusRow(client, quotation.leadId, QUOTATION_STATUSES.PENDING);

    return quotation;
  });
}

export async function issueQuotationPaymentLink(quotationId, { provider } = {}) {
  const quotation = await getQuotation(quotationId);
  if (!quotation) {
    return null;
  }

  const { createQuotationPaymentLink } = await import("./payments/index.js");
  const payment = await createQuotationPaymentLink(quotation, { provider });
  const updated = await attachPaymentToQuotation(quotationId, payment);

  return { quotation: updated, payment };
}

export async function rejectQuotation(id, reviewerEmail, note) {
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

    const hydrated = await hydrateQuotation(client, row);
    await updateLeadStatusRow(client, hydrated.leadId, QUOTATION_STATUSES.REJECTED);
    return hydrated;
  });

  if (quotation) {
    void publishQuotationEvent("quotation.rejected", {
      quotationId: quotation.id,
      leadId: quotation.leadId,
      status: quotation.status,
    });
  }

  return quotation;
}
