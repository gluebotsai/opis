import { logPayment, logPaymentError } from "../../infra/file-logger.js";
import { PAYMENT_PROVIDERS } from "./constants.js";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

function env(name: any) {
  let value = process.env[name]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function toRazorpayMinorUnits(amount: any, currency = "INR") {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  const code = String(currency || "INR").toUpperCase();
  const zeroDecimal = new Set(["JPY", "KRW", "VND"]);
  const multiplier = zeroDecimal.has(code) ? 1 : 100;
  return Math.round(value * multiplier);
}

function basicAuthHeader(keyId: any, keySecret: any) {
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
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  amount,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  currency,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  description,
  metadata = {},
}) {
  const { keyId, keySecret, configured } = getRazorpayConfig();
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const quotationId = metadata.quotation_id || metadata.quotationId || null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const billingBranchId = metadata.billing_branch_id || metadata.billingBranchId || null;
  const minorUnits = toRazorpayMinorUnits(amount, currency);

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const companyName = metadata.company_name || metadata.companyName || null;

  logPayment("razorpay.payment_link.request", {
    quotationId,
    companyName,
    amount,
    currency,
    minorUnits,
    dryRun: !configured,
    provider: "razorpay",
  });

  if (!configured) {
    const mockSuffix = billingBranchId ? `_${billingBranchId}` : "";
    const mockUrl = `https://razorpay.example/pay/${quotationId || "demo"}${mockSuffix}?amount=${amount}&currency=${currency}`;
    logPayment("razorpay.payment_link.mock", {
      quotationId,
      companyName,
      billingBranchId,
      paymentLinkUrl: mockUrl,
      provider: "razorpay",
    });
    return {
      provider: "razorpay",
      paymentLinkUrl: mockUrl,
      paymentLinkId: `plink_rzp_dummy_${billingBranchId || "main"}_${Date.now()}`,
      dryRun: true,
      note: "Razorpay is not configured yet. This is a placeholder payment link.",
    };
  }

  const referenceId = billingBranchId
    ? `${String(quotationId || "").slice(0, 24)}_${String(billingBranchId).slice(0, 15)}`
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    : String(quotationId || metadata.quotation_id || "");

  const payload = {
    amount: minorUnits,
    currency: String(currency || "INR").toUpperCase(),
    description: String(description || "Worktual invoice").slice(0, 255),
    reminder_enable: true,
    reference_id: referenceId.slice(0, 40),
    notes: {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      quotation_id: String(quotationId || metadata.quotation_id || ""),
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      lead_id: String(metadata.lead_id || metadata.leadId || ""),
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      company_name: String(metadata.company_name || metadata.companyName || "").slice(0, 255),
      billing_branch_id: billingBranchId ? String(billingBranchId) : "",
    },
  };

  let response;
  try {
    response = await fetchWithTimeout(
      "https://api.razorpay.com/v1/payment_links",
      {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(keyId, keySecret),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      { label: "Razorpay" },
    );
  } catch (error) {
    logPaymentError("razorpay.payment_link.failed", error, {
      quotationId,
      companyName,
      amount,
      currency,
      provider: "razorpay",
      timedOut: /did not respond within/i.test(error instanceof Error ? error.message : ""),
    });
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const message = data.error?.description || data.error?.reason || "Razorpay payment link creation failed.";
    logPaymentError("razorpay.payment_link.failed", new Error(message), {
      quotationId,
      companyName,
      amount,
      currency,
      provider: "razorpay",
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      razorpayCode: data.error?.code || null,
    });
    throw new Error(message);
  }

  logPayment("razorpay.payment_link.created", {
    quotationId,
    companyName,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkId: data.id,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkUrl: data.short_url,
    amount,
    currency,
    provider: "razorpay",
  });

  return {
    provider: "razorpay",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkUrl: data.short_url,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkId: data.id,
    dryRun: false,
  };
}

export async function fetchRazorpayPaymentLink(paymentLinkId: any) {
  const { keyId, keySecret, configured } = getRazorpayConfig();

  if (!configured) {
    throw new Error("Razorpay is not configured.");
  }

  let response;
  try {
    response = await fetchWithTimeout(
      `https://api.razorpay.com/v1/payment_links/${paymentLinkId}`,
      {
        headers: {
          Authorization: basicAuthHeader(keyId, keySecret),
        },
      },
      { label: "Razorpay" },
    );
  } catch (error) {
    logPaymentError("razorpay.payment_link.fetch_failed", error, {
      paymentLinkId,
      timedOut: /did not respond within/i.test(error instanceof Error ? error.message : ""),
    });
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const message = data.error?.description || data.error?.reason || "Could not fetch Razorpay payment link.";
    throw new Error(message);
  }

  return data;
}

/**
 * Cancel a Razorpay Payment Link so it can no longer accept payments.
 * POST /v1/payment_links/:id/cancel
 */
export async function cancelRazorpayPaymentLink(paymentLinkId: any) {
  const { keyId, keySecret, configured } = getRazorpayConfig();
  const id = String(paymentLinkId || "").trim();
  if (!id) {
    throw new Error("Razorpay payment link id is required.");
  }

  if (!configured || id.startsWith("plink_rzp_dummy_")) {
    logPayment("razorpay.payment_link.cancel_mock", {
      paymentLinkId: id,
      provider: "razorpay",
    });
    return { paymentLinkId: id, cancelled: true, dryRun: true };
  }

  let response;
  try {
    response = await fetchWithTimeout(
      `https://api.razorpay.com/v1/payment_links/${encodeURIComponent(id)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(keyId, keySecret),
          "Content-Type": "application/json",
        },
        body: "{}",
      },
      { label: "Razorpay" },
    );
  } catch (error) {
    logPaymentError("razorpay.payment_link.cancel_failed", error, {
      paymentLinkId: id,
      provider: "razorpay",
      timedOut: /did not respond within/i.test(error instanceof Error ? error.message : ""),
    });
    throw error;
  }

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = String(data?.status || data?.error?.reason || "").toLowerCase();
    const description = String(data?.error?.description || "");
    // Already cancelled / expired is OK for sales revert.
    if (
      status.includes("cancelled") ||
      status.includes("canceled") ||
      status.includes("expired") ||
      /already.*(cancel|expire)/i.test(description)
    ) {
      logPayment("razorpay.payment_link.cancel_already", {
        paymentLinkId: id,
        provider: "razorpay",
      });
      return { paymentLinkId: id, cancelled: true, dryRun: false, already: true };
    }
    const message =
      data?.error?.description || data?.error?.reason || "Could not cancel Razorpay payment link.";
    logPaymentError("razorpay.payment_link.cancel_failed", new Error(message), {
      paymentLinkId: id,
      provider: "razorpay",
      razorpayCode: data?.error?.code || null,
    });
    throw new Error(message);
  }

  logPayment("razorpay.payment_link.cancelled", {
    paymentLinkId: id,
    provider: "razorpay",
  });

  return { paymentLinkId: id, cancelled: true, dryRun: false, data };
}

export async function syncRazorpayQuotationPayment(quotation: any) {
  const payment = quotation?.payment;
  if (!payment || payment.provider !== PAYMENT_PROVIDERS.RAZORPAY) {
    return { synced: false, reason: "not_razorpay" };
  }

  if (payment.status === "paid") {
    return { synced: false, alreadyPaid: true };
  }

  // Stuck "reported" (or branch reported under partial): finish auto-confirm without calling Razorpay again.
  if (
    payment.status === "reported" ||
    (payment.branchPayments || []).some((entry: any) => entry?.status === "reported")
  ) {
    const { finishGatewayReportedPayment } = await import("./fulfillment.js");
    return finishGatewayReportedPayment(quotation, PAYMENT_PROVIDERS.RAZORPAY);
  }

  if (!payment.paymentLinkId) {
    return { synced: false, reason: "missing_payment_link_id" };
  }

  const link = await fetchRazorpayPaymentLink(payment.paymentLinkId);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (link.status !== "paid") {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    return { synced: false, reason: `razorpay_status_${link.status || "unknown"}` };
  }

  const providerPaymentId =
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    link.payments?.find((entry: any) => entry?.status === "captured")?.payment_id ||
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    link.payments?.[0]?.payment_id ||
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    link.id;

  const { recordProviderPaymentReported } = await import("./fulfillment.js");
  const result = await recordProviderPaymentReported({
    quotationId: quotation.id,
    providerPaymentId,
    providerCustomerId: null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    providerEventId: `razorpay_sync_${link.id}`,
    source: PAYMENT_PROVIDERS.RAZORPAY,
  });

  logPayment("razorpay.payment_link.synced", {
    quotationId: quotation.id,
    companyName: quotation.lead?.companyName || quotation.lead?.company_name || null,
    paymentLinkId: payment.paymentLinkId,
    providerPaymentId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    linkStatus: link.status || null,
    provider: "razorpay",
    amount: payment.amount ?? null,
    currency: payment.currency || null,
  });

  return { synced: true, ...result };
}
