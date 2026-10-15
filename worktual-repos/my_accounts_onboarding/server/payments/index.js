import { formatPaymentAmount, resolveQuotationPaymentAmount } from "../paymentAmount.js";
import { logPayment, logPaymentError } from "../logger.js";
import { PAYMENT_PROVIDERS } from "./constants.js";
import { createRazorpayPaymentLink, getRazorpayConfig } from "./razorpay.js";
import { createStripePaymentLink, getStripeConfig } from "./stripe.js";

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

export function getPaymentProvider() {
  return (env("PAYMENT_PROVIDER") || "stripe").toLowerCase();
}

export function getPaymentConfig() {
  const provider = getPaymentProvider();
  const stripe = getStripeConfig();
  const razorpay = getRazorpayConfig();

  return {
    provider,
    stripePublishableKey: stripe.publishableKey,
    stripeConfigured: stripe.configured,
    razorpayKeyId: razorpay.keyId,
    razorpayConfigured: razorpay.configured,
    razorpayWebhookConfigured: razorpay.webhookConfigured,
    activeProviderConfigured:
      provider === PAYMENT_PROVIDERS.RAZORPAY ? razorpay.configured : stripe.configured,
    providers: {
      stripe: { configured: stripe.configured },
      razorpay: { configured: razorpay.configured },
    },
  };
}

export async function createQuotationPaymentLink(quotation, { provider: providerOverride } = {}) {
  const amounts = resolveQuotationPaymentAmount(quotation);

  logPayment("payment_link.resolve_amount", {
    quotationId: quotation?.id || null,
    leadId: quotation?.leadId || null,
    grandTotal: amounts.grandTotal,
    subtotal: amounts.subtotal,
    currency: amounts.currency,
    source:
      quotation?.invoices?.some((entry) => entry?.grandTotal > 0)
        ? "invoices"
        : quotation?.grandTotal > 0
          ? "quotation"
          : "product_summary",
  });

  if (!amounts.grandTotal || amounts.grandTotal <= 0) {
    const error = new Error(
      "Quotation amount must be greater than zero to create a payment link. Regenerate the invoice from sales workflow and resubmit to finance.",
    );
    logPaymentError("payment_link.invalid_amount", error, {
      quotationId: quotation?.id || null,
    });
    throw error;
  }

  const companyName = quotation.lead?.companyName || "Worktual customer";
  const description = `Worktual invoice — ${companyName}`;
  const provider = String(providerOverride || getPaymentProvider()).toLowerCase();
  const payload = {
    amount: amounts.grandTotal,
    currency: amounts.currency,
    description,
    metadata: {
      quotation_id: quotation.id,
      lead_id: quotation.leadId || "",
      company_name: companyName,
    },
  };

  try {
    let linkResult;
    if (provider === PAYMENT_PROVIDERS.RAZORPAY) {
      linkResult = await createRazorpayPaymentLink(payload);
    } else if (provider === PAYMENT_PROVIDERS.STRIPE) {
      linkResult = await createStripePaymentLink(payload);
    } else {
      throw new Error(`Unsupported payment provider: ${provider}`);
    }

    logPayment("payment_link.created", {
      quotationId: quotation.id,
      provider,
      paymentLinkId: linkResult.paymentLinkId,
      paymentLinkUrl: linkResult.paymentLinkUrl,
      dryRun: linkResult.dryRun === true,
      amount: amounts.grandTotal,
      currency: amounts.currency,
    });

    return {
      ...amounts,
      ...linkResult,
      amountLabel: formatPaymentAmount(amounts.grandTotal, amounts.currency),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    logPaymentError("payment_link.failed", error, {
      quotationId: quotation?.id || null,
      provider,
      amount: amounts.grandTotal,
      currency: amounts.currency,
    });
    throw error;
  }
}
