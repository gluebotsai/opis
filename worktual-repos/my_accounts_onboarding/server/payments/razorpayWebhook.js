import crypto from "node:crypto";

import { PAYMENT_PROVIDERS } from "./constants.js";
import {
  markQuotationPaymentFailed,
  markQuotationPaymentPaid,
  resolveQuotationIdFromStripeMetadata,
  resolveQuotationIdFromStripePaymentLink,
} from "./fulfillment.js";
import { getRazorpayConfig } from "./razorpay.js";
import { tryClaimWebhookEvent, updateWebhookEventPayload } from "./webhookEvents.js";
import { logPayment, logPaymentError } from "../logger.js";

function timingSafeEqual(a, b) {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function verifyRazorpayWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) {
    return false;
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return timingSafeEqual(expected, String(signatureHeader).trim());
}

export function resolveRazorpayEventId(event) {
  if (event?.id) {
    return String(event.id);
  }

  const payment = event?.payload?.payment?.entity || {};
  const paymentLink = event?.payload?.payment_link?.entity || {};
  const paymentId =
    payment.id ||
    paymentLink.payments?.find?.((entry) => entry?.payment_id)?.payment_id ||
    paymentLink.payments?.[0]?.payment_id ||
    null;
  const paymentLinkId = paymentLink.id || payment.payment_link_id || null;

  return `${event?.event || "unknown"}:${paymentId || paymentLinkId || "no-payment"}:${event?.created_at || Date.now()}`;
}

function normalizeQuotationId(value) {
  const id = String(value || "").trim();
  return id || null;
}

async function resolveQuotationIdFromRazorpayEvent(event) {
  const payload = event?.payload || {};
  const paymentLink = payload.payment_link?.entity || payload.payment_link || {};
  const payment = payload.payment?.entity || payload.payment || {};
  const order = payload.order?.entity || payload.order || {};

  const fromReference = normalizeQuotationId(
    paymentLink.reference_id || order.receipt || order.notes?.quotation_id,
  );
  if (fromReference) {
    return fromReference;
  }

  const fromNotes =
    normalizeQuotationId(
      (await resolveQuotationIdFromStripeMetadata(paymentLink.notes || {})) ||
        (await resolveQuotationIdFromStripeMetadata(payment.notes || {})) ||
        (await resolveQuotationIdFromStripeMetadata(order.notes || {})),
    );

  if (fromNotes) {
    return fromNotes;
  }

  const paymentLinkId =
    paymentLink.id ||
    payment.payment_link_id ||
    paymentLink.payments?.[0]?.payment_link_id ||
    null;

  if (paymentLinkId) {
    return resolveQuotationIdFromStripePaymentLink(paymentLinkId);
  }

  return null;
}

async function handlePaymentCaptured(payment, event, eventId) {
  const quotationId =
    normalizeQuotationId(await resolveQuotationIdFromStripeMetadata(payment?.notes || {})) ||
    (await resolveQuotationIdFromRazorpayEvent(event));

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const result = await markQuotationPaymentPaid({
    quotationId,
    providerPaymentId: payment.id,
    providerCustomerId: payment.customer_id || null,
    providerEventId: eventId,
    source: PAYMENT_PROVIDERS.RAZORPAY,
    deferNotifications: false,
  });

  return { handled: true, quotationId, ...result };
}

async function handlePaymentLinkPaid(event, eventId) {
  const quotationId = await resolveQuotationIdFromRazorpayEvent(event);
  if (!quotationId) {
    logPaymentError(
      "razorpay.webhook.missing_quotation",
      new Error("Could not resolve quotation from Razorpay webhook payload."),
      {
        eventType: event.event,
        paymentLinkId: event?.payload?.payment_link?.entity?.id || null,
        referenceId: event?.payload?.payment_link?.entity?.reference_id || null,
      },
    );
    return { handled: false, reason: "missing_quotation_id" };
  }

  const payment = event?.payload?.payment?.entity || {};
  const result = await markQuotationPaymentPaid({
    quotationId,
    providerPaymentId: payment.id || event?.payload?.payment_link?.entity?.id || eventId,
    providerCustomerId: payment.customer_id || null,
    providerEventId: eventId,
    source: PAYMENT_PROVIDERS.RAZORPAY,
    deferNotifications: false,
  });

  return { handled: true, quotationId, ...result };
}

async function handlePaymentFailed(payment, event, eventId) {
  const quotationId =
    normalizeQuotationId(await resolveQuotationIdFromStripeMetadata(payment?.notes || {})) ||
    (await resolveQuotationIdFromRazorpayEvent(event));

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const record = await markQuotationPaymentFailed({
    quotationId,
    failureReason: payment.error_description || payment.error_reason || "Payment failed",
    providerEventId: eventId,
  });

  return { handled: Boolean(record), quotationId };
}

export async function executeRazorpayWebhookEvent(event) {
  if (!event?.event) {
    throw new Error("Invalid Razorpay event payload.");
  }

  const eventId = resolveRazorpayEventId(event);
  let result = { handled: false, reason: "unsupported_event" };

  switch (event.event) {
    case "payment_link.paid":
      result = await handlePaymentLinkPaid(event, eventId);
      break;
    case "payment.captured":
      result = await handlePaymentCaptured(event.payload?.payment?.entity, event, eventId);
      break;
    case "payment.failed":
      result = await handlePaymentFailed(event.payload?.payment?.entity, event, eventId);
      break;
    case "order.paid":
      result = await handlePaymentCaptured(event.payload?.payment?.entity, event, eventId);
      break;
    default:
      result = { handled: false, reason: "ignored", eventType: event.event };
  }

  await updateWebhookEventPayload({
    provider: PAYMENT_PROVIDERS.RAZORPAY,
    eventId,
    quotationId: result.quotationId || null,
    payload: { handled: result.handled, reason: result.reason, eventType: event.event },
  });

  logPayment("razorpay.webhook.processed", {
    eventId,
    eventType: event.event,
    handled: result.handled,
    quotationId: result.quotationId || null,
    reason: result.reason || null,
  });

  return result;
}

export async function processRazorpayWebhookEvent(event) {
  const eventId = resolveRazorpayEventId(event);
  const claimed = await tryClaimWebhookEvent({
    provider: PAYMENT_PROVIDERS.RAZORPAY,
    eventId,
    eventType: event.event,
  });

  if (!claimed) {
    return { duplicate: true, eventId };
  }

  return executeRazorpayWebhookEvent(event);
}

export async function handleRazorpayWebhookRequest(rawBody, signatureHeader) {
  const { webhookSecret } = getRazorpayConfig();

  if (!webhookSecret) {
    throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured.");
  }

  if (!verifyRazorpayWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    throw new Error("Invalid Razorpay webhook signature.");
  }

  const event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
  return processRazorpayWebhookEvent(event);
}
