const GST_RATE = 0.18;

function parsePriceLabel(priceLabel) {
  const match = String(priceLabel || "").match(/([\d,]+(?:\.\d+)?)/);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function sumInvoiceGrandTotals(invoices = []) {
  const totals = invoices
    .map((entry) => Number(entry?.grandTotal))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!totals.length) {
    return null;
  }

  return totals.reduce((sum, value) => sum + value, 0);
}

function sumInvoiceSubtotals(invoices = []) {
  const totals = invoices
    .map((entry) => Number(entry?.subtotal))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!totals.length) {
    return null;
  }

  return totals.reduce((sum, value) => sum + value, 0);
}

function resolveCurrencyFromQuotation(quotation) {
  return (
    quotation?.currency ||
    quotation?.payment?.currency ||
    quotation?.invoices?.find((entry) => entry?.currency)?.currency ||
    quotation?.assignments?.find((entry) => entry?.config?.currency)?.config?.currency ||
    "INR"
  );
}

export function resolveQuotationPaymentAmount(quotation) {
  const currency = resolveCurrencyFromQuotation(quotation);
  const invoiceGrandTotal = sumInvoiceGrandTotals(quotation?.invoices);
  const invoiceSubtotal = sumInvoiceSubtotals(quotation?.invoices);

  if (invoiceGrandTotal > 0) {
    return {
      subtotal: invoiceSubtotal ?? invoiceGrandTotal / (1 + GST_RATE),
      grandTotal: Math.round(invoiceGrandTotal * 100) / 100,
      currency,
      gstRate: quotation?.gstRate ?? GST_RATE,
    };
  }

  if (quotation?.payment?.grandTotal > 0) {
    return {
      subtotal: quotation.payment.subtotal ?? quotation.payment.grandTotal / (1 + GST_RATE),
      grandTotal: quotation.payment.grandTotal,
      currency: quotation.payment.currency || currency,
      gstRate: quotation.payment.gstRate ?? GST_RATE,
    };
  }

  if (quotation?.grandTotal > 0) {
    return {
      subtotal: quotation.subtotal ?? quotation.grandTotal / (1 + GST_RATE),
      grandTotal: quotation.grandTotal,
      currency,
      gstRate: quotation.gstRate ?? GST_RATE,
    };
  }

  const subtotal = (quotation?.productSummary || []).reduce(
    (sum, item) => sum + parsePriceLabel(item.priceLabel),
    0,
  );

  const grandTotal = Math.round(subtotal * (1 + GST_RATE) * 100) / 100;

  return {
    subtotal,
    grandTotal,
    currency,
    gstRate: GST_RATE,
  };
}

export function formatPaymentAmount(amount, currency = "INR") {
  return `${currency} ${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
