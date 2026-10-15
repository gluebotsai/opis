import { toIso } from "../../db/util.js";
import { QUOTATION_STATUSES } from "../../lib/statuses.js";

/** Partner-facing quotation status labels. */
export function partnerQuotationStatusLabel(status: any) {
  if (!status) {
    return "Not quoted";
  }
  if (status === QUOTATION_STATUSES.PENDING) {
    return "Pending finance review";
  }
  if (status === QUOTATION_STATUSES.APPROVED) {
    return "Awaiting payment";
  }
  if (status === QUOTATION_STATUSES.PAID) {
    return "Paid";
  }
  if (status === QUOTATION_STATUSES.REJECTED) {
    return "Rejected";
  }
  return String(status);
}

export function partnerCanViewInvoice(status: any) {
  return status === QUOTATION_STATUSES.APPROVED || status === QUOTATION_STATUSES.PAID;
}

export function mapPartnerQuotationSummary(row: any) {
  if (!row) {
    return null;
  }
  const status = row.status || null;
  return {
    id: row.id,
    leadId: row.lead_id || row.leadId || null,
    status,
    statusLabel: partnerQuotationStatusLabel(status),
    canViewInvoice: partnerCanViewInvoice(status),
    fileName: row.file_name || row.fileName || "",
    hasInvoice: row.has_pdf === true || row.hasPdf === true,
    grandTotal:
      row.grand_total !== null && row.grand_total !== undefined
        ? Number(row.grand_total)
        : row.grandTotal !== null && row.grandTotal !== undefined
          ? Number(row.grandTotal)
          : null,
    subtotal:
      row.subtotal !== null && row.subtotal !== undefined ? Number(row.subtotal) : null,
    currency: row.currency || "INR",
    submittedAt: toIso(row.submitted_at || row.submittedAt),
    reviewedAt: toIso(row.reviewed_at || row.reviewedAt),
    paidAt: toIso(row.payment_paid_at || row.paymentPaidAt || row.paidAt),
  };
}
