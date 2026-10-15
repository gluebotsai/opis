import { pool, withTransaction } from "../db/pool.js";
import { rowToCamel, toIso } from "../db/util.js";
import { updateLeadStatus } from "../leads.js";
import { notifyPaymentReceived } from "../notifications.js";
import { queuePaymentReceivedEmail } from "../infra/notify.js";
import { publishPaymentEvent } from "../infra/events.js";
import { ensureActiveProductsForQuotation } from "../quotations.js";
import { ensureOrganizationForPaidLead } from "../organizations.js";
import { syncSubscriptionsFromQuotation } from "../subscriptions.js";
import { ensureDefaultCustomerUser, regenerateCustomerPortalPassword } from "../customerAuth.js";
import { processUpcomingRenewals } from "../renewals.js";
import { processScheduledSubscriptionInvoices } from "../billing/subscriptionInvoices.js";
import { PAYMENT_PROVIDERS, PAYMENT_STATUSES } from "./constants.js";
import { QUOTATION_STATUSES } from "../statuses.js";
import * as paymentsRepo from "../repositories/raw/payments.repo.js";
import { selectQuotationById } from "../repositories/raw/quotations.repo.js";

async function resolvePortalCredentialsForNotifyOutsideTx(productSync) {
  const portalAccess = productSync?.portalAccess;
  if (portalAccess?.temporaryPassword && portalAccess?.user?.email) {
    return {
      email: portalAccess.user.email,
      temporaryPassword: portalAccess.temporaryPassword,
    };
  }

  return null;
}

async function resolvePortalCredentialsForNotify(client, quotationRow, productSync) {
  const leadSnapshot = quotationRow.leadSnapshot;
  const lead =
    typeof leadSnapshot === "string" ? JSON.parse(leadSnapshot) : leadSnapshot || {};
  const portalAccess = productSync?.portalAccess;

  if (portalAccess?.temporaryPassword && portalAccess?.user?.email) {
    return {
      email: portalAccess.user.email,
      temporaryPassword: portalAccess.temporaryPassword,
    };
  }

  if (!portalAccess?.user?.email && !lead.workEmail && !lead.adminEmail) {
    return null;
  }

  const { organization } = await ensureOrganizationForPaidLead(quotationRow.leadId, client);
  if (!organization) {
    return null;
  }

  const regenerated = await regenerateCustomerPortalPassword(client, organization.id, {
    workEmail: lead.workEmail,
    adminEmail: lead.adminEmail,
    contactName: lead.contactName,
  });

  if (!regenerated?.temporaryPassword) {
    return null;
  }

  return {
    email: regenerated.email,
    temporaryPassword: regenerated.temporaryPassword,
  };
}

async function hydratePaymentRow(row) {
  if (!row) {
    return null;
  }

  const payment = rowToCamel(row);
  return {
    provider: payment.provider,
    paymentLinkUrl: payment.paymentLinkUrl,
    paymentLinkId: payment.paymentLinkId,
    subtotal: payment.subtotal !== null ? Number(payment.subtotal) : null,
    grandTotal: payment.grandTotal !== null ? Number(payment.grandTotal) : null,
    currency: payment.currency,
    gstRate: payment.gstRate !== null ? Number(payment.gstRate) : null,
    amountLabel: payment.amountLabel,
    status: payment.status || PAYMENT_STATUSES.PENDING,
    paidAt: toIso(payment.paidAt),
    providerPaymentId: payment.providerPaymentId || null,
    providerCustomerId: payment.providerCustomerId || null,
    failureReason: payment.failureReason || null,
    dryRun: payment.dryRun === true,
    updatedAt: toIso(payment.updatedAt),
  };
}

export async function getPaymentByQuotationId(quotationId, client = null) {
  const runner = client || pool;
  const row = await paymentsRepo.selectPaymentByQuotationId(runner, quotationId);
  return hydratePaymentRow(row);
}

export async function getPaymentByProviderPaymentId(providerPaymentId) {
  const row = await paymentsRepo.selectPaymentByProviderPaymentId(pool, providerPaymentId);
  return hydratePaymentRow(row);
}

