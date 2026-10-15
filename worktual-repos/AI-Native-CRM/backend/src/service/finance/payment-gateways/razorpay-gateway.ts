import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "crypto";
import type {
  CreatePaymentLinkInput,
  CreatePaymentLinkResult,
  GatewayCredentials,
  WebhookHandleResult,
} from "@/service/finance/payment-gateways/types";
import { recordGatewayEventIfNew } from "@/dao/finance/payment-gateway-events";

function requireRazorpay(creds: GatewayCredentials): Razorpay {
  if (!creds.razorpayKeyId?.trim() || !creds.razorpayKeySecret?.trim()) {
    throw new Error("Razorpay keys are not configured.");
  }
  return new Razorpay({
    key_id: creds.razorpayKeyId.trim(),
    key_secret: creds.razorpayKeySecret.trim(),
  });
}

export async function createRazorpayPaymentLink(
  creds: GatewayCredentials,
  input: CreatePaymentLinkInput,
): Promise<CreatePaymentLinkResult> {
  const rzp = requireRazorpay(creds);
  const amountMinor = Math.round(input.amount * 100);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new Error("Invoice amount must be positive for online payment.");
  }

  const link = await rzp.paymentLink.create({
    amount: amountMinor,
    currency: input.currency.toUpperCase(),
    description: `Invoice ${input.invoiceNumber}`,
    customer: input.customerEmail
      ? {
          email: input.customerEmail,
          name: input.customerName ?? undefined,
        }
      : undefined,
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: {
      invoiceId: input.invoiceId,
      organizationId: input.organizationId,
      invoiceNumber: input.invoiceNumber,
    },
    callback_url: input.successUrl,
    callback_method: "get",
  });

  const url = link.short_url || link.url;
  if (!url) {
    throw new Error("Razorpay did not return a payment link URL.");
  }

  return {
    provider: "razorpay",
    paymentLinkUrl: url,
    paymentSessionId: link.id,
    expiresAt: link.expired_at ? new Date(link.expired_at * 1000) : null,
  };
}

export async function cancelRazorpayPaymentLink(
  creds: GatewayCredentials,
  linkId: string,
): Promise<void> {
  const rzp = requireRazorpay(creds);
  try {
    await rzp.paymentLink.cancel(linkId);
  } catch {
    /* link may already be paid/cancelled */
  }
}

function verifyRazorpaySignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function handleRazorpayWebhook(
  creds: GatewayCredentials,
  rawBody: string,
  signature: string | undefined,
): Promise<WebhookHandleResult> {
  const webhookSecret = creds.razorpayWebhookSecret?.trim();
  if (!webhookSecret) {
    return { ok: false, error: "Razorpay webhook secret is not configured.", statusCode: 503 };
  }
  if (!verifyRazorpaySignature(rawBody, signature, webhookSecret)) {
    return { ok: false, error: "Invalid Razorpay signature.", statusCode: 400 };
  }

  let payload: {
    event?: string;
    payload?: {
      payment?: { entity?: { id?: string; notes?: Record<string, string> } };
      payment_link?: { entity?: { id?: string; notes?: Record<string, string> } };
    };
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return { ok: false, error: "Invalid JSON body.", statusCode: 400 };
  }

  const eventName = payload.event ?? "";
  if (
    eventName !== "payment.captured" &&
    eventName !== "payment_link.paid"
  ) {
    return { ok: false, error: "Ignored event type.", statusCode: 200 };
  }

  const notes =
    payload.payload?.payment?.entity?.notes ??
    payload.payload?.payment_link?.entity?.notes ??
    {};
  const invoiceId = notes.invoiceId;
  const organizationId = notes.organizationId;
  if (!invoiceId || !organizationId) {
    return { ok: false, error: "Missing invoice notes on Razorpay event.", statusCode: 400 };
  }

  const paymentId =
    payload.payload?.payment?.entity?.id ??
    payload.payload?.payment_link?.entity?.id ??
    eventName;

  const isNew = await recordGatewayEventIfNew({
    provider: "razorpay",
    externalEventId: `${eventName}:${paymentId}`,
    organizationId,
    invoiceId,
    payload: { event: eventName, paymentId },
  });
  if (!isNew) {
    return { ok: true, invoiceId, transactionId: paymentId, provider: "razorpay" };
  }

  return { ok: true, invoiceId, transactionId: paymentId, provider: "razorpay" };
}
