import { withTransaction } from "../../db/pool.js";
import { getLeadById, updateLeadStatus } from "../leads/lead-store.js";
import {
  ensureActiveProductsForQuotation,
  getApprovedQuotationPayment,
  resolveLeadStatusPreservingCustomer,
} from "../quotations/quotation-store.js";
import { QUOTATION_STATUSES } from "../../lib/statuses.js";
import { PAYMENT_STATUSES } from "./constants.js";
import { repairQuotationProductFulfillment } from "./fulfillment.js";
import { maybeAutoMarkTestPhonePaymentPaid } from "./testBypass.js";

/**
 * Align active_products and lead status with the latest approved/paid quotation.
 * Safe to call on every customer-facing read — fully idempotent.
 */
export async function reconcileLeadPaymentFulfillment(leadId: any) {
  const quotation = await getApprovedQuotationPayment(leadId);
  if (!quotation) {
    return { reconciled: false, reason: "no_approved_quotation" };
  }

  const isPaid = quotation.payment?.status === PAYMENT_STATUSES.PAID;

  if (isPaid) {
    const productSync = await repairQuotationProductFulfillment(quotation.id);

    await withTransaction(async (client: any) => {
      const { rows } = await client.query(
        `SELECT q.status,
                COALESCE((
                  SELECT bool_or(
                    COALESCE((pa.config->>'isRenewalQuote')::boolean, false)
                    OR LOWER(COALESCE(pa.change_type, '')) = 'renewal'
                    OR LOWER(COALESCE(pa.config->>'changeType', '')) = 'renewal'
                  )
                  FROM product_assignments pa
                  WHERE pa.quotation_id = q.id
                ), false) AS is_renewal
         FROM quotations q
         WHERE q.lead_id = $1 AND q.status <> $2`,
        [quotation.leadId, QUOTATION_STATUSES.REJECTED],
      );
      const dealRows = rows.filter((row: any) => !row.is_renewal);
      const statusRows = dealRows.length > 0 ? dealRows : rows;
      const statuses = statusRows.map((row: any) => row.status);
      const next = resolveLeadStatusPreservingCustomer(statuses, QUOTATION_STATUSES.PAID);
      await updateLeadStatus(client, quotation.leadId, next);
    });

    return {
      reconciled: true,
      quotationId: quotation.id,
      paid: true,
      productSync,
      portalAccess: productSync?.portalAccess || null,
    };
  }

  const productSync = await ensureActiveProductsForQuotation(quotation.id);
  const lead = await getLeadById(leadId);

  // Existing customers stay Paid while a newer quote is Pending Finance Review, and
  // become Partially paid only when that quote is Approved (awaiting payment).
  // Never demote them to Approved — that dropped Customers list rows and made portal
  // lifecycle look empty after finance approve.
  if (lead) {
    await withTransaction(async (client: any) => {
      const { rows } = await client.query(
        `SELECT status FROM quotations WHERE lead_id = $1 AND status <> $2`,
        [leadId, QUOTATION_STATUSES.REJECTED],
      );
      const next = resolveLeadStatusPreservingCustomer(
        rows.map((row: any) => row.status),
        QUOTATION_STATUSES.APPROVED,
      );
      if (String(lead.status || "") !== next) {
        await updateLeadStatus(client, leadId, next);
      }
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
export async function syncLeadCustomerFulfillment(leadId: any, { autoPayTestPhone = true } = {}) {
  const autoPay = autoPayTestPhone ? await maybeAutoMarkTestPhonePaymentPaid(leadId) : null;
  const reconcile = await reconcileLeadPaymentFulfillment(leadId);

  return { autoPay, reconcile };
}
