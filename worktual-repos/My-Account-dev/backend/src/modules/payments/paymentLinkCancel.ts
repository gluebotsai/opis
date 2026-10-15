import { logPayment, logPaymentError } from "../../infra/file-logger.js";
import { PAYMENT_PROVIDERS } from "./constants.js";
import { cancelRazorpayPaymentLink } from "./razorpay.js";
import { deactivateStripePaymentLink } from "./stripe.js";

function collectPaymentLinkTargets(quotation: any) {
  const payment = quotation?.payment;
  if (!payment) {
    return [];
  }

  const defaultProvider = String(payment.provider || "").toLowerCase();
  const seen = new Set<string>();
  const targets: Array<{ paymentLinkId: string; provider: string }> = [];

  const push = (paymentLinkId: any, provider: any) => {
    const id = String(paymentLinkId || "").trim();
    if (!id || seen.has(id)) {
      return;
    }
    const resolved = String(provider || defaultProvider || "").toLowerCase();
    if (resolved !== PAYMENT_PROVIDERS.STRIPE && resolved !== PAYMENT_PROVIDERS.RAZORPAY) {
      return;
    }
    seen.add(id);
    targets.push({ paymentLinkId: id, provider: resolved });
  };

  push(payment.paymentLinkId, payment.provider);

  for (const branch of payment.branchPayments || []) {
    push(branch?.paymentLinkId, branch?.provider || payment.provider);
  }

  return targets;
}

async function cancelOnePaymentLink({ paymentLinkId, provider }: any) {
  if (provider === PAYMENT_PROVIDERS.RAZORPAY) {
    return cancelRazorpayPaymentLink(paymentLinkId);
  }
  return deactivateStripePaymentLink(paymentLinkId);
}

/**
 * Cancel/deactivate every Stripe/Razorpay payment link on a quotation (parent + branches).
 * Aborts on the first live provider failure so active links are not left after a partial revert.
 */
export async function cancelQuotationPaymentLinks(quotation: any) {
  const targets = collectPaymentLinkTargets(quotation);
  if (!targets.length) {
    throw new Error(
      "No online payment links found to cancel. Revert is only available for Approved invoices with a Stripe or Razorpay payment link.",
    );
  }

  const results = [];
  for (const target of targets) {
    try {
      const result = await cancelOnePaymentLink(target);
      results.push({ ...target, ...result });
    } catch (error) {
      logPaymentError("payment_link.cancel_failed", error, {
        quotationId: quotation?.id || null,
        paymentLinkId: target.paymentLinkId,
        provider: target.provider,
      });
      throw new Error(
        error instanceof Error
          ? `Could not cancel payment link (${target.provider}): ${error.message}`
          : "Could not cancel payment link.",
      );
    }
  }

  logPayment("payment_link.cancel_batch", {
    quotationId: quotation?.id || null,
    count: results.length,
    paymentLinkIds: results.map((entry) => entry.paymentLinkId),
  });

  return results;
}

export function quotationHasCancellableOnlinePaymentLinks(quotation: any) {
  return collectPaymentLinkTargets(quotation).length > 0;
}
