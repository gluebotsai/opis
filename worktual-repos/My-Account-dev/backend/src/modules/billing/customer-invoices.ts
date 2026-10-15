import { pool } from "../../db/pool.js";
import { HQ_BRANCH_ID } from "../../lib/leads.js";
import {
  getCustomerEntitlements,
  isHeadOfficePortalUser,
} from "../customer-portal/customer-auth.js";
import {
  mapPartnerQuotationSummary,
  partnerCanViewInvoice,
} from "../partners/quotations.js";
import { getQuotationInvoiceForLead } from "../quotations/quotation-store.js";
import { selectQuotationsByLeadIdWithBillingBranch } from "../../repositories/raw/quotations.repo.js";
import { QUOTATION_STATUSES } from "../../lib/statuses.js";

const CUSTOMER_INVOICE_STATUSES = new Set([
  QUOTATION_STATUSES.APPROVED,
  QUOTATION_STATUSES.PAID,
]);

function normalizeBillingBranchId(branchId: any) {
  const value = String(branchId || "").trim();
  return value || HQ_BRANCH_ID;
}

/**
 * Strict own-branch invoice scope.
 * - Non-head users: only their `branchId` (never HQ aliases).
 * - Head-office users: their branch id plus legacy `"hq"` so invoices stored as either
 *   primary location id or `"hq"` match — never other branches.
 */
function resolveAllowedBillingBranchIds(user: any, organization: any) {
  const branchId = String(user?.branchId || "").trim();
  if (!branchId) {
    return [];
  }

  const allowed = new Set([branchId]);
  const isHead =
    user?.isHeadOffice === true || isHeadOfficePortalUser(user, organization);

  if (isHead) {
    allowed.add(HQ_BRANCH_ID);
  }

  return [...allowed];
}

function billingBranchMatchesAllowed(billingBranchId: any, allowedBranchIds: string[]) {
  if (!allowedBranchIds.length) {
    return false;
  }
  const normalized = normalizeBillingBranchId(billingBranchId);
  return allowedBranchIds.includes(normalized);
}

function customerInvoiceStatusLabel(status: any) {
  if (status === QUOTATION_STATUSES.APPROVED) {
    return "Awaiting payment";
  }
  if (status === QUOTATION_STATUSES.PAID) {
    return "Paid";
  }
  return String(status || "Unknown");
}

function mapCustomerInvoiceSummary(row: any) {
  const mapped = mapPartnerQuotationSummary(row);
  if (!mapped) {
    return null;
  }

  return {
    id: mapped.id,
    quotationId: mapped.id,
    status: mapped.status,
    statusLabel: customerInvoiceStatusLabel(mapped.status),
    canPreview: Boolean(mapped.canViewInvoice && mapped.hasInvoice),
    fileName: mapped.fileName,
    hasPdf: Boolean(mapped.hasInvoice),
    grandTotal: mapped.grandTotal,
    currency: mapped.currency || "INR",
    submittedAt: mapped.submittedAt,
    reviewedAt: mapped.reviewedAt,
    paidAt: mapped.paidAt,
    billingBranchId: normalizeBillingBranchId(row.billing_branch_id || row.billingBranchId),
  };
}

async function resolveCustomerInvoiceScope(customerUserId: any) {
  const entitlements = await getCustomerEntitlements(customerUserId);
  const sourceLeadId = entitlements?.organization?.sourceLeadId || null;
  const allowedBranchIds = resolveAllowedBillingBranchIds(
    entitlements?.user,
    entitlements?.organization,
  );
  return {
    entitlements,
    sourceLeadId: sourceLeadId ? String(sourceLeadId) : null,
    allowedBranchIds,
  };
}

function scopeInvoicePayloadToBranch(invoice: any, allowedBranchIds: string[]) {
  if (!invoice || !allowedBranchIds.length) {
    return null;
  }

  const invoices = Array.isArray(invoice.invoices) ? invoice.invoices : [];
  const scopedInvoices = invoices.filter((entry: any) =>
    billingBranchMatchesAllowed(entry?.billingBranchId, allowedBranchIds),
  );

  // Legacy single-PDF quotations have no per-branch invoice rows. Only serve the
  // top-level PDF when the batch merge did not attach other-branch invoice entries
  // (those must match explicitly — never re-tag a foreign PDF as this branch).
  if (!scopedInvoices.length && invoice.pdfBase64 && invoices.length === 0) {
    return {
      ...invoice,
      productInvoices: [],
      canViewByProduct: false,
      invoices: [
        {
          fileName: invoice.fileName,
          pdfBase64: invoice.pdfBase64,
          billingBranchId: allowedBranchIds[0],
          branchLabel: invoice.fileName || "Invoice",
          billingLabel: invoice.fileName || "Invoice",
        },
      ],
      quotationIds: invoice.quotationId ? [invoice.quotationId] : invoice.quotationIds || [],
    };
  }

  if (!scopedInvoices.length) {
    return null;
  }

  const primary = scopedInvoices[0];
  return {
    ...invoice,
    fileName: primary.fileName || invoice.fileName,
    pdfBase64: primary.pdfBase64 || "",
    productInvoices: [],
    canViewByProduct: false,
    invoices: scopedInvoices,
    quotationIds: invoice.quotationId ? [invoice.quotationId] : invoice.quotationIds || [],
  };
}

export async function listCustomerInvoices(customerUserId: any) {
  const { sourceLeadId, allowedBranchIds } = await resolveCustomerInvoiceScope(customerUserId);
  if (!sourceLeadId || !allowedBranchIds.length) {
    return [];
  }

  const rows = await selectQuotationsByLeadIdWithBillingBranch(
    pool,
    sourceLeadId,
    allowedBranchIds,
  );
  return rows
    .map(mapCustomerInvoiceSummary)
    .filter(
      (entry: any) =>
        entry &&
        CUSTOMER_INVOICE_STATUSES.has(entry.status) &&
        partnerCanViewInvoice(entry.status) &&
        billingBranchMatchesAllowed(entry.billingBranchId, allowedBranchIds),
    )
    .map(({ billingBranchId, ...rest }: any) => rest);
}

export async function getCustomerInvoice(customerUserId: any, quotationId: any) {
  const { sourceLeadId, allowedBranchIds } = await resolveCustomerInvoiceScope(customerUserId);
  if (!sourceLeadId || !allowedBranchIds.length) {
    return null;
  }

  const rows = await selectQuotationsByLeadIdWithBillingBranch(
    pool,
    sourceLeadId,
    allowedBranchIds,
  );
  const summary = rows
    .map(mapCustomerInvoiceSummary)
    .find((entry: any) => entry && String(entry.id) === String(quotationId));

  if (
    !summary ||
    !partnerCanViewInvoice(summary.status) ||
    !billingBranchMatchesAllowed(summary.billingBranchId, allowedBranchIds)
  ) {
    return null;
  }

  const invoice = await getQuotationInvoiceForLead(sourceLeadId, quotationId, {
    includeProductSplit: false,
  });
  if (!invoice) {
    return null;
  }

  return scopeInvoicePayloadToBranch(invoice, allowedBranchIds);
}
