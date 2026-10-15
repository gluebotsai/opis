import {
  notifyAdminCancellationRequested,
  notifyCustomerCancellationResolved,
  notifyCustomerInvoiceApproved,
  notifyCustomerOfflinePayment,
  notifyCustomerPaymentLinkFromSales,
  notifyCustomerPaymentReported,
  notifyCustomerProductRequest,
  notifyCustomerProductRequestCancelled,
  notifyPaymentReceived,
  notifyPaymentReported,
  notifyPortalCredentialsWithInvoice,
  notifyQuotationApproved,
  notifySalesBranchAddRequested,
  notifySalesGoLiveAccepted,
  notifySalesLeadAssigned,
  notifySalesQuotationApproved,
  notifySalesQuotationRejected,
  notifySalesSupportTicketCreated,
  notifySupportTicketCreated,
  notifyUatCredentials,
} from "../modules/notifications/service.js";
import {
  notifyPortalCommissionAccrued,
  notifyPortalCommissionPaid,
  notifyPortalCustomerPaid,
  notifyPortalLeadCreated,
  notifyPortalQuotationApproved,
  notifyPortalQuotationRejected,
  notifyPortalQuotationSubmitted,
} from "../modules/notifications/portal-notifications.js";
import {
  markEmailOutboxFailed,
  markEmailOutboxSent,
} from "../infra/emailOutbox.js";
import { executeStripeWebhookEvent } from "../modules/payments/stripeWebhook.js";
import { executeRazorpayWebhookEvent } from "../modules/payments/razorpayWebhook.js";
import { recordWelcomeEmailDeliveryFromNotify, recordFinanceAlertDeliveryFromNotify } from "../modules/payments/fulfillment.js";
import { PAYMENT_PROVIDERS } from "../modules/payments/constants.js";
import { pool } from "../db/pool.js";
import { processUpcomingRenewals } from "../modules/renewals/renewal-store.js";
import { processScheduledSubscriptionInvoices } from "../modules/billing/subscriptionInvoices.js";
import { invalidateMessageListCache } from "../modules/mail/cache.js";
import { fetchMailboxMessages } from "../modules/mail/mail-runtime.js";
import { publishMailEvent } from "../infra/events.js";
import { renewGraphSubscriptions } from "../modules/mail/ms-graph/subscriptions.js";
import { withTiming } from "../infra/file-logger.js";

const EMAIL_HANDLERS = {
  quotation_approved: async (payload: any) => {
    const { getQuotation } = await import("../modules/quotations/quotation-store.js");
    const quotation =
      payload.quotation ||
      (payload.quotationId
        ? await getQuotation(payload.quotationId, { includePdfs: true })
        : null);
    if (!quotation) {
      throw new Error("Quotation not found for quotation_approved email.");
    }
    return notifyQuotationApproved(quotation);
  },
  quotation_rejected: async (payload: any) => {
    const { getQuotation } = await import("../modules/quotations/quotation-store.js");
    const quotation =
      payload.quotation ||
      (payload.quotationId
        ? await getQuotation(payload.quotationId, { includePdfs: true })
        : null);
    if (!quotation) {
      throw new Error("Quotation not found for quotation_rejected email.");
    }
    return notifySalesQuotationRejected(quotation);
  },
  payment_received: async (payload: any) => {
    const { getQuotation } = await import("../modules/quotations/quotation-store.js");
    const quotation =
      payload.quotation || (payload.quotationId ? await getQuotation(payload.quotationId) : null);
    if (!quotation) {
      throw new Error("Quotation not found for payment_received email.");
    }

    const result = await notifyPaymentReceived(quotation, {
      source: payload.source || "stripe",
      portalAccess: payload.portalAccess || null,
    });
    const quotationId = payload.quotationId || quotation.id || null;
    if (quotationId) {
      await recordWelcomeEmailDeliveryFromNotify(quotationId, result, {
        channel: "queue",
        leadId: quotation.leadId || null,
      });
    }
    return result;
  },
  payment_reported: async (payload: any) => {
    const { getQuotation } = await import("../modules/quotations/quotation-store.js");
    const quotation =
      payload.quotation || (payload.quotationId ? await getQuotation(payload.quotationId) : null);
    if (!quotation) {
      throw new Error("Quotation not found for payment_reported email.");
    }

    const result = await notifyPaymentReported(quotation, {
      source: payload.source || "stripe",
    });
    const quotationId = payload.quotationId || quotation.id || null;
    if (quotationId) {
      await recordFinanceAlertDeliveryFromNotify(quotationId, result, { channel: "queue" });
    }
    return result;
  },
  customer_payment_reported: async (payload: any) => {
    const { getQuotation } = await import("../modules/quotations/quotation-store.js");
    const quotation =
      payload.quotation || (payload.quotationId ? await getQuotation(payload.quotationId) : null);
    if (!quotation) {
      throw new Error("Quotation not found for customer_payment_reported email.");
    }

    return notifyCustomerPaymentReported(quotation, {
      source: payload.source || "stripe",
    });
  },
  customer_payment_link: (payload: any) => notifyCustomerPaymentLinkFromSales(payload.quotation),
  customer_invoice_approved: (payload: any) => notifyCustomerInvoiceApproved(payload.quotation),
  quotation_offline_payment: async (payload: any) => {
    const { getQuotation } = await import("../modules/quotations/quotation-store.js");
    const quotation =
      payload.quotation ||
      (payload.quotationId
        ? await getQuotation(payload.quotationId, { includePdfs: true })
        : null);
    if (!quotation) {
      throw new Error("Quotation not found for quotation_offline_payment email.");
    }
    return notifyCustomerOfflinePayment(quotation);
  },
  sales_quotation_approved: (payload: any) => notifySalesQuotationApproved(payload.quotation),
  portal_credentials: (payload: any) =>
    notifyPortalCredentialsWithInvoice(payload.quotation, payload.portalAccess),
  support_ticket_created: (payload: any) =>
    notifySupportTicketCreated(payload.ticket, payload.initialMessage || null),
  sales_support_ticket_created: (payload: any) =>
    notifySalesSupportTicketCreated(payload.ticket, payload.initialMessage || null),
  sales_lead_assigned: (payload: any) =>
    notifySalesLeadAssigned(payload.leadId, {
      toUserId: payload.toUserId,
      assignedByUserId: payload.assignedByUserId || null,
      reason: payload.reason || "",
    }),
  customer_product_request: (payload: any) => notifyCustomerProductRequest(payload.requestRecord),
  customer_product_request_cancelled: (payload: any) =>
    notifyCustomerProductRequestCancelled(payload.requestRecord),
  branch_cancellation_requested: (payload: any) =>
    notifyAdminCancellationRequested(payload.requestRecord),
  branch_cancellation_resolved: (payload: any) =>
    notifyCustomerCancellationResolved(payload.requestRecord, payload.decision),
  branch_add_requested: (payload: any) => notifySalesBranchAddRequested(payload.requestRecord),
  uat_credentials: (payload: any) => notifyUatCredentials(payload.goLiveId || payload),
  go_live_accepted: async (payload: any) =>
    notifySalesGoLiveAccepted(payload.quotationId || payload.quotation, payload.goLiveIds || []),
  portal_commission_accrued: async (payload: any) =>
    notifyPortalCommissionAccrued(payload.entryId),
  portal_commission_paid: async (payload: any) => notifyPortalCommissionPaid(payload.entryId),
  portal_lead_created: async (payload: any) =>
    notifyPortalLeadCreated(payload.leadId, { event: payload.event || "created" }),
  portal_quotation_submitted: async (payload: any) =>
    notifyPortalQuotationSubmitted(payload.quotationId),
  portal_quotation_approved: async (payload: any) =>
    notifyPortalQuotationApproved(payload.quotationId),
  portal_quotation_rejected: async (payload: any) =>
    notifyPortalQuotationRejected(payload.quotationId),
  portal_customer_paid: async (payload: any) => notifyPortalCustomerPaid(payload.quotationId),
};

