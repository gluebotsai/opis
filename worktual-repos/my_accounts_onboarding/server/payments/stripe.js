import { assertStripeChargeAmount, toStripeMinorUnits } from "./stripeLimits.js";
import { logPayment, logPaymentError } from "../logger.js";

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

function toStripeAmount(grandTotal, currency) {
  return toStripeMinorUnits(grandTotal, currency);
}

export function getStripeConfig() {
  return {
    secretKey: env("STRIPE_SECRET_KEY"),
    publishableKey: env("STRIPE_PUBLISHABLE_KEY"),
    configured: Boolean(env("STRIPE_SECRET_KEY")),
  };
}

export async function createStripePaymentLink({
  amount,
  currency,
  description,
  metadata = {},
}) {
  const { secretKey } = getStripeConfig();
  const charge = assertStripeChargeAmount(amount, currency);

  logPayment("stripe.payment_link.request", {
    quotationId: metadata.quotation_id || metadata.quotationId || null,
    amount,
    currency: charge.currency,
    minorUnits: charge.minorUnits,
    settlementCurrency: charge.settlementCurrency,
    dryRun: !secretKey,
  });

  if (!secretKey) {
    const mockUrl = `https://checkout.stripe.example/pay/${metadata.quotationId || metadata.quotation_id || "demo"}?amount=${amount}&currency=${currency}`;
    logPayment("stripe.payment_link.mock", {
      quotationId: metadata.quotation_id || metadata.quotationId || null,
      paymentLinkUrl: mockUrl,
    });
    return {
      provider: "stripe",
      paymentLinkUrl: mockUrl,
      paymentLinkId: `plink_demo_${Date.now()}`,
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
    params.append(`metadata[${key}]`, String(value));
  }

  const response = await fetch("https://api.stripe.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const stripeMessage = data.error?.message || "Stripe payment link creation failed.";
    logPaymentError("stripe.payment_link.failed", new Error(stripeMessage), {
      quotationId: metadata.quotation_id || metadata.quotationId || null,
      amount,
      currency: charge.currency,
      minorUnits: unitAmount,
      stripeCode: data.error?.code || null,
      stripeType: data.error?.type || null,
    });
    throw new Error(stripeMessage);
  }

  logPayment("stripe.payment_link.created", {
    quotationId: metadata.quotation_id || metadata.quotationId || null,
    paymentLinkId: data.id,
    paymentLinkUrl: data.url,
    amount,
    currency: charge.currency,
  });

  return {
    provider: "stripe",
    paymentLinkUrl: data.url,
    paymentLinkId: data.id,
    dryRun: false,
  };
}
