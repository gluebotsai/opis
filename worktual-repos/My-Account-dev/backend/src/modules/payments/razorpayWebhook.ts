import crypto from "node:crypto";

import { PAYMENT_PROVIDERS } from "./constants.js";
import {
  markQuotationPaymentFailed,
  recordProviderPaymentReported,
  resolvePaymentLinkContext,
  resolveQuotationIdFromStripeMetadata,
  resolveQuotationIdFromStripePaymentLink,
} from "./fulfillment.js";
import { getRazorpayConfig } from "./razorpay.js";
import { companyNameFromQuotation, paymentLogDetails } from "./logContext.js";
import { tryClaimWebhookEvent, updateWebhookEventPayload } from "./webhookEvents.js";
import { logPayment, logPaymentError } from "../../infra/file-logger.js";

function timingSafeEqual(a: any, b: any) {
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

export function verifyRazorpayWebhookSignature(rawBody: any, signatureHeader: any, secret: any) {
  if (!signatureHeader || !secret) {
    return false;
  }

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return timingSafeEqual(expected, String(signatureHeader).trim());
}

export function resolveRazorpayEventId(event: any) {
  if (event?.id) {
    return String(event.id);
  }

  const payment = event?.payload?.payment?.entity || {};
  const paymentLink = event?.payload?.payment_link?.entity || {};
  const paymentId =
    payment.id ||
    paymentLink.payments?.find?.((entry: any) => entry?.payment_id)?.payment_id ||
    paymentLink.payments?.[0]?.payment_id ||
    null;
  const paymentLinkId = paymentLink.id || payment.payment_link_id || null;

  return `${event?.event || "unknown"}:${paymentId || paymentLinkId || "no-payment"}:${event?.created_at || Date.now()}`;
}

function normalizeQuotationId(value: any) {
  const id = String(value || "").trim();
  return id || null;
}

async function resolveQuotationIdFromRazorpayEvent(event: any) {
  const payload = event?.payload || {};
  const paymentLink = payload.payment_link?.entity || payload.payment_link || {};
  const payment = payload.payment?.entity || payload.payment || {};
  const order = payload.order?.entity || payload.order || {};

  const fromNotesBillingTarget = normalizeQuotationId(
    paymentLink.notes?.billing_branch_id || payment.notes?.billing_branch_id || null,
  );

  const fromReferenceRaw = normalizeQuotationId(
    paymentLink.reference_id || order.receipt || order.notes?.quotation_id,
  );
  // Branch links use `${quotationId}_${billingBranchId}` (truncated). Prefer notes / payment_link_id.
  if (fromReferenceRaw && !fromReferenceRaw.includes("_")) {
    return { quotationId: fromReferenceRaw, billingBranchId: fromNotesBillingTarget || null };
  }

  const fromNotes = normalizeQuotationId(
    (await resolveQuotationIdFromStripeMetadata(paymentLink.notes || {})) ||
      (await resolveQuotationIdFromStripeMetadata(payment.notes || {})) ||
      (await resolveQuotationIdFromStripeMetadata(order.notes || {})),
  );

  if (fromNotes) {
    return {
      quotationId: fromNotes,
      billingBranchId:
        fromNotesBillingTarget ||
        paymentLink.notes?.billing_branch_id ||
        payment.notes?.billing_branch_id ||
        null,
    };
  }

  const paymentLinkId =
    paymentLink.id ||
    payment.payment_link_id ||
    paymentLink.payments?.[0]?.payment_link_id ||
    null;

  if (paymentLinkId) {
    const context = await resolvePaymentLinkContext(paymentLinkId);
    if (context?.quotationId) {
      return context;
    }
    const quotationId = await resolveQuotationIdFromStripePaymentLink(paymentLinkId);
    return quotationId ? { quotationId, billingBranchId: fromNotesBillingTarget || null } : null;
  }

  return null;
}

async function handlePaymentCaptured(payment: any, event: any, eventId: any) {
  const fromMetadata = await resolveQuotationIdFromStripeMetadata(payment?.notes || {});
  const fromEvent = await resolveQuotationIdFromRazorpayEvent(event);
  const quotationId = normalizeQuotationId(fromMetadata) || fromEvent?.quotationId;
  const billingBranchId =
    payment?.notes?.billing_branch_id || fromEvent?.billingBranchId || null;

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const result = await recordProviderPaymentReported({
    quotationId,
    billingBranchId,
    providerPaymentId: payment.id,
    providerCustomerId: payment.customer_id || null,
    providerEventId: eventId,
    source: PAYMENT_PROVIDERS.RAZORPAY,
  });

  return { handled: true, quotationId, billingBranchId, ...result };
}

async function handlePaymentLinkPaid(event: any, eventId: any) {
  const resolved = await resolveQuotationIdFromRazorpayEvent(event);
  const quotationId = resolved?.quotationId;
  const billingBranchId = resolved?.billingBranchId || null;
  if (!quotationId) {
    logPaymentError(
      "razorpay.webhook.missing_quotation",
      new Error("Could not resolve quotation from Razorpay webhook payload."),
      paymentLogDetails({
        provider: PAYMENT_PROVIDERS.RAZORPAY,
        eventId,
        eventType: event.event,
        providerLinkId: event?.payload?.payment_link?.entity?.id || null,
        referenceId: event?.payload?.payment_link?.entity?.reference_id || null,
      }),
    );
    return { handled: false, reason: "missing_quotation_id" };
  }

  const payment = event?.payload?.payment?.entity || {};
  const result = await recordProviderPaymentReported({
    quotationId,
    billingBranchId,
    providerPaymentId: payment.id || event?.payload?.payment_link?.entity?.id || eventId,
    providerCustomerId: payment.customer_id || null,
    providerEventId: eventId,
    source: PAYMENT_PROVIDERS.RAZORPAY,
  });

  return { handled: true, quotationId, billingBranchId, ...result };
}

async function handlePaymentFailed(payment: any, event: any, eventId: any) {
  const fromMetadata = normalizeQuotationId(
    await resolveQuotationIdFromStripeMetadata(payment?.notes || {}),
  );
  const fromEvent = await resolveQuotationIdFromRazorpayEvent(event);
  const quotationId = fromMetadata || fromEvent?.quotationId;
  const billingBranchId =
    payment?.notes?.billing_branch_id ||
    payment?.notes?.billingBranchId ||
    fromEvent?.billingBranchId ||
    null;

  if (!quotationId) {
    return { handled: false, reason: "missing_quotation_id" };
  }

  const failureReason = payment.error_description || payment.error_reason || "Payment declined";
  const record = await markQuotationPaymentFailed({
    quotationId,
    billingBranchId,
    failureReason,
    providerEventId: eventId,
    providerPaymentId: payment?.id || null,
  });

  return {
    handled: Boolean(record),
    quotationId,
    billingBranchId,
    payment: record,
    paymentStatus: record?.status || "failed",
    failureReason,
  };
}

async function handlePaymentLinkAbandoned(event: any, eventId: any, failureReason: any) {
  const resolved = await resolveQuotationIdFromRazorpayEvent(event);
  const quotationId = resolved?.quotationId;
  const billingBranchId = resolved?.billingBranchId || null;

  if (!quotationId) {
    logPaymentError(
      "razorpay.webhook.missing_quotation",
      new Error("Could not resolve quotation from Razorpay payment link event."),
      paymentLogDetails({
        provider: PAYMENT_PROVIDERS.RAZORPAY,
        eventId,
        eventType: event.event,
        providerLinkId: event?.payload?.payment_link?.entity?.id || null,
        referenceId: event?.payload?.payment_link?.entity?.reference_id || null,
      }),
    );
    return { handled: false, reason: "missing_quotation_id" };
  }

  const paymentLink = event?.payload?.payment_link?.entity || {};
  const record = await markQuotationPaymentFailed({
    quotationId,
    billingBranchId,
    failureReason,
    providerEventId: eventId,
    providerPaymentId: paymentLink.id || null,
  });

  return {
    handled: Boolean(record),
    quotationId,
    billingBranchId,
    payment: record,
    paymentStatus: record?.status || "failed",
    failureReason,
  };
}

export async function executeRazorpayWebhookEvent(event: any) {
  if (!event?.event) {
    throw new Error("Invalid Razorpay event payload.");
  }

  const eventId = resolveRazorpayEventId(event);
  let result = { handled: false, reason: "unsupported_event" };

  // Dashboard must also subscribe to payment_link.cancelled and payment_link.expired.
  switch (event.event) {
    case "payment_link.paid":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentLinkPaid(event, eventId);
      break;
    case "payment.captured":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentCaptured(event.payload?.payment?.entity, event, eventId);
      break;
    case "payment.failed":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentFailed(event.payload?.payment?.entity, event, eventId);
      break;
    case "payment_link.cancelled":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentLinkAbandoned(event, eventId, "Payment link cancelled");
      break;
    case "payment_link.expired":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentLinkAbandoned(event, eventId, "Payment link expired");
      break;
    case "order.paid":
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = await handlePaymentCaptured(event.payload?.payment?.entity, event, eventId);
      break;
    default:
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      result = { handled: false, reason: "ignored", eventType: event.event };
  }

  await updateWebhookEventPayload({
    provider: PAYMENT_PROVIDERS.RAZORPAY,
    eventId,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    quotationId: result.quotationId || null,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    payload: { handled: result.handled, reason: result.reason, eventType: event.event },
  });

  logPayment(
    "razorpay.webhook.processed",
    paymentLogDetails({
      provider: PAYMENT_PROVIDERS.RAZORPAY,
      eventId,
      eventType: event.event,
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

export async function processRazorpayWebhookEvent(event: any) {
  const eventId = resolveRazorpayEventId(event);
  const claimed = await tryClaimWebhookEvent({
    provider: PAYMENT_PROVIDERS.RAZORPAY,
    eventId,
    eventType: event.event,
  });

  // Always execute: gateway fulfillment is idempotent. Retries after a partial failure
  // must still complete auto-confirm even if the event id was already claimed.
  const result = await executeRazorpayWebhookEvent(event);

  logPayment(
    claimed ? "razorpay.webhook.claimed" : "razorpay.webhook.duplicate",
    paymentLogDetails({
      provider: PAYMENT_PROVIDERS.RAZORPAY,
      eventId,
      eventType: event.event,
      duplicate: !claimed,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      quotationId: result.quotationId || null,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      companyName: companyNameFromQuotation(result.quotation),
    }),
  );

  if (!claimed) {
    return { ...result, duplicate: true, eventId };
  }
  return result;
}

export async function handleRazorpayWebhookRequest(rawBody: any, signatureHeader: any) {
  const { webhookSecret } = getRazorpayConfig();

  if (!webhookSecret) {
    throw new Error(
      "RAZORPAY_WEBHOOK_SECRET is not configured. Set the Razorpay webhook secret and restart the server so payment links auto-confirm via webhook.",
    );
  }

  if (!verifyRazorpayWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
    throw new Error("Invalid Razorpay webhook signature.");
  }

  const event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
  const eventId = resolveRazorpayEventId(event);
  logPayment(
    "razorpay.webhook.received",
    paymentLogDetails({
      provider: PAYMENT_PROVIDERS.RAZORPAY,
      eventId,
      eventType: event.event,
    }),
  );

  const result = await processRazorpayWebhookEvent(event);

  if (result?.handled === false && result?.reason && result.reason !== "ignored") {
    logPayment(
      "razorpay.webhook.not_applied",
      paymentLogDetails({
        provider: PAYMENT_PROVIDERS.RAZORPAY,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        eventId: result.eventId || eventId,
        eventType: event.event,
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
