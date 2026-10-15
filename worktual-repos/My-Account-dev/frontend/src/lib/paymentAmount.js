const GST_RATE = 0.18;

function parsePriceLabel(priceLabel) {
  const match = String(priceLabel || "").match(/([\d,]+(?:\.\d+)?)/);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

export function computeQuotePaymentFromSummary(productSummary = [], currency = "INR") {
  const subtotal = productSummary.reduce((sum, item) => sum + parsePriceLabel(item.priceLabel), 0);
  const grandTotal = Math.round(subtotal * (1 + GST_RATE) * 100) / 100;

  return {
    subtotal,
    grandTotal,
    currency,
    gstRate: GST_RATE,
  };
}

export function computeQuotePaymentFromInvoices(invoices = [], fallbackCurrency = "INR") {
  const currency = invoices.find((entry) => entry?.currency)?.currency || fallbackCurrency;
  const subtotal = invoices.reduce((sum, entry) => sum + Number(entry?.subtotal || 0), 0);
  const grandTotal = invoices.reduce((sum, entry) => sum + Number(entry?.grandTotal || 0), 0);

  if (grandTotal > 0) {
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      currency,
      gstRate: GST_RATE,
    };
  }

  return null;
}

export function resolveQuoteSessionPaymentTotals(quoteSession) {
  if (quoteSession?.paymentTotals?.grandTotal > 0) {
    return quoteSession.paymentTotals;
  }

  const fromInvoices = computeQuotePaymentFromInvoices(
    quoteSession?.invoices || [],
    quoteSession?.assignments?.[0]?.config?.currency || "INR",
  );
  if (fromInvoices) {
    return fromInvoices;
  }

  return computeQuotePaymentFromSummary(
    quoteSession?.productSummary || [],
    quoteSession?.assignments?.[0]?.config?.currency || "INR",
  );
}

export function computeQuotePaymentFromAssignments(assignments = []) {
  const subtotal = assignments.reduce((sum, assignment) => {
    const priceLabel = assignment?.config?.currency
      ? `${assignment.config.currency} ${Number(assignment.config?.finalPayableEstimate || 0)}`
      : "";
    return sum + parsePriceLabel(priceLabel);
  }, 0);

  const currency = assignments[0]?.config?.currency || "INR";
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
