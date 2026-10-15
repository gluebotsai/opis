import { withTransaction } from "../db/pool.js";
import { getLeadById, updateLeadStatus } from "../leads.js";
import { ensureOrganizationForPaidLead } from "../organizations.js";
import { ensureActiveProductsForQuotation, getApprovedQuotationPayment } from "../quotations.js";
import { syncSubscriptionsFromQuotation } from "../subscriptions.js";
import { regenerateCustomerPortalPassword } from "../customerAuth.js";
import { QUOTATION_STATUSES } from "../statuses.js";
import { PAYMENT_STATUSES } from "./constants.js";
import { repairQuotationProductFulfillment } from "./fulfillment.js";
import { maybeAutoMarkTestPhonePaymentPaid } from "./testBypass.js";

/**
 * Align active_products and lead status with the latest approved/paid quotation.
 * Safe to call on every customer-facing read — fully idempotent.
 */
export async function reconcileLeadPaymentFulfillment(leadId) {
  const quotation = await getApprovedQuotationPayment(leadId);
  if (!quotation) {
    return { reconciled: false, reason: "no_approved_quotation" };
  }

  const isPaid = quotation.payment?.status === PAYMENT_STATUSES.PAID;

  if (isPaid) {
    const productSync = await repairQuotationProductFulfillment(quotation.id);

    let portalAccess = productSync?.portalAccess || null;
    if (!portalAccess) {
      const lead = await getLeadById(quotation.leadId);
      await withTransaction(async (client) => {
        const { organization } = await ensureOrganizationForPaidLead(quotation.leadId, client);
        if (organization && lead) {
          portalAccess = await regenerateCustomerPortalPassword(client, organization.id, {
            workEmail: lead.workEmail,
            adminEmail: lead.adminEmail,
            contactName: lead.contactName,
          });
        }
        await updateLeadStatus(client, quotation.leadId, QUOTATION_STATUSES.PAID);
      });
    } else {
      await withTransaction(async (client) => {
        await updateLeadStatus(client, quotation.leadId, QUOTATION_STATUSES.PAID);
      });
    }

    return {
      reconciled: true,
      quotationId: quotation.id,
      paid: true,
      productSync,
      portalAccess,
    };
  }

  const productSync = await ensureActiveProductsForQuotation(quotation.id);
  const lead = await getLeadById(leadId);

  if (
    lead &&
    lead.status !== QUOTATION_STATUSES.APPROVED &&
    lead.status !== QUOTATION_STATUSES.PAID
  ) {
    await withTransaction(async (client) => {
      await updateLeadStatus(client, leadId, QUOTATION_STATUSES.APPROVED);
    });
  }

  return {
    reconciled: true,
    quotationId: quotation.id,
    paid: false,
    productSync,
  };
}

/**
 * End-to-end customer fulfillment:
 * 1) optional test-phone auto-pay
 * 2) reconcile products + lead status for approved/paid quotation
 */
export async function syncLeadCustomerFulfillment(leadId, { autoPayTestPhone = true } = {}) {
  const autoPay = autoPayTestPhone ? await maybeAutoMarkTestPhonePaymentPaid(leadId) : null;
  const reconcile = await reconcileLeadPaymentFulfillment(leadId);

  return { autoPay, reconcile };
}