async function loadQuotationForFulfillment(client, quotationId) {
  const row = await selectQuotationById(client, quotationId);
  return row ? rowToCamel(row) : null;
}

async function provisionOrgAdminPortalAccess(
  client,
  organizationId,
  profile,
  { resetCredentials = false } = {},
) {
  if (resetCredentials) {
    return regenerateCustomerPortalPassword(client, organizationId, profile);
  }

  return ensureDefaultCustomerUser(client, organizationId, profile);
}

async function syncQuotationProductFulfillment(
  client,
  quotationId,
  { paidAt = null, resetPortalCredentials = false } = {},
) {
  const syncResult = await ensureActiveProductsForQuotation(quotationId, client);
  await paymentsRepo.confirmActiveProductsPayment(client, quotationId);

  const quotationRow = await paymentsRepo.selectQuotationLeadIdAndSnapshot(client, quotationId);
  const leadId = quotationRow?.lead_id;

  let hubSync = null;
  let portalAccess = null;
  if (leadId) {
    const { organization } = await ensureOrganizationForPaidLead(leadId, client);
    hubSync = await syncSubscriptionsFromQuotation(quotationId, client, { paidAt });

    const leadSnapshot = quotationRow.lead_snapshot;
    const profile =
      typeof leadSnapshot === "string" ? JSON.parse(leadSnapshot) : leadSnapshot || {};
    portalAccess = await provisionOrgAdminPortalAccess(client, organization.id, profile, {
      resetCredentials: resetPortalCredentials,
    });

    try {
      await processUpcomingRenewals(client);
      await processScheduledSubscriptionInvoices(client);
    } catch {
      // Non-blocking renewal sweep.
    }
  }

  return { ...syncResult, hubSync, portalAccess };
}

/** Repair missing active_products + payment confirmation for already-paid quotations. */
export async function repairQuotationProductFulfillment(quotationId) {
  return withTransaction(async (client) => syncQuotationProductFulfillment(client, quotationId));
}

async function repairQuotationProductFulfillmentInTx(client, quotationId) {
  return syncQuotationProductFulfillment(client, quotationId);
}

/**
 * Mark a quotation payment as paid. Idempotent — safe to call multiple times.
 * @returns {{ quotation, payment, alreadyPaid: boolean, notified: boolean }}
 */
