import crypto from "node:crypto";

import { PAYMENT_PROVIDERS } from "./constants.js";
import {
  markQuotationPaymentFailed,
  markQuotationPaymentPaid,
  markQuotationPaymentRefunded,
  resolveQuotationIdFromStripeMetadata,
  resolveQuotationIdFromStripePaymentLink,
} from "./fulfillment.js";
import { tryClaimWebhookEvent, updateWebhookEventPayload } from "./webhookEvents.js";

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

function timingSafeEqualHex(a, b) {
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

export function verifyStripeWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((segment) => {
      const [key, ...rest] = segment.split("=");
      return [key, rest.join("=")];
    }),
  );

  const timestamp = parts.t;
  const signatures = signatureHeader
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.startsWith("v1="))
    .map((segment) => segment.slice(3));

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

  return signatures.some((signature) => timingSafeEqualHex(signature, expected));
}

async function handleCheckoutSessionCompleted(session, event) {
  const quotationId =
    (await resolveQuotationIdFromStripeMetadata(session.metadata || {})) ||
    (await resolveQuotationIdFromStripePaymentLink(session.payment_link));

  if (!quotationId) {
    console.warn("[stripe webhook] checkout.session.completed without quotation_id metadata");
    return { handled: false, reason: "missing_quotation_id" };
  }

  if (session.payment_status && session.payment_status !== "paid") {
    return { handled: false, reason: `payment_status_${session.payment_status}` };
  }

  const result = await markQuotationPaymentPaid({
    quotationId,
    providerPaymentId: session.payment_intent || session.id,
    providerCustomerId: session.customer || null,
    providerEventId: event.id,
    source: PAYMENT_PROVIDERS.STRIPE,
    deferNotifications: false,
  });

  return { handled: true, quotationId, ...result };
}

async function handlePaymentIntentSucceeded(paymentIntent, event) {
  const quotationId = await resolveQuotationIdFromStripeMetadata(paymentIntent.metadata || {});

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const result = await markQuotationPaymentPaid({
    quotationId,
    providerPaymentId: paymentIntent.id,
    providerCustomerId: paymentIntent.customer || null,
    providerEventId: event.id,
    source: PAYMENT_PROVIDERS.STRIPE,
    deferNotifications: false,
  });

  return { handled: true, quotationId, ...result };
}

async function handlePaymentIntentFailed(paymentIntent, event) {
  const quotationId = await resolveQuotationIdFromStripeMetadata(paymentIntent.metadata || {});

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const payment = await markQuotationPaymentFailed({
    quotationId,
    failureReason: paymentIntent.last_payment_error?.message || "Payment failed",
    providerEventId: event.id,
  });

  return { handled: Boolean(payment), quotationId };
}

async function handleChargeRefunded(charge, event) {
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

export async function executeStripeWebhookEvent(event) {
  if (!event?.id || !event?.type) {
    throw new Error("Invalid Stripe event payload.");
  }

  let result = { handled: false, reason: "unsupported_event" };

  switch (event.type) {
    case "checkout.session.completed":
      result = await handleCheckoutSessionCompleted(event.data.object, event);
      break;
    case "checkout.session.async_payment_succeeded":
      result = await handleCheckoutSessionCompleted(event.data.object, event);
      break;
    case "payment_intent.succeeded":
      result = await handlePaymentIntentSucceeded(event.data.object, event);
      break;
    case "payment_intent.payment_failed":
      result = await handlePaymentIntentFailed(event.data.object, event);
      break;
    case "charge.refunded":
      result = await handleChargeRefunded(event.data.object, event);
      break;
    default:
      result = { handled: false, reason: "ignored", eventType: event.type };
  }

  await updateWebhookEventPayload({
    provider: PAYMENT_PROVIDERS.STRIPE,
    eventId: event.id,
    quotationId: result.quotationId || null,
    payload: { handled: result.handled, reason: result.reason },
  });

  return result;
}

export async function processStripeWebhookEvent(event) {
  const claimed = await tryClaimWebhookEvent({
    provider: PAYMENT_PROVIDERS.STRIPE,
    eventId: event.id,
    eventType: event.type,
  });

  if (!claimed) {
    return { duplicate: true, eventId: event.id };
  }

  return executeStripeWebhookEvent(event);
}

export async function handleStripeWebhookRequest(rawBody, signatureHeader) {
  const secret = env("STRIPE_WEBHOOK_SECRET");

  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }

  if (!verifyStripeWebhookSignature(rawBody, signatureHeader, secret)) {
    throw new Error("Invalid Stripe webhook signature.");
  }

  const event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
  return processStripeWebhookEvent(event);
}
