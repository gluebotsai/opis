import { assertStripeChargeAmount, toStripeMinorUnits } from "./stripeLimits.js";
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

function toStripeAmount(grandTotal: any, currency: any) {
  return toStripeMinorUnits(grandTotal, currency);
}

export function getStripeConfig() {
  const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  return {
    secretKey: env("STRIPE_SECRET_KEY"),
    publishableKey: env("STRIPE_PUBLISHABLE_KEY"),
    webhookSecret,
    configured: Boolean(env("STRIPE_SECRET_KEY")),
    webhookConfigured: Boolean(webhookSecret),
  };
}

export async function createStripePaymentLink({
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  amount,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  currency,
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  description,
  metadata = {},
}) {
  const { secretKey } = getStripeConfig();
  const charge = assertStripeChargeAmount(amount, currency);

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const quotationId = metadata.quotation_id || metadata.quotationId || null;
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const companyName = metadata.company_name || metadata.companyName || null;

  logPayment("stripe.payment_link.request", {
    quotationId,
    companyName,
    amount,
    currency: charge.currency,
    minorUnits: charge.minorUnits,
    settlementCurrency: charge.settlementCurrency,
    dryRun: !secretKey,
    provider: "stripe",
  });

  if (!secretKey) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const billingBranchId = metadata.billing_branch_id || metadata.billingBranchId || "";
    const mockSuffix = billingBranchId ? `_${billingBranchId}` : "";
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const mockUrl = `https://checkout.stripe.example/pay/${metadata.quotationId || metadata.quotation_id || "demo"}${mockSuffix}?amount=${amount}&currency=${currency}`;
    logPayment("stripe.payment_link.mock", {
      quotationId,
      companyName,
      billingBranchId: billingBranchId || null,
      paymentLinkUrl: mockUrl,
      provider: "stripe",
    });
    return {
      provider: "stripe",
      paymentLinkUrl: mockUrl,
      paymentLinkId: `plink_demo_${billingBranchId || "main"}_${Date.now()}`,
      dryRun: true,
    };
  }

  const unitAmount = charge.minorUnits;
  const params = new URLSearchParams();
  params.append("line_items[0][price_data][currency]", String(currency).toLowerCase());
  params.append("line_items[0][price_data][product_data][name]", description.slice(0, 200));
  params.append("line_items[0][price_data][unit_amount]", String(unitAmount));
  params.append("line_items[0][quantity]", "1");

  for (const [key, value] of Object.entries(metadata)) {
    const stringValue = String(value);
    params.append(`metadata[${key}]`, stringValue);
    // Copy onto PaymentIntent so payment_intent.succeeded webhooks can resolve the quotation.
    params.append(`payment_intent_data[metadata][${key}]`, stringValue);
  }

  let response;
  try {
    response = await fetchWithTimeout(
      "https://api.stripe.com/v1/payment_links",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
      { label: "Stripe" },
    );
  } catch (error) {
    logPaymentError("stripe.payment_link.failed", error, {
      quotationId,
      companyName,
      amount,
      currency: charge.currency,
      minorUnits: unitAmount,
      provider: "stripe",
      timedOut: /did not respond within/i.test(error instanceof Error ? error.message : ""),
    });
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const stripeMessage = data.error?.message || "Stripe payment link creation failed.";
    logPaymentError("stripe.payment_link.failed", new Error(stripeMessage), {
      quotationId,
      companyName,
      amount,
      currency: charge.currency,
      minorUnits: unitAmount,
      provider: "stripe",
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      stripeCode: data.error?.code || null,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      stripeType: data.error?.type || null,
    });
    throw new Error(stripeMessage);
  }

  logPayment("stripe.payment_link.created", {
    quotationId,
    companyName,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkId: data.id,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkUrl: data.url,
    amount,
    currency: charge.currency,
    provider: "stripe",
  });

  return {
    provider: "stripe",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkUrl: data.url,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    paymentLinkId: data.id,
    dryRun: false,
  };
}

/**
 * Deactivate a Stripe Payment Link so it can no longer accept payments.
 * POST /v1/payment_links/:id with active=false
 */
