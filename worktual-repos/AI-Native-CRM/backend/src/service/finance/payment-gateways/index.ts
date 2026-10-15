import { prisma } from "@/dao/db/prisma";
import { getInvoice } from "@/dao/finance/invoice-service";
import {
  getEffectiveFinanceDefaults,
  getOrgFinanceSettingsPublic,
  getOrgFinanceSettingsSecrets,
} from "@/dao/finance/org-finance-settings";
import { markInvoicePaid } from "@/dao/finance/invoice-service";
import {
  resolvePaymentPath,
  type PaymentProvider,
} from "@/service/finance/payment-routing";
import {
  cancelRazorpayPaymentLink,
  createRazorpayPaymentLink,
  handleRazorpayWebhook,
} from "@/service/finance/payment-gateways/razorpay-gateway";
import {
  cancelStripePaymentLink,
  createStripePaymentLink,
  handleStripeWebhook,
} from "@/service/finance/payment-gateways/stripe-gateway";
import type {
  CreatePaymentLinkResult,
  GatewayCredentials,
  WebhookHandleResult,
} from "@/service/finance/payment-gateways/types";

export function appBaseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.APP_URL?.replace(/\/$/, "") ||
    "http://localhost:5173"
  );
}

async function loadGatewayCredentials(
  organizationId: bigint | string,
): Promise<GatewayCredentials & { public: Awaited<ReturnType<typeof getOrgFinanceSettingsPublic>> }> {
  const [publicSettings, secrets] = await Promise.all([
    getOrgFinanceSettingsPublic(organizationId),
    getOrgFinanceSettingsSecrets(organizationId),
  ]);
  return {
    public: publicSettings,
    stripePublishableKey: publicSettings.stripePublishableKey,
    stripeSecretKey: secrets.stripeSecretKey,
    stripeWebhookSecret: secrets.stripeWebhookSecret,
    razorpayKeyId: publicSettings.razorpayKeyId,
    razorpayKeySecret: secrets.razorpayKeySecret,
    razorpayWebhookSecret: secrets.razorpayWebhookSecret,
  };
}

function linkStillActive(invoice: {
  paymentLinkUrl: string | null;
  paymentSessionId: string | null;
  paymentSessionStatus: string | null;
  paymentSessionExpiresAt: Date | null;
}): boolean {
  if (!invoice.paymentLinkUrl || !invoice.paymentSessionId) return false;
  if (invoice.paymentSessionStatus === "paid" || invoice.paymentSessionStatus === "cancelled") {
    return false;
  }
  if (
    invoice.paymentSessionExpiresAt &&
    invoice.paymentSessionExpiresAt.getTime() < Date.now()
  ) {
    return false;
  }
  return invoice.paymentSessionStatus === "active" || !invoice.paymentSessionStatus;
}

export async function ensureInvoicePaymentLink(input: {
  invoiceId: string;
  preferredProvider?: PaymentProvider | null;
}): Promise<
  | { ok: true; mode: "offline"; reason?: string }
  | { ok: true; mode: "online"; link: CreatePaymentLinkResult }
  | { ok: false; error: string }
