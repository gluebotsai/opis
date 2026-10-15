export interface EmailJob {
  to: string[];
  template: string;
  variables: Record<string, string>;
}

export interface PaymentJob {
  paymentId: string;
  provider: "stripe" | "razorpay";
  action: "reconcile" | "fulfill" | "recover";
}

export interface BillingJob {
  organizationId: string;
  subscriptionId: string;
  action: "invoice" | "renew" | "cancel" | "grace-period-check";
}

export interface MailSyncJob {
  organizationId: string;
  mailboxId: string;
  cursor?: string;
}

export interface GraphRenewalJob {
  organizationId: string;
  subscriptionId: string;
  expiresAt: string;
}

export interface QueuePayloadMap {
  email: EmailJob;
  payment: PaymentJob;
  billing: BillingJob;
  "mail-sync": MailSyncJob;
  "graph-renewal": GraphRenewalJob;
}

export type QueueName = keyof QueuePayloadMap;