export async function markQuotationPaymentPaid({
  quotationId,
  providerPaymentId = null,
  providerCustomerId = null,
  providerEventId = null,
  source = PAYMENT_PROVIDERS.MANUAL,
  paidAt = new Date(),
  sendNotifications = true,
  deferNotifications = false,
}) {
  const result = await withTransaction(async (client) => {
    const quotationRow = await loadQuotationForFulfillment(client, quotationId);
    if (!quotationRow) {
      throw new Error(`Quotation not found: ${quotationId}`);
    }

    if (quotationRow.status === QUOTATION_STATUSES.REJECTED) {
      throw new Error("Cannot mark payment on a rejected quotation.");
    }

    if (quotationRow.status === QUOTATION_STATUSES.PENDING) {
      throw new Error("Quotation must be finance-approved before payment can be recorded.");
    }

    const existing = await paymentsRepo.selectPaymentForUpdate(client, quotationId);

    if (!existing) {
      throw new Error(`No payment record for quotation ${quotationId}`);
    }

    const alreadyPaid = existing.status === PAYMENT_STATUSES.PAID;

    if (alreadyPaid) {
      const productSync = await repairQuotationProductFulfillmentInTx(client, quotationId);

      return {
        quotation: quotationRow,
        payment: await hydratePaymentRow(existing),
        alreadyPaid: true,
        notified: false,
        productSync,
      };
    }

    const updatedPaymentRow = await paymentsRepo.updatePaymentPaid(client, [
      quotationId,
      PAYMENT_STATUSES.PAID,
      paidAt instanceof Date ? paidAt.toISOString() : paidAt,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      source !== PAYMENT_PROVIDERS.STRIPE && source !== PAYMENT_PROVIDERS.RAZORPAY ? source : null,
    ]);

    await paymentsRepo.updateQuotationStatusPaid(client, quotationId, QUOTATION_STATUSES.PAID);

    await updateLeadStatus(client, quotationRow.leadId, QUOTATION_STATUSES.PAID);
    const productSync = await syncQuotationProductFulfillment(client, quotationId, {
      paidAt: paidAt instanceof Date ? paidAt.toISOString() : paidAt,
      resetPortalCredentials: true,
    });

    const payment = await hydratePaymentRow(updatedPaymentRow);
    const leadSnapshot = quotationRow.leadSnapshot;
    const lead =
      typeof leadSnapshot === "string"
        ? JSON.parse(leadSnapshot)
        : leadSnapshot || null;

    const quotation = {
      id: quotationRow.id,
      leadId: quotationRow.leadId,
      lead,
      status: QUOTATION_STATUSES.PAID,
      submittedBy: quotationRow.submittedBy || "",
      payment,
    };

    return { quotation, payment, alreadyPaid: false, productSync };
  });

  if (result.alreadyPaid) {
    return { ...result, notified: false, notificationQueued: false };
  }

  if (!sendNotifications) {
    return { ...result, notified: false, notificationQueued: false };
  }

  if (deferNotifications) {
    try {
      const portalAccess = await resolvePortalCredentialsForNotifyOutsideTx(result.productSync);
      const { getQuotation } = await import("../quotations.js");
      const hydrated = await getQuotation(quotationId);
      await publishPaymentEvent("payment.paid", {
        quotationId,
        leadId: result.quotation.leadId,
        status: "Paid",
      });
      await queuePaymentReceivedEmail(hydrated || result.quotation, {
        source,
        portalAccess,
      });
    } catch (error) {
      console.error(
        "[payments] Payment recorded but notification queue failed:",
        error instanceof Error ? error.message : error,
      );
    }
    return { ...result, notified: false, notificationQueued: true };
  }

  try {
    const portalAccess = await resolvePortalCredentialsForNotifyOutsideTx(result.productSync);
    const { getQuotation } = await import("../quotations.js");
    const hydrated = await getQuotation(quotationId);
    await notifyPaymentReceived(hydrated || result.quotation, {
      source,
      portalAccess,
    });
    await publishPaymentEvent("payment.paid", {
      quotationId,
      leadId: result.quotation.leadId,
      status: "Paid",
    });
    return { ...result, notified: true, notificationQueued: false };
  } catch (error) {
    console.error(
      "[payments] Payment recorded but notification failed:",
      error instanceof Error ? error.message : error,
    );
    return { ...result, notified: false, notificationQueued: true };
  }
}

export async function markQuotationPaymentFailed({
  quotationId,
  failureReason = "Payment failed",
  providerEventId = null,
}) {
  return withTransaction(async (client) => {
    const row = await paymentsRepo.updatePaymentFailed(client, [
      quotationId,
      PAYMENT_STATUSES.FAILED,
      failureReason,
      providerEventId,
      PAYMENT_STATUSES.PENDING,
    ]);

    return hydratePaymentRow(row);
  });
}

export async function markQuotationPaymentRefunded({
  quotationId,
  providerEventId = null,
  failureReason = "Payment refunded",
}) {
  return withTransaction(async (client) => {
    const row = await paymentsRepo.updatePaymentRefunded(client, [
      quotationId,
      PAYMENT_STATUSES.REFUNDED,
      failureReason,
      providerEventId,
      PAYMENT_STATUSES.PAID,
    ]);

    return hydratePaymentRow(row);
  });
}

export async function resolveQuotationIdFromStripeMetadata(metadata = {}) {
  const quotationId = metadata.quotation_id || metadata.quotationId;
  if (quotationId && String(quotationId).trim()) {
    return String(quotationId).trim();
  }

  return null;
}

export async function resolveQuotationIdFromStripePaymentLink(paymentLinkId) {
  if (!paymentLinkId) {
    return null;
  }

  return paymentsRepo.selectQuotationIdByPaymentLinkId(pool, paymentLinkId);
}
