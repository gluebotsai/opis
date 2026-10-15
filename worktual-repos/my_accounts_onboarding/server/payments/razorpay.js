import { logPayment, logPaymentError } from "../logger.js";
import { PAYMENT_PROVIDERS } from "./constants.js";

function env(name) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function toRazorpayMinorUnits(amount, currency = "INR") {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  const code = String(currency || "INR").toUpperCase();
  const zeroDecimal = new Set(["JPY", "KRW", "VND"]);
  const multiplier = zeroDecimal.has(code) ? 1 : 100;
  return Math.round(value * multiplier);
}

function basicAuthHeader(keyId, keySecret) {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

export function getRazorpayConfig() {
  const keyId = env("RAZORPAY_KEY_ID") || "";
  const keySecret = env("RAZORPAY_KEY_SECRET") || "";
  const webhookSecret = env("RAZORPAY_WEBHOOK_SECRET") || "";

  return {
    keyId,
    keySecret,
    webhookSecret,
    configured: Boolean(keyId && keySecret && keyId !== "rzp_dummy_key" && keySecret !== "rzp_dummy_secret"),
    webhookConfigured: Boolean(webhookSecret),
  };
}

export async function createRazorpayPaymentLink({
  amount,
  currency,
  description,
  metadata = {},
}) {
  const { keyId, keySecret, configured } = getRazorpayConfig();
  const quotationId = metadata.quotation_id || metadata.quotationId || null;
  const minorUnits = toRazorpayMinorUnits(amount, currency);

  logPayment("razorpay.payment_link.request", {
    quotationId,
    amount,
    currency,
    minorUnits,
    dryRun: !configured,
  });

  if (!configured) {
    const mockUrl = `https://razorpay.example/pay/${quotationId || "demo"}?amount=${amount}&currency=${currency}`;
    return {
      provider: "razorpay",
      paymentLinkUrl: mockUrl,
      paymentLinkId: `plink_rzp_dummy_${Date.now()}`,
      dryRun: true,
      note: "Razorpay is not configured yet. This is a placeholder payment link.",
    };
  }

  const payload = {
    amount: minorUnits,
    currency: String(currency || "INR").toUpperCase(),
    description: String(description || "Worktual invoice").slice(0, 255),
    reminder_enable: true,
    reference_id: String(quotationId || metadata.quotation_id || "").slice(0, 40),
    notes: {
      quotation_id: String(quotationId || metadata.quotation_id || ""),
      lead_id: String(metadata.lead_id || metadata.leadId || ""),
      company_name: String(metadata.company_name || metadata.companyName || "").slice(0, 255),
    },
  };

  const response = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(keyId, keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.description || data.error?.reason || "Razorpay payment link creation failed.";
    logPaymentError("razorpay.payment_link.failed", new Error(message), {
      quotationId,
      amount,
      currency,
      razorpayCode: data.error?.code || null,
    });
    throw new Error(message);
  }

  logPayment("razorpay.payment_link.created", {
    quotationId,
    paymentLinkId: data.id,
    paymentLinkUrl: data.short_url,
    amount,
    currency,
  });

  return {
    provider: "razorpay",
    paymentLinkUrl: data.short_url,
    paymentLinkId: data.id,
    dryRun: false,
  };
}

export async function fetchRazorpayPaymentLink(paymentLinkId) {
  const { keyId, keySecret, configured } = getRazorpayConfig();

  if (!configured) {
    throw new Error("Razorpay is not configured.");
  }

  const response = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
    headers: {
      Authorization: basicAuthHeader(keyId, keySecret),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.description || data.error?.reason || "Could not fetch Razorpay payment link.";
    throw new Error(message);
  }

  return data;
}

export async function syncRazorpayQuotationPayment(quotation) {
  const payment = quotation?.payment;
  if (!payment || payment.provider !== PAYMENT_PROVIDERS.RAZORPAY) {
    return { synced: false, reason: "not_razorpay" };
  }

  if (payment.status === "paid") {
    return { synced: false, alreadyPaid: true };
  }

  if (!payment.paymentLinkId) {
    return { synced: false, reason: "missing_payment_link_id" };
  }

  const link = await fetchRazorpayPaymentLink(payment.paymentLinkId);
  if (link.status !== "paid") {
    return { synced: false, reason: `razorpay_status_${link.status || "unknown"}` };
  }

  const providerPaymentId =
    link.payments?.find((entry) => entry?.status === "captured")?.payment_id ||
    link.payments?.[0]?.payment_id ||
    link.id;

  const { markQuotationPaymentPaid } = await import("./fulfillment.js");
  const result = await markQuotationPaymentPaid({
    quotationId: quotation.id,
    providerPaymentId,
    providerCustomerId: null,
    providerEventId: `razorpay_sync_${link.id}`,
    source: PAYMENT_PROVIDERS.RAZORPAY,
    deferNotifications: false,
  });

  return { synced: true, ...result };
}
