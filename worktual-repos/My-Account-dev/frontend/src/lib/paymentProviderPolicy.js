/** Razorpay is not allowed above this INR grand total (GST-inclusive). */
export const RAZORPAY_MAX_INR = 500_000;

/** Online payment links are not allowed above this INR grand total (GST-inclusive). */
export const ONLINE_PAYMENT_MAX_INR = 2_500_000;

function sumInvoiceGrandTotals(invoices = []) {
  if (!Array.isArray(invoices) || !invoices.length) {
    return null;
  }

  let hasFinite = false;
  let sum = 0;
  for (const entry of invoices) {
    const value = Number(entry?.grandTotal);
    if (!Number.isFinite(value)) {
      continue;
    }
    hasFinite = true;
    sum += Math.max(0, value);
  }

  return hasFinite ? sum : null;
}

export function resolveQuotationGrandTotal(quotation) {
  const payment = quotation?.payment;
  const paymentGrand = Number(payment?.grandTotal);
  if (Number.isFinite(paymentGrand)) {
    return {
      grandTotal: Math.round(paymentGrand * 100) / 100,
      currency: payment.currency || quotation?.currency || "INR",
    };
  }

  const quotationGrand = Number(quotation?.grandTotal);
  if (Number.isFinite(quotationGrand)) {
    return {
      grandTotal: Math.round(quotationGrand * 100) / 100,
      currency: quotation.currency || "INR",
    };
  }

  const invoiceTotal = sumInvoiceGrandTotals(quotation?.invoices);
  if (invoiceTotal !== null) {
    return {
      grandTotal: Math.round(invoiceTotal * 100) / 100,
      currency:
        quotation?.invoices?.find((entry) => entry?.currency)?.currency ||
        quotation?.currency ||
        "INR",
    };
  }

  return { grandTotal: 0, currency: quotation?.currency || "INR" };
}

/**
 * Amount-based payment provider policy for INR invoices.
 * Non-INR currencies keep both online providers available.
 */
export function resolvePaymentProviderPolicy(grandTotal, currency = "INR") {
  const amount = Number(grandTotal);
  const normalizedCurrency = String(currency || "INR").trim().toUpperCase();

  if (Number.isFinite(amount) && amount <= 0) {
    return {
      mode: "zero",
      allowedProviders: [],
      forceProvider: null,
      reason:
        "Invoice amount is ₹0. No payment link is required; approval will mark paid and fulfill.",
    };
  }

  if (normalizedCurrency !== "INR" || !Number.isFinite(amount)) {
    return {
      mode: "online",
      allowedProviders: ["stripe", "razorpay"],
      forceProvider: null,
      reason: "",
    };
  }

  if (amount > ONLINE_PAYMENT_MAX_INR) {
    return {
      mode: "offline",
      allowedProviders: [],
      forceProvider: null,
      reason:
        "Invoice amount exceeds ₹25,00,000. Online payment links are disabled; proceed with offline payment.",
    };
  }

  if (amount > RAZORPAY_MAX_INR) {
    return {
      mode: "online",
      allowedProviders: ["stripe"],
      forceProvider: "stripe",
      reason:
        "Invoice amount exceeds ₹5,00,000. Razorpay is disabled; payment link will be generated with Stripe.",
    };
  }

  return {
    mode: "online",
    allowedProviders: ["stripe", "razorpay"],
    forceProvider: null,
    reason: "",
  };
}

export function resolveQuotationPaymentProviderPolicy(quotation) {
  const amounts = resolveQuotationGrandTotal(quotation);
  return {
    ...resolvePaymentProviderPolicy(amounts.grandTotal, amounts.currency),
    grandTotal: amounts.grandTotal,
    currency: amounts.currency,
  };
}