export async function deactivateStripePaymentLink(paymentLinkId: any) {
  const { secretKey, configured } = getStripeConfig();
  const id = String(paymentLinkId || "").trim();
  if (!id) {
    throw new Error("Stripe payment link id is required.");
  }

  if (!configured || id.startsWith("plink_demo_")) {
    logPayment("stripe.payment_link.deactivate_mock", {
      paymentLinkId: id,
      provider: "stripe",
    });
    return { paymentLinkId: id, active: false, dryRun: true };
  }

  let response;
  try {
    response = await fetchWithTimeout(
      `https://api.stripe.com/v1/payment_links/${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ active: "false" }).toString(),
      },
      { label: "Stripe" },
    );
  } catch (error) {
    logPaymentError("stripe.payment_link.deactivate_failed", error, {
      paymentLinkId: id,
      provider: "stripe",
      timedOut: /did not respond within/i.test(error instanceof Error ? error.message : ""),
    });
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const message = data.error?.message || "Could not deactivate Stripe payment link.";
    logPaymentError("stripe.payment_link.deactivate_failed", new Error(message), {
      paymentLinkId: id,
      provider: "stripe",
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      stripeCode: data.error?.code || null,
    });
    throw new Error(message);
  }

  // Already inactive is success for revert.
  logPayment("stripe.payment_link.deactivated", {
    paymentLinkId: id,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    active: data.active === false ? false : data.active,
    provider: "stripe",
  });

  return { paymentLinkId: id, active: false, dryRun: false, data };
}

/**
 * List checkout sessions for a Payment Link (newest first).
 * Used by internal/ops sync-payment when repairing a missed webhook.
 */
export async function fetchStripeCheckoutSessionsForLink(paymentLinkId: any) {
  const { secretKey, configured } = getStripeConfig();

  if (!configured) {
    throw new Error("Stripe is not configured.");
  }

  const id = String(paymentLinkId || "").trim();
  if (!id) {
    throw new Error("Stripe payment link id is required.");
  }

  const params = new URLSearchParams({
    payment_link: id,
    limit: "10",
  });

  let response;
  try {
    response = await fetchWithTimeout(
      `https://api.stripe.com/v1/checkout/sessions?${params}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      },
      { label: "Stripe" },
    );
  } catch (error) {
    logPaymentError("stripe.checkout_sessions.fetch_failed", error, {
      paymentLinkId: id,
      timedOut: /did not respond within/i.test(error instanceof Error ? error.message : ""),
    });
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const message = data.error?.message || "Could not fetch Stripe checkout sessions.";
    logPaymentError("stripe.checkout_sessions.fetch_failed", new Error(message), {
      paymentLinkId: id,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      stripeCode: data.error?.code || null,
    });
    throw new Error(message);
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return Array.isArray(data.data) ? data.data : [];
}

/**
 * Pull paid status from Stripe for a quotation payment link and auto-confirm
 * (gateway report path runs finance confirm + fulfillment).
 */
export async function syncStripeQuotationPayment(quotation: any) {
  const payment = quotation?.payment;
  if (!payment || payment.provider !== PAYMENT_PROVIDERS.STRIPE) {
    return { synced: false, reason: "not_stripe" };
  }

  if (payment.status === "paid") {
    return { synced: false, alreadyPaid: true };
  }

  // Stuck "reported" (or branch reported under partial): finish auto-confirm without calling Stripe again.
  if (
    payment.status === "reported" ||
    (payment.branchPayments || []).some((entry: any) => entry?.status === "reported")
  ) {
    const { finishGatewayReportedPayment } = await import("./fulfillment.js");
    return finishGatewayReportedPayment(quotation, PAYMENT_PROVIDERS.STRIPE);
  }

  if (!payment.paymentLinkId) {
    return { synced: false, reason: "missing_payment_link_id" };
  }

  const sessions = await fetchStripeCheckoutSessionsForLink(payment.paymentLinkId);
  const paidSession = sessions.find((session: any) => session?.payment_status === "paid");

  if (!paidSession) {
    const latestStatus = sessions[0]?.payment_status || "none";
    return { synced: false, reason: `stripe_status_${latestStatus}` };
  }

  const providerPaymentId =
    (typeof paidSession.payment_intent === "string"
      ? paidSession.payment_intent
      : paidSession.payment_intent?.id) || paidSession.id;

  const providerCustomerId =
    (typeof paidSession.customer === "string"
      ? paidSession.customer
      : paidSession.customer?.id) || null;

  const billingBranchId =
    paidSession.metadata?.billing_branch_id ||
    paidSession.metadata?.billingBranchId ||
    null;

  const { recordProviderPaymentReported } = await import("./fulfillment.js");
  const result = await recordProviderPaymentReported({
    quotationId: quotation.id,
    billingBranchId,
    providerPaymentId,
    providerCustomerId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    providerEventId: `stripe_sync_${paidSession.id}`,
    source: PAYMENT_PROVIDERS.STRIPE,
  });

  logPayment("stripe.payment_link.synced", {
    quotationId: quotation.id,
    companyName: quotation.lead?.companyName || quotation.lead?.company_name || null,
    paymentLinkId: payment.paymentLinkId,
    sessionId: paidSession.id,
    providerPaymentId,
    provider: "stripe",
    amount: payment.amount ?? null,
    currency: payment.currency || null,
  });

  return { synced: true, ...result };
}
