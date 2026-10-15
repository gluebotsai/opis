import Stripe from "stripe";
import type {
  CreatePaymentLinkInput,
  CreatePaymentLinkResult,
  GatewayCredentials,
  WebhookHandleResult,
} from "@/service/finance/payment-gateways/types";
import { recordGatewayEventIfNew } from "@/dao/finance/payment-gateway-events";

function requireStripe(secretKey: string | null | undefined): Stripe {
  if (!secretKey?.trim()) {
    throw new Error("Stripe secret key is not configured.");
  }
  return new Stripe(secretKey.trim());
}

export async function createStripePaymentLink(
  creds: GatewayCredentials,
  input: CreatePaymentLinkInput,
): Promise<CreatePaymentLinkResult> {
  const stripe = requireStripe(creds.stripeSecretKey);
  const amountMinor = Math.round(input.amount * 100);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new Error("Invoice amount must be positive for online payment.");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.customerEmail ?? undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: amountMinor,
          product_data: {
            name: `Invoice ${input.invoiceNumber}`,
            description: input.customerName ?? undefined,
          },
        },
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: {
      invoiceId: input.invoiceId,
      organizationId: input.organizationId,
      invoiceNumber: input.invoiceNumber,
    },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }

  const expiresAt = session.expires_at
    ? new Date(session.expires_at * 1000)
    : null;

  return {
    provider: "stripe",
    paymentLinkUrl: session.url,
    paymentSessionId: session.id,
    expiresAt,
  };
}

export async function cancelStripePaymentLink(
  creds: GatewayCredentials,
  sessionId: string,
): Promise<void> {
  const stripe = requireStripe(creds.stripeSecretKey);
  try {
    await stripe.checkout.sessions.expire(sessionId);
  } catch {
    /* session may already be complete/expired */
  }
}

export async function handleStripeWebhook(
  creds: GatewayCredentials,
  rawBody: string,
  signature: string | undefined,
): Promise<WebhookHandleResult> {
  const webhookSecret = creds.stripeWebhookSecret?.trim();
  if (!webhookSecret) {
    return { ok: false, error: "Stripe webhook secret is not configured.", statusCode: 503 };
  }
  if (!signature) {
    return { ok: false, error: "Missing Stripe-Signature header.", statusCode: 400 };
  }

  const stripe = requireStripe(creds.stripeSecretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid Stripe signature.",
      statusCode: 400,
    };
  }

  if (event.type !== "checkout.session.completed") {
    return { ok: false, error: "Ignored event type.", statusCode: 200 };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const invoiceId = session.metadata?.invoiceId;
  const organizationId = session.metadata?.organizationId;
  if (!invoiceId || !organizationId) {
    return { ok: false, error: "Missing invoice metadata on session.", statusCode: 400 };
  }

  const isNew = await recordGatewayEventIfNew({
    provider: "stripe",
    externalEventId: event.id,
    organizationId,
    invoiceId,
    payload: { type: event.type, sessionId: session.id },
  });
  if (!isNew) {
    return {
      ok: true,
      invoiceId,
      transactionId: session.payment_intent?.toString() ?? session.id,
      provider: "stripe",
    };
  }

  const transactionId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.id;

  return {
    ok: true,
    invoiceId,
    transactionId,
    provider: "stripe",
  };
}
