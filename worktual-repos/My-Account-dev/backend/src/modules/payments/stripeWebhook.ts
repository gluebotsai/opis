import crypto from "node:crypto";

import { logPayment, logPaymentError } from "../../infra/file-logger.js";
import { PAYMENT_PROVIDERS } from "./constants.js";
import {
  markQuotationPaymentFailed,
  markQuotationPaymentRefunded,
  recordProviderPaymentReported,
  resolvePaymentLinkContext,
  resolveQuotationIdFromStripeMetadata,
  resolveQuotationIdFromStripePaymentLink,
} from "./fulfillment.js";
import { companyNameFromQuotation, paymentLogDetails } from "./logContext.js";
import { tryClaimWebhookEvent, updateWebhookEventPayload } from "./webhookEvents.js";

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

function timingSafeEqualHex(a: any, b: any) {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function verifyStripeWebhookSignature(rawBody: any, signatureHeader: any, secret: any) {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((segment: any) => {
      const [key, ...rest] = segment.split("=");
      return [key, rest.join("=")];
    }),
  );

  const timestamp = parts.t;
  const signatures = signatureHeader
    .split(",")
    .map((segment: any) => segment.trim())
    .filter((segment: any) => segment.startsWith("v1="))
    .map((segment: any) => segment.slice(3));

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (ageSeconds > 300) {
    return false;
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  return signatures.some((signature: any) => timingSafeEqualHex(signature, expected));
}

function stripePaymentLinkId(value: any) {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? value : value.id || null;
}

async function resolveStripeCheckoutTarget(session: any) {
  const metadata = session?.metadata || {};
  const paymentLinkId = stripePaymentLinkId(session?.payment_link);
  let quotationId = await resolveQuotationIdFromStripeMetadata(metadata);
  let billingBranchId = metadata.billing_branch_id || metadata.billingBranchId || null;

  if (paymentLinkId) {
    const context = await resolvePaymentLinkContext(paymentLinkId);
    if (context?.quotationId) {
      quotationId = quotationId || context.quotationId;
      billingBranchId = billingBranchId || context.billingBranchId || null;
    } else if (!quotationId) {
      quotationId = await resolveQuotationIdFromStripePaymentLink(paymentLinkId);
    }
  }

  return { quotationId, billingBranchId, paymentLinkId };
}

async function handleCheckoutSessionCompleted(session: any, event: any) {
  const { quotationId, billingBranchId, paymentLinkId } = await resolveStripeCheckoutTarget(session);

  if (!quotationId) {
    logPaymentError(
      "stripe.webhook.missing_quotation",
      new Error("Could not resolve quotation from Stripe checkout session."),
      paymentLogDetails({
        provider: PAYMENT_PROVIDERS.STRIPE,
        eventId: event?.id || null,
        eventType: event?.type || null,
        checkoutSessionId: session?.id || null,
        providerLinkId: paymentLinkId || null,
        paymentStatus: session?.payment_status || null,
        metadataKeys: Object.keys(session?.metadata || {}),
      }),
    );
    return { handled: false, reason: "missing_quotation_id" };
  }

  if (session.payment_status && session.payment_status !== "paid") {
    return { handled: false, reason: `payment_status_${session.payment_status}` };
  }

  const result = await recordProviderPaymentReported({
    quotationId,
    billingBranchId,
    providerPaymentId: session.payment_intent || session.id,
    providerCustomerId: session.customer || null,
    providerEventId: event.id,
    source: PAYMENT_PROVIDERS.STRIPE,
  });

  return { handled: true, quotationId, billingBranchId, ...result };
}

async function resolveStripePaymentIntentTarget(paymentIntent: any) {
  const metadata = paymentIntent?.metadata || {};
  let quotationId = await resolveQuotationIdFromStripeMetadata(metadata);
  let billingBranchId = metadata.billing_branch_id || metadata.billingBranchId || null;

  const paymentLinkId =
    stripePaymentLinkId(paymentIntent?.payment_link) ||
    stripePaymentLinkId(metadata.payment_link) ||
    null;

  if (paymentLinkId && (!quotationId || !billingBranchId)) {
    const context = await resolvePaymentLinkContext(paymentLinkId);
    if (context?.quotationId) {
      quotationId = quotationId || context.quotationId;
      billingBranchId = billingBranchId || context.billingBranchId || null;
    } else if (!quotationId) {
      quotationId = await resolveQuotationIdFromStripePaymentLink(paymentLinkId);
    }
  }

  return { quotationId, billingBranchId, paymentLinkId };
}

async function handlePaymentIntentSucceeded(paymentIntent: any, event: any) {
  const { quotationId, billingBranchId } = await resolveStripePaymentIntentTarget(paymentIntent);

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const result = await recordProviderPaymentReported({
    quotationId,
    billingBranchId,
    providerPaymentId: paymentIntent.id,
    providerCustomerId: paymentIntent.customer || null,
    providerEventId: event.id,
    source: PAYMENT_PROVIDERS.STRIPE,
  });

  return { handled: true, quotationId, billingBranchId, ...result };
}

function stripeFailureReason(paymentIntent: any, fallback = "Payment failed") {
  const error = paymentIntent?.last_payment_error;
  if (!error) {
    return fallback;
  }

  const parts = [];
  if (error.code) {
    parts.push(error.code);
  }
  if (error.message) {
    parts.push(error.message);
  }
  return parts.length ? parts.join(": ") : fallback;
}

async function handlePaymentIntentFailed(paymentIntent: any, event: any) {
  const { quotationId, billingBranchId } = await resolveStripePaymentIntentTarget(paymentIntent);

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const failureReason = stripeFailureReason(paymentIntent, "Payment declined");
  const payment = await markQuotationPaymentFailed({
    quotationId,
    billingBranchId,
    failureReason,
    providerEventId: event.id,
    providerPaymentId: paymentIntent.id || null,
  });

  return {
    handled: Boolean(payment),
    quotationId,
    billingBranchId,
    payment,
    paymentStatus: payment?.status || "failed",
    failureReason,
  };
}

async function handlePaymentIntentCanceled(paymentIntent: any, event: any) {
  const { quotationId, billingBranchId } = await resolveStripePaymentIntentTarget(paymentIntent);

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const failureReason =
    paymentIntent?.cancellation_reason
      ? `Payment canceled (${paymentIntent.cancellation_reason})`
      : "Payment canceled";
  const payment = await markQuotationPaymentFailed({
    quotationId,
    billingBranchId,
    failureReason,
    providerEventId: event.id,
    providerPaymentId: paymentIntent.id || null,
  });

  return {
    handled: Boolean(payment),
    quotationId,
    billingBranchId,
    payment,
    paymentStatus: payment?.status || "failed",
    failureReason,
  };
}

async function handleCheckoutSessionAbandoned(session: any, event: any, failureReason: any) {
  const { quotationId, billingBranchId, paymentLinkId } = await resolveStripeCheckoutTarget(session);

  if (!quotationId) {
    logPaymentError(
      "stripe.webhook.missing_quotation",
      new Error("Could not resolve quotation from Stripe checkout session."),
      paymentLogDetails({
        provider: PAYMENT_PROVIDERS.STRIPE,
        eventId: event?.id || null,
        eventType: event?.type || null,
        checkoutSessionId: session?.id || null,
        providerLinkId: paymentLinkId || null,
        paymentStatus: session?.payment_status || null,
        metadataKeys: Object.keys(session?.metadata || {}),
      }),
    );
    return { handled: false, reason: "missing_quotation_id" };
  }

  const payment = await markQuotationPaymentFailed({
    quotationId,
    billingBranchId,
    failureReason,
    providerEventId: event.id,
    providerPaymentId:
      (typeof session?.payment_intent === "string"
        ? session.payment_intent
        : session?.payment_intent?.id) ||
      session?.id ||
      null,
  });

  return {
    handled: Boolean(payment),
    quotationId,
    billingBranchId,
    payment,
    paymentStatus: payment?.status || "failed",
    failureReason,
  };
}

async function handleChargeRefunded(charge: any, event: any) {
  const quotationId = await resolveQuotationIdFromStripeMetadata(charge.metadata || {});

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const payment = await markQuotationPaymentRefunded({
    quotationId,
    providerEventId: event.id,
    failureReason: "Stripe charge refunded",
  });

  return { handled: Boolean(payment), quotationId };
}

export async function executeStripeWebhookEvent(event: any) {
  if (!event?.id || !event?.type) {
    throw new Error("Invalid Stripe event payload.");
  }

  let result = { handled: false, reason: "unsupported_event" };

  // Dashboard must also subscribe to async_payment_failed, session.expired, and PI canceled.
  switch (event.type) {
    case "checkout.session.completed":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handleCheckoutSessionCompleted(event.data.object, event);
      break;
    case "checkout.session.async_payment_succeeded":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handleCheckoutSessionCompleted(event.data.object, event);
      break;
    case "checkout.session.async_payment_failed":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handleCheckoutSessionAbandoned(
        event.data.object,
        event,
        "Checkout async payment failed",
      );
      break;
    case "checkout.session.expired":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handleCheckoutSessionAbandoned(
        event.data.object,
        event,
        "Checkout session expired",
      );
      break;
    case "payment_intent.succeeded":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentIntentSucceeded(event.data.object, event);
      break;
    case "payment_intent.payment_failed":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentIntentFailed(event.data.object, event);
      break;
    case "payment_intent.canceled":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentIntentCanceled(event.data.object, event);
      break;
    case "charge.refunded":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handleChargeRefunded(event.data.object, event);
      break;
    default:
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = { handled: false, reason: "ignored", eventType: event.type };
  }

  await updateWebhookEventPayload({
    provider: PAYMENT_PROVIDERS.STRIPE,
    eventId: event.id,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    quotationId: result.quotationId || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    payload: { handled: result.handled, reason: result.reason },
  });

  logPayment(
    "stripe.webhook.processed",
    paymentLogDetails({
      provider: PAYMENT_PROVIDERS.STRIPE,
      eventId: event.id,
      eventType: event.type,
      handled: result.handled,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      quotationId: result.quotationId || null,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      companyName: companyNameFromQuotation(result.quotation),
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      billingBranchId: result.billingBranchId || null,
      reason: result.reason || null,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      alreadyPaid: result.alreadyPaid,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      alreadyReported: result.alreadyReported,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      autoConfirmed: result.autoConfirmed,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      paymentStatus: result.payment?.status || null,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      amount: result.payment?.amount ?? result.payment?.grandTotal ?? null,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      currency: result.payment?.currency || null,
    }),
  );

  return result;
}

export async function processStripeWebhookEvent(event: any) {
  const claimed = await tryClaimWebhookEvent({
    provider: PAYMENT_PROVIDERS.STRIPE,
    eventId: event.id,
    eventType: event.type,
  });

  // Always execute: gateway fulfillment is idempotent. If a prior attempt claimed the
  // event then failed mid-confirm, Stripe retries must still finish mark-paid.
  const result = await executeStripeWebhookEvent(event);

  logPayment(
    claimed ? "stripe.webhook.claimed" : "stripe.webhook.duplicate",
    paymentLogDetails({
      provider: PAYMENT_PROVIDERS.STRIPE,
      eventId: event.id,
      eventType: event.type,
      duplicate: !claimed,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      quotationId: result.quotationId || null,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      companyName: companyNameFromQuotation(result.quotation),
    }),
  );

  if (!claimed) {
    return { ...result, duplicate: true };
  }
  return result;
}

export async function handleStripeWebhookRequest(rawBody: any, signatureHeader: any) {
  const secret = env("STRIPE_WEBHOOK_SECRET");

  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not configured. Set the Stripe Dashboard webhook signing secret (whsec_...) and restart the server so checkouts auto-confirm via webhook.",
    );
  }

  if (!verifyStripeWebhookSignature(rawBody, signatureHeader, secret)) {
    throw new Error("Invalid Stripe webhook signature.");
  }

  const event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
  logPayment(
    "stripe.webhook.received",
    paymentLogDetails({
      provider: PAYMENT_PROVIDERS.STRIPE,
      eventId: event.id,
      eventType: event.type,
    }),
  );

  const result = await processStripeWebhookEvent(event);

  if (result?.handled === false && result?.reason && result.reason !== "ignored") {
    logPayment(
      "stripe.webhook.not_applied",
      paymentLogDetails({
        provider: PAYMENT_PROVIDERS.STRIPE,
        eventId: event.id,
        eventType: event.type,
        reason: result.reason,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        quotationId: result.quotationId || null,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        duplicate: result.duplicate,
        level: "error",
      }),
    );
  }

  return result;
}