export async function processEmailJob(job: any) {
  const { outboxId, jobType, ...payload } = job.data || {};
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
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

export async function processPaymentFulfillmentJob(job: any) {
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
  return withTiming("perf", "billing.sweep", async () => {
    const client = await pool.connect();
    try {
      const pendingRenewals = await withTiming(
        "perf",
        "billing.sweep.processUpcomingRenewals",
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        () => processUpcomingRenewals(client),
      );

      const { createAutoRenewalQuotations } = await import("../modules/renewals/renewal-store.js");
      const autoRenewalQuotations = await withTiming(
        "perf",
        "billing.sweep.createAutoRenewalQuotations",
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        () => createAutoRenewalQuotations(client),
      );

      await withTiming("perf", "billing.sweep.scheduledInvoices", () =>
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        processScheduledSubscriptionInvoices(client),
      );

      const { processScheduledCancellations } = await import("../modules/billing/scheduledCancellations.js");
      const scheduledCancellations = await withTiming(
        "perf",
        "billing.sweep.scheduledCancellations",
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        () => processScheduledCancellations(client),
      );

      const { processUnpaidGraceAlerts } = await import("../modules/billing/unpaidGraceAlerts.js");
      const graceAlerts = await withTiming("perf", "billing.sweep.unpaidGraceAlerts", () =>
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        processUnpaidGraceAlerts(client),
      );

      const { processPaymentConfirmSlaDigest } = await import("../modules/payments/paymentSlaDigest.js");
      const paymentSlaDigest = await withTiming(
        "perf",
        "billing.sweep.paymentConfirmSlaDigest",
        () => processPaymentConfirmSlaDigest(),
      );

      const { expireDueUatAccess } = await import("../modules/product-go-live/go-live-store.js");
      const expiredUat = await withTiming("perf", "billing.sweep.expireUat", () =>
        expireDueUatAccess(),
      );

      let usageArchive = null;
      // Run archive/reset on the 1st of each month (local server calendar).
      if (new Date().getDate() === 1) {
        const { archiveAndResetMonthlyUsage } = await import("../modules/usage/usage-store.js");
        usageArchive = await withTiming("perf", "billing.sweep.usageArchive", () =>
          archiveAndResetMonthlyUsage(),
        );
      }

      return {
        ok: true,
        pendingRenewals,
        autoRenewalQuotations: autoRenewalQuotations.length,
        scheduledCancellations,
        graceAlerts,
        paymentSlaDigest,
        expiredUat,
        usageArchive,
      };
    } finally {
      client.release();
    }
  });
}

export async function processMailSyncJob(job: any) {
  const { profile, folder = "inbox" } = job.data || {};
  if (!profile) {
    throw new Error("Missing mailbox profile for mail sync.");
  }

  return withTiming(
    "mail",
    "mail.sync",
    async () => {
      invalidateMessageListCache(profile, folder);
      await fetchMailboxMessages(folder, 30, profile, { forceRefresh: true });

      await publishMailEvent("mail.updated", {
        mailboxProfile: profile,
        folder,
      });

      return { ok: true, profile, folder };
    },
    { profile, folder },
  );
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
