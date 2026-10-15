/**
 * Build and attach the same quotation invoice PDF used by sales submit,
 * for server-side auto-renewal quotation creation (Node-safe, no browser logo).
 */
import { format } from "date-fns";

import { getServicePeriodForInvoice2 } from "../billing/dates.js";
import { PRODUCT_CATALOG, getProductName } from "../../lib/productCatalog.js";
import { CHANGE_TYPES, getChangeTypeLabel } from "../../lib/activeProducts.js";
import { buildQuotationInvoice } from "../../lib/invoice.js";
import { formatPeriodDate } from "../../lib/proration.js";

export function formatRenewalPeriodLabel(periodStart: any, periodEnd: any) {
  if (!periodStart || !periodEnd) {
    return "";
  }
  return `${formatPeriodDate(periodStart)} to ${formatPeriodDate(periodEnd)}`;
}

export function resolveRenewalServicePeriod(purchaseDate = new Date()) {
  const period = getServicePeriodForInvoice2(purchaseDate);
  return {
    periodStart: period.start,
    periodEnd: period.end,
    periodStartIso: format(period.start, "yyyy-MM-dd"),
    periodEndIso: format(period.end, "yyyy-MM-dd"),
    periodLabel: formatRenewalPeriodLabel(period.start, period.end),
  };
}

export async function buildRenewalQuotationPdf(payload: any) {
  if (!payload?.lead || !payload?.assignments?.length) {
    return null;
  }

  const products = PRODUCT_CATALOG.map((entry) => ({
    id: entry.id,
    name: getProductName(entry.id) || entry.name,
  }));

  // Ensure every assignment product is present even if catalog grows later.
  for (const assignment of payload.assignments) {
    if (!products.some((entry) => entry.id === assignment.productId)) {
      products.push({
        id: assignment.productId,
        name: getProductName(assignment.productId) || assignment.productId,
      });
    }
  }

  const { loadInvoiceLogoFromFile } = await import("../billing/invoice-logo.js");
  const logoAsset = loadInvoiceLogoFromFile();
  const invoice = await buildQuotationInvoice({
    lead: payload.lead,
    products,
    assignments: payload.assignments,
    invoiceMode: payload.invoiceMode || "consolidated",
    logoAsset,
    skipLogo: !logoAsset,
  });

  const primary = invoice.invoices?.[0] || invoice;
  return {
    fileName: invoice.fileName || primary.fileName,
    pdfBase64: invoice.pdfBase64 || primary.pdfBase64,
    invoices: (invoice.invoices || []).map((entry) => ({
      fileName: entry.fileName,
      pdfBase64: entry.pdfBase64,
      billingBranchId: entry.billingBranchId || null,
      branchLabel: (entry as any).branchLabel || entry.label || null,
      subtotal: (entry as any).subtotal ?? null,
      grandTotal: (entry as any).grandTotal ?? null,
    })),
    subtotal: (primary as any).subtotal ?? payload.subtotal,
    grandTotal: (primary as any).grandTotal ?? payload.grandTotal,
  };
}

export async function withRenewalQuotationDocuments(payload: any) {
  const docs = await buildRenewalQuotationPdf(payload);
  if (!docs?.pdfBase64) {
    return payload;
  }

  return {
    ...payload,
    fileName: docs.fileName || payload.fileName,
    pdfBase64: docs.pdfBase64,
    invoices: docs.invoices?.length ? docs.invoices : payload.invoices,
    subtotal: docs.subtotal ?? payload.subtotal,
    grandTotal: docs.grandTotal ?? payload.grandTotal,
    payment: {
      ...(payload.payment || {}),
      subtotal: docs.subtotal ?? payload.payment?.subtotal ?? payload.subtotal,
      grandTotal: docs.grandTotal ?? payload.payment?.grandTotal ?? payload.grandTotal,
    },
  };
}

export function renewalChangeTypeFields() {
  return {
    changeType: CHANGE_TYPES.RENEWAL,
    changeTypeLabel: getChangeTypeLabel(CHANGE_TYPES.RENEWAL),
  };
}