> {
  const invoice = await getInvoice(input.invoiceId);
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const creds = await loadGatewayCredentials(invoice.organizationId);
  const defaults = await getEffectiveFinanceDefaults(invoice.organizationId);
  const path = resolvePaymentPath({
    total: invoice.total,
    currency: invoice.currency,
    billingKind: invoice.billingKind,
    defaults,
    gatewayConfigured: creds.public,
    preferredProvider: input.preferredProvider,
  });

  if (path.mode === "blocked") {
    return { ok: false, error: path.reason };
  }
  if (path.mode === "offline") {
    return { ok: true, mode: "offline", reason: path.reason };
  }

  if (
    linkStillActive({
      paymentLinkUrl: invoice.paymentLinkUrl,
      paymentSessionId: invoice.paymentSessionId,
      paymentSessionStatus: invoice.paymentSessionStatus,
      paymentSessionExpiresAt: invoice.paymentSessionExpiresAt,
    }) &&
    invoice.paymentProvider === path.provider
  ) {
    return {
      ok: true,
      mode: "online",
      link: {
        provider: path.provider,
        paymentLinkUrl: invoice.paymentLinkUrl!,
        paymentSessionId: invoice.paymentSessionId!,
        expiresAt: invoice.paymentSessionExpiresAt,
      },
    };
  }

  const base = appBaseUrl();
  const linkInput = {
    invoiceId: invoice.id,
    organizationId: invoice.organizationId.toString(),
    invoiceNumber: invoice.number,
    amount: Number(invoice.total),
    currency: invoice.currency,
    customerEmail: invoice.leadEmail,
    customerName: invoice.company?.name ?? null,
    successUrl: `${base}/finance/${invoice.id}?paid=1`,
    cancelUrl: `${base}/finance/${invoice.id}?cancelled=1`,
  };

  const gatewayCreds: GatewayCredentials = creds;
  const link =
    path.provider === "stripe"
      ? await createStripePaymentLink(gatewayCreds, linkInput)
      : await createRazorpayPaymentLink(gatewayCreds, linkInput);

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      paymentProvider: path.provider,
      paymentLinkUrl: link.paymentLinkUrl,
      paymentSessionId: link.paymentSessionId,
      paymentSessionExpiresAt: link.expiresAt,
      paymentSessionStatus: "active",
    },
  });

  return { ok: true, mode: "online", link };
}

export async function cancelInvoicePaymentLink(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice?.paymentSessionId || !invoice.paymentProvider) return;
  if (invoice.paymentSessionStatus === "paid" || invoice.paymentSessionStatus === "cancelled") {
    return;
  }

  const creds = await loadGatewayCredentials(invoice.organizationId);
  const gatewayCreds: GatewayCredentials = creds;

  if (invoice.paymentProvider === "stripe") {
    await cancelStripePaymentLink(gatewayCreds, invoice.paymentSessionId);
  } else {
    await cancelRazorpayPaymentLink(gatewayCreds, invoice.paymentSessionId);
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { paymentSessionStatus: "cancelled" },
  });
}

export async function finalizeGatewayPayment(
  result: Extract<WebhookHandleResult, { ok: true }>,
): Promise<void> {
  const existing = await prisma.invoice.findUnique({
    where: { id: result.invoiceId },
    select: { status: true },
  });
  if (existing?.status === "paid") return;

  await markInvoicePaid(result.invoiceId, {
    paymentMethod: result.provider,
    paymentReference: result.transactionId,
    confirmedByUserId: null,
  });
  await prisma.invoice.update({
    where: { id: result.invoiceId },
    data: { paymentSessionStatus: "paid" },
  });

  const invoice = await getInvoice(result.invoiceId);
  const contactId =
    invoice?.deal?.contactId ?? invoice?.order?.deal?.contactId ?? null;
  if (contactId) {
    const { triggerLeadLifecycle } = await import(
      "@/service/ai/lead-lifecycle-trigger"
    );
    triggerLeadLifecycle({
      contactId,
      event: "invoice_paid",
      meta: { invoiceId: result.invoiceId },
    });
  }
}

export async function processStripeWebhook(
  rawBody: string,
  signature: string | undefined,
  organizationId: string,
): Promise<WebhookHandleResult> {
  const creds = await loadGatewayCredentials(organizationId);
  const result = await handleStripeWebhook(creds, rawBody, signature);
  if (result.ok) {
    await finalizeGatewayPayment(result);
  }
  return result;
}

export async function processRazorpayWebhook(
  rawBody: string,
  signature: string | undefined,
  organizationId: string,
): Promise<WebhookHandleResult> {
  const creds = await loadGatewayCredentials(organizationId);
  const result = await handleRazorpayWebhook(creds, rawBody, signature);
  if (result.ok) {
    await finalizeGatewayPayment(result);
  }
  return result;
}

export type { PaymentProvider };
