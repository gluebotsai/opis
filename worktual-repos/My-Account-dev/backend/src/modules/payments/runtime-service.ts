import {
  formatPaymentAmount,
  resolveInvoicePaymentAmount,
  resolveQuotationPaymentAmount,
  applyPaymentProviderPolicy,
} from "./amount-policy.js";
import { logPayment, logPaymentError } from "../../infra/file-logger.js";
import { getPaymentConfirmSlaHours } from "../../infra/env.js";
import { PAYMENT_PROVIDERS } from "./constants.js";
import { createRazorpayPaymentLink, getRazorpayConfig } from "./razorpay.js";
import { createStripePaymentLink, getStripeConfig } from "./stripe.js";

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
    stripeWebhookConfigured: stripe.webhookConfigured,
    razorpayKeyId: razorpay.keyId,
    razorpayConfigured: razorpay.configured,
    razorpayWebhookConfigured: razorpay.webhookConfigured,
    activeProviderConfigured:
      provider === PAYMENT_PROVIDERS.RAZORPAY ? razorpay.configured : stripe.configured,
    providers: {
      stripe: {
        configured: stripe.configured,
        webhookConfigured: stripe.webhookConfigured,
      },
      razorpay: {
        configured: razorpay.configured,
        webhookConfigured: razorpay.webhookConfigured,
      },
    },
    paymentConfirmSlaHours: getPaymentConfirmSlaHours(),
  };
}

// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
export async function createQuotationPaymentLink(quotation: any, { provider: providerOverride } = {}) {
  const amounts = resolveQuotationPaymentAmount(quotation);

  const companyName = quotation?.lead?.companyName || quotation?.lead?.company_name || null;

  logPayment("payment_link.resolve_amount", {
    quotationId: quotation?.id || null,
    leadId: quotation?.leadId || null,
    companyName,
    amount: amounts.grandTotal,
    grandTotal: amounts.grandTotal,
    subtotal: amounts.subtotal,
    currency: amounts.currency,
    source:
      quotation?.invoices?.some((entry: any) => entry?.grandTotal > 0)
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
      companyName,
    });
    throw error;
  }

  const { provider: policyProvider, policy } = applyPaymentProviderPolicy(
    quotation,
    providerOverride,
  );

  if (policy.mode === "offline") {
    throw new Error(
      policy.reason ||
        "Online payment links are not available for this invoice amount. Use offline payment.",
    );
  }

  const invoiceCompanyName = companyName || "Worktual customer";
  const description = `Worktual invoice — ${invoiceCompanyName}`;
  const provider = String(policyProvider || getPaymentProvider()).toLowerCase();
  const payload = {
    amount: amounts.grandTotal,
    currency: amounts.currency,
    description,
    metadata: {
      quotation_id: quotation.id,
      lead_id: quotation.leadId || "",
      company_name: invoiceCompanyName,
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
      companyName: invoiceCompanyName,
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
      companyName: invoiceCompanyName,
      provider,
      amount: amounts.grandTotal,
      currency: amounts.currency,
    });
    throw error;
  }
}

function isMultiBranchQuotation(quotation: any) {
  return Array.isArray(quotation?.invoices) && quotation.invoices.length > 1;
}

// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
async function createProviderPaymentLink({ amount, currency, description, metadata, provider }) {
  if (provider === PAYMENT_PROVIDERS.RAZORPAY) {
    return createRazorpayPaymentLink({ amount, currency, description, metadata });
  }
  if (provider === PAYMENT_PROVIDERS.STRIPE) {
    return createStripePaymentLink({ amount, currency, description, metadata });
  }
  throw new Error(`Unsupported payment provider: ${provider}`);
}

// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
export async function createQuotationBranchPaymentLinks(quotation: any, { provider: providerOverride } = {}) {
  const { provider: policyProvider, policy } = applyPaymentProviderPolicy(
    quotation,
    providerOverride,
  );

  if (policy.mode === "offline") {
    throw new Error(
      policy.reason ||
        "Online payment links are not available for this invoice amount. Use offline payment.",
    );
  }

  const invoices = (quotation?.invoices || []).filter(
    (entry: any) => Number(entry?.grandTotal) > 0 && entry?.billingBranchId,
  );

  if (invoices.length <= 1) {
    const payment = await createQuotationPaymentLink(quotation, { provider: policyProvider });
    return { parentPayment: payment, branchPayments: [] };
  }

  const companyName = quotation.lead?.companyName || "Worktual customer";
  const provider = String(policyProvider || getPaymentProvider()).toLowerCase();
  const branchPayments = [];
  let aggregateSubtotal = 0;
  let aggregateGrandTotal = 0;
  let currency = resolveQuotationPaymentAmount(quotation).currency;
  let gstRate = quotation?.gstRate ?? 0.18;
  let dryRun = false;

  for (const invoice of invoices) {
    const amounts = resolveInvoicePaymentAmount(invoice, quotation);
    if (!amounts.grandTotal || amounts.grandTotal <= 0) {
      continue;
    }

    const branchLabel = invoice.branchLabel || invoice.billingBranchId || "Branch";
    const description = `Worktual invoice — ${companyName} — ${branchLabel}`;
    const metadata = {
      quotation_id: quotation.id,
      lead_id: quotation.leadId || "",
      company_name: companyName,
      billing_branch_id: invoice.billingBranchId,
      branch_label: branchLabel,
    };

    const linkResult = await createProviderPaymentLink({
      amount: amounts.grandTotal,
      currency: amounts.currency,
      description,
      metadata,
      provider,
    });

    dryRun = dryRun || linkResult.dryRun === true;
    aggregateSubtotal += amounts.subtotal;
    aggregateGrandTotal += amounts.grandTotal;
    currency = amounts.currency;
    gstRate = amounts.gstRate;

    branchPayments.push({
      billingBranchId: invoice.billingBranchId,
      branchLabel,
      invoiceFileName: invoice.fileName || "",
      ...amounts,
      ...linkResult,
      amountLabel: formatPaymentAmount(amounts.grandTotal, amounts.currency),
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    logPayment("payment_link.branch_created", {
      quotationId: quotation.id,
      companyName: quotation?.lead?.companyName || quotation?.lead?.company_name || null,
      billingBranchId: invoice.billingBranchId,
      provider,
      paymentLinkId: linkResult.paymentLinkId,
      amount: amounts.grandTotal,
      currency: amounts.currency,
    });
  }

  if (!branchPayments.length) {
    const error = new Error(
      "Quotation amount must be greater than zero to create payment links. Regenerate the invoice from sales workflow and resubmit to finance.",
    );
    logPaymentError("payment_link.invalid_amount", error, {
      quotationId: quotation?.id || null,
    });
    throw error;
  }

  const parentPayment = {
    provider: branchPayments[0]?.provider || provider,
    paymentLinkUrl: null,
    paymentLinkId: null,
    subtotal: Math.round(aggregateSubtotal * 100) / 100,
    grandTotal: Math.round(aggregateGrandTotal * 100) / 100,
    currency,
    gstRate,
    amountLabel: formatPaymentAmount(aggregateGrandTotal, currency),
    status: "pending",
    dryRun,
    branchPayments,
    createdAt: new Date().toISOString(),
  };

  logPayment("payment_link.multi_branch_created", {
    quotationId: quotation.id,
    branchCount: branchPayments.length,
    grandTotal: parentPayment.grandTotal,
    currency,
  });

  return { parentPayment, branchPayments };
}

export { isMultiBranchQuotation };
