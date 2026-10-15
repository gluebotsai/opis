export type PaymentProvider = "stripe" | "razorpay";

export type CreatePaymentLinkInput = {
  invoiceId: string;
  organizationId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  successUrl: string;
  cancelUrl: string;
};

export type CreatePaymentLinkResult = {
  provider: PaymentProvider;
  paymentLinkUrl: string;
  paymentSessionId: string;
  expiresAt: Date | null;
};

export type GatewayCredentials = {
  stripePublishableKey?: string | null;
  stripeSecretKey?: string | null;
  stripeWebhookSecret?: string | null;
  razorpayKeyId?: string | null;
  razorpayKeySecret?: string | null;
  razorpayWebhookSecret?: string | null;
};

export type WebhookHandleResult =
  | { ok: true; invoiceId: string; transactionId: string; provider: PaymentProvider }
  | { ok: false; error: string; statusCode?: number };
