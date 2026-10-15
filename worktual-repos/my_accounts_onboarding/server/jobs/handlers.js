import {
  notifyAdminCancellationRequested,
  notifyAdminQuotationDecision,
  notifyCustomerCancellationResolved,
  notifyCustomerInvoiceApproved,
  notifyCustomerPaymentLinkFromSales,
  notifyCustomerProductRequest,
  notifyCustomerProductRequestCancelled,
  notifyPaymentReceived,
  notifyPortalCredentialsWithInvoice,
  notifyQuotationApproved,
  notifySalesQuotationApproved,
  notifySalesSupportTicketCreated,
  notifySupportTicketCreated,
} from "../notifications.js";
import {
  markEmailOutboxFailed,
  markEmailOutboxSent,
} from "../infra/emailOutbox.js";
import { executeStripeWebhookEvent } from "../payments/stripeWebhook.js";
import { executeRazorpayWebhookEvent } from "../payments/razorpayWebhook.js";
import { PAYMENT_PROVIDERS } from "../payments/constants.js";
import { pool } from "../db/pool.js";
import { processUpcomingRenewals } from "../renewals.js";
import { processScheduledSubscriptionInvoices } from "../billing/subscriptionInvoices.js";
import { invalidateMessageListCache } from "../mailCache.js";
import { fetchMailboxMessages } from "../mail.js";
import { publishMailEvent } from "../infra/events.js";
import { renewGraphSubscriptions } from "../msGraphSubscriptions.js";

const EMAIL_HANDLERS = {
  quotation_approved: (payload) => notifyQuotationApproved(payload.quotation),
  quotation_rejected: (payload) =>
    notifyAdminQuotationDecision(payload.quotation, payload.decision || "rejected"),
  payment_received: (payload) =>
    notifyPaymentReceived(payload.quotation, {
      source: payload.source || "stripe",
      portalAccess: payload.portalAccess || null,
    }),
  customer_payment_link: (payload) => notifyCustomerPaymentLinkFromSales(payload.quotation),
  customer_invoice_approved: (payload) => notifyCustomerInvoiceApproved(payload.quotation),
  sales_quotation_approved: (payload) => notifySalesQuotationApproved(payload.quotation),
  portal_credentials: (payload) =>
    notifyPortalCredentialsWithInvoice(payload.quotation, payload.portalAccess),
  support_ticket_created: (payload) =>
    notifySupportTicketCreated(payload.ticket, payload.initialMessage || null),
  sales_support_ticket_created: (payload) =>
    notifySalesSupportTicketCreated(payload.ticket, payload.initialMessage || null),
  customer_product_request: (payload) => notifyCustomerProductRequest(payload.requestRecord),
  customer_product_request_cancelled: (payload) =>
    notifyCustomerProductRequestCancelled(payload.requestRecord),
  branch_cancellation_requested: (payload) =>
    notifyAdminCancellationRequested(payload.requestRecord),
  branch_cancellation_resolved: (payload) =>
    notifyCustomerCancellationResolved(payload.requestRecord, payload.decision),
};

export async function processEmailJob(job) {
  const { outboxId, jobType, ...payload } = job.data || {};
  const handler = EMAIL_HANDLERS[jobType];

  if (!handler) {
    throw new Error(`Unknown email job type: ${jobType}`);
  }

  try {
    await handler(payload);
    if (outboxId) {
      await markEmailOutboxSent(outboxId);
    }
  } catch (error) {
    if (outboxId) {
      await markEmailOutboxFailed(outboxId, error);
    }
    throw error;
  }
}

export async function processPaymentFulfillmentJob(job) {
  const { event, provider } = job.data || {};
  if (!event) {
    throw new Error("Missing payment webhook event payload.");
  }

  if (provider === PAYMENT_PROVIDERS.RAZORPAY) {
    return executeRazorpayWebhookEvent(event);
  }

  return executeStripeWebhookEvent(event);
}

export async function processBillingSweepJob() {
  const client = await pool.connect();
  try {
    await processUpcomingRenewals(client);
    await processScheduledSubscriptionInvoices(client);
    const { processScheduledCancellations } = await import("../billing/scheduledCancellations.js");
    const scheduledCancellations = await processScheduledCancellations(client);
    const { processUnpaidGraceAlerts } = await import("../billing/unpaidGraceAlerts.js");
    const graceAlerts = await processUnpaidGraceAlerts(client);
    return { ok: true, scheduledCancellations, graceAlerts };
  } finally {
    client.release();
  }
}

export async function processMailSyncJob(job) {
  const { profile, folder = "inbox" } = job.data || {};
  if (!profile) {
    throw new Error("Missing mailbox profile for mail sync.");
  }

  invalidateMessageListCache(profile, folder);
  await fetchMailboxMessages(folder, 30, profile, { forceRefresh: true });

  await publishMailEvent("mail.updated", {
    mailboxProfile: profile,
    folder,
  });

  return { ok: true, profile, folder };
}

export async function processGraphRenewalJob() {
  return renewGraphSubscriptions();
}

export const JOB_PROCESSORS = {
  "email:send": processEmailJob,
  "payment:fulfill": processPaymentFulfillmentJob,
  "billing:sweep": processBillingSweepJob,
  "mail:sync": processMailSyncJob,
};
