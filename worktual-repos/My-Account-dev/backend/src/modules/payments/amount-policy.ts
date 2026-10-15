const GST_RATE = 0.18;

/** Razorpay is not allowed above this INR grand total (GST-inclusive). */
export const RAZORPAY_MAX_INR = 500_000;

/** Online payment links are not allowed above this INR grand total (GST-inclusive). */
export const ONLINE_PAYMENT_MAX_INR = 2_500_000;

/**
 * Amount-based payment provider policy for INR invoices.
 * Non-INR currencies keep both online providers available.
 *
 * @returns {{
 *   mode: "online" | "offline" | "zero",
 *   allowedProviders: string[],
 *   forceProvider: "stripe" | null,
 *   reason: string,
 * }}
 */
export function resolvePaymentProviderPolicy(grandTotal: any, currency = "INR") {
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

export function resolveQuotationPaymentProviderPolicy(quotation: any) {
  const amounts = resolveQuotationPaymentAmount(quotation);
  return {
    ...resolvePaymentProviderPolicy(amounts.grandTotal, amounts.currency),
    grandTotal: amounts.grandTotal,
    currency: amounts.currency,
  };
}

/**
 * Coerce or validate a requested provider against amount policy.
 * @returns {{ provider: string | null, policy: object }}
 */
export function applyPaymentProviderPolicy(quotation: any, requestedProvider = null) {
  const policy = resolveQuotationPaymentProviderPolicy(quotation);

  if (policy.mode === "offline" || policy.mode === "zero") {
    return { provider: null, policy };
  }

  let provider = String(requestedProvider || "").trim().toLowerCase() || null;

  if (policy.forceProvider) {
    provider = policy.forceProvider;
  } else if (provider && !policy.allowedProviders.includes(provider)) {
    throw new Error(
      policy.reason ||
        `Payment provider "${provider}" is not allowed for this invoice amount.`,
    );
  }

  return { provider, policy };
}

function parsePriceLabel(priceLabel: any) {
  const match = String(priceLabel || "").match(/([\d,]+(?:\.\d+)?)/);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function sumInvoiceGrandTotals(invoices = []) {
  if (!Array.isArray(invoices) || !invoices.length) {
    return null;
  }

  let hasFinite = false;
  let sum = 0;
  for (const entry of invoices as any[]) {
    const value = Number(entry?.grandTotal);
    if (!Number.isFinite(value)) {
      continue;
    }
    hasFinite = true;
    sum += Math.max(0, value);
  }

  return hasFinite ? sum : null;
}

function sumInvoiceSubtotals(invoices = []) {
  if (!Array.isArray(invoices) || !invoices.length) {
    return null;
  }

  let hasFinite = false;
  let sum = 0;
  for (const entry of invoices as any[]) {
    const value = Number(entry?.subtotal);
    if (!Number.isFinite(value)) {
      continue;
    }
    hasFinite = true;
    sum += Math.max(0, value);
  }

  return hasFinite ? sum : null;
}

/** True when quotation invoices / totals explicitly resolve to ₹0 (not unknown). */
export function isZeroValueQuotation(quotation: any) {
  const amounts = resolveQuotationPaymentAmount(quotation);
  return Number.isFinite(amounts.grandTotal) && amounts.grandTotal <= 0;
}

function resolveCurrencyFromQuotation(quotation: any) {
  return (
    quotation?.currency ||
    quotation?.payment?.currency ||
    quotation?.invoices?.find((entry: any) => entry?.currency)?.currency ||
    quotation?.assignments?.find((entry: any) => entry?.config?.currency)?.config?.currency ||
    "INR"
  );
}

export function resolveInvoicePaymentAmount(invoice: any, quotation = {}) {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const currency = quotation?.currency || invoice?.currency || "INR";
  const grandTotal = Number(invoice?.grandTotal);
  const subtotal = Number(invoice?.subtotal);

  if (!Number.isFinite(grandTotal) || grandTotal <= 0) {
    return {
      subtotal: 0,
      grandTotal: 0,
      currency,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      gstRate: quotation?.gstRate ?? GST_RATE,
    };
  }

  return {
    subtotal: Number.isFinite(subtotal) && subtotal > 0 ? subtotal : grandTotal / (1 + GST_RATE),
    grandTotal: Math.round(grandTotal * 100) / 100,
    currency,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    gstRate: quotation?.gstRate ?? GST_RATE,
  };
}

export function resolveQuotationPaymentAmount(quotation: any) {
  const currency = resolveCurrencyFromQuotation(quotation);
  const invoiceGrandTotal = sumInvoiceGrandTotals(quotation?.invoices);
  const invoiceSubtotal = sumInvoiceSubtotals(quotation?.invoices);

  if (invoiceGrandTotal !== null) {
    const grandTotal = Math.round(invoiceGrandTotal * 100) / 100;
    return {
      subtotal:
        invoiceSubtotal !== null
          ? invoiceSubtotal
          : grandTotal > 0
            ? grandTotal / (1 + GST_RATE)
            : 0,
      grandTotal,
      currency,
      gstRate: quotation?.gstRate ?? GST_RATE,
    };
  }

  const paymentGrand = Number(quotation?.payment?.grandTotal);
  if (Number.isFinite(paymentGrand)) {
    return {
      subtotal:
        Number.isFinite(Number(quotation.payment.subtotal))
          ? Number(quotation.payment.subtotal)
          : paymentGrand > 0
            ? paymentGrand / (1 + GST_RATE)
            : 0,
      grandTotal: Math.round(paymentGrand * 100) / 100,
      currency: quotation.payment.currency || currency,
      gstRate: quotation.payment.gstRate ?? GST_RATE,
    };
  }

  const quotationGrand = Number(quotation?.grandTotal);
  if (Number.isFinite(quotationGrand)) {
    return {
      subtotal:
        Number.isFinite(Number(quotation.subtotal))
          ? Number(quotation.subtotal)
          : quotationGrand > 0
            ? quotationGrand / (1 + GST_RATE)
            : 0,
      grandTotal: Math.round(quotationGrand * 100) / 100,
      currency,
      gstRate: quotation.gstRate ?? GST_RATE,
    };
  }

  const subtotal = (quotation?.productSummary || []).reduce(
    (sum: any, item: any) => sum + parsePriceLabel(item.priceLabel),
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

export function formatPaymentAmount(amount: any, currency = "INR") {
  return `${currency} ${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
