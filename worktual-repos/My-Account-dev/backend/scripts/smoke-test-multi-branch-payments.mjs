/**
 * Multi-branch payment link smoke test.
 */
import crypto from "node:crypto";

import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { createLead, getLeadById } from "../src/modules/leads/lead-store.js";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";
import {
  approveQuotation,
  attachBranchPaymentsToQuotation,
  createQuotation,
  getQuotation,
} from "../src/modules/quotations/quotation-store.js";
import {
  confirmFinancePayment,
  recordProviderPaymentReported,
} from "../src/modules/payments/fulfillment.js";
import { PAYMENT_STATUSES } from "../src/modules/payments/constants.js";
import { QUOTATION_STATUSES } from "../src/lib/statuses.js";

const marker = `mb-pay-smoke-${Date.now()}`;

async function cleanup(leadId, quotationId) {
  const client = await pool.connect();
  try {
    if (quotationId) {
      await client.query(`DELETE FROM quotation_branch_payments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM subscription_items WHERE purchase_order_id IN (
        SELECT id FROM purchase_orders WHERE quotation_id = $1
      )`, [quotationId]);
      await client.query(`DELETE FROM subscription_entitlements WHERE subscription_id IN (
        SELECT id FROM subscriptions WHERE quotation_id = $1
      )`, [quotationId]);
      await client.query(`DELETE FROM subscriptions WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM purchase_orders WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM quotation_invoices WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM quotations WHERE id = $1`, [quotationId]);
    }
    if (leadId) {
      await client.query(`DELETE FROM active_products WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM organizations WHERE source_lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM branches WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
  } finally {
    client.release();
  }
}

async function countConfirmedProducts(quotationId, billingBranchId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM active_products
     WHERE quotation_id = $1
       AND billing_branch_id = $2
       AND payment_confirmed_at IS NOT NULL`,
    [quotationId, billingBranchId],
  );
  return rows[0]?.count || 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-multi-branch-payments] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const branchBId = crypto.randomUUID();
  let leadId;
  let quotationId;

  try {
    const lead = await createLead(withSmokeLeadContact({
      companyName: `Multi Branch Pay ${marker}`,
      billingAddress: "HQ Street 1",
      workEmail: `${marker}-hq@example.com`,
      additionalAddresses: [
        {
          id: branchBId,
          label: "Branch B",
          address: "Branch B Street",
          country: "IN",
        },
      ],
    }));
    leadId = lead.id;

    const quotation = await createQuotation({
      leadId,
      lead,
      fileName: `${marker}-consolidated.pdf`,
      pdfBase64: "dGVzdA==",
      invoiceMode: "per_branch",
      subtotal: 2000,
      grandTotal: 2360,
      currency: "INR",
      assignments: [
        {
          productId: "contact-center",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
        {
          productId: "contact-center",
          branchId: branchBId,
          billingBranchId: branchBId,
          changeType: "new",
        },
      ],
      invoices: [
        {
          fileName: `${marker}-hq.pdf`,
          pdfBase64: "aHE=",
          billingBranchId: "hq",
          branchLabel: "Head office",
          subtotal: 1000,
          grandTotal: 1180,
        },
        {
          fileName: `${marker}-branch-b.pdf`,
          pdfBase64: "YnI=",
          billingBranchId: branchBId,
          branchLabel: "Branch B",
          subtotal: 1000,
          grandTotal: 1180,
        },
      ],
    });
    quotationId = quotation.id;

    await approveQuotation(quotationId, "finance@test.com", "multi-branch payment smoke");
    const issued = await attachBranchPaymentsToQuotation(quotationId, {
      parentPayment: {
        provider: "stripe",
        subtotal: 2000,
        grandTotal: 2360,
        currency: "INR",
        gstRate: 0.18,
        amountLabel: "INR 2,360.00",
        status: PAYMENT_STATUSES.PENDING,
        dryRun: true,
      },
      branchPayments: [
        {
          billingBranchId: "hq",
          branchLabel: "Head office",
          provider: "stripe",
          paymentLinkUrl: `https://checkout.stripe.example/${quotationId}/hq`,
          paymentLinkId: `plink_${marker}_hq`,
          subtotal: 1000,
          grandTotal: 1180,
          currency: "INR",
          amountLabel: "INR 1,180.00",
          status: PAYMENT_STATUSES.PENDING,
          dryRun: true,
        },
        {
          billingBranchId: branchBId,
          branchLabel: "Branch B",
          provider: "stripe",
          paymentLinkUrl: `https://checkout.stripe.example/${quotationId}/${branchBId}`,
          paymentLinkId: `plink_${marker}_branch_b`,
          subtotal: 1000,
          grandTotal: 1180,
          currency: "INR",
          amountLabel: "INR 1,180.00",
          status: PAYMENT_STATUSES.PENDING,
          dryRun: true,
        },
      ],
    });
    const stored = issued;

    const branchPayments = stored.payment?.branchPayments || [];
    if (branchPayments.length !== 2) {
      throw new Error(`Expected 2 branch payments, got ${branchPayments.length}`);
    }

    const hqPayment = branchPayments.find((entry) => entry.billingBranchId === "hq");
    const branchBPayment = branchPayments.find((entry) => entry.billingBranchId === branchBId);
    if (!hqPayment?.paymentLinkUrl || !branchBPayment?.paymentLinkUrl) {
      throw new Error("Expected payment links for both branches");
    }
    if (hqPayment.paymentLinkId === branchBPayment.paymentLinkId) {
      throw new Error("Expected distinct payment link ids per branch");
    }
    if (Number(hqPayment.grandTotal) !== 1180 || Number(branchBPayment.grandTotal) !== 1180) {
      throw new Error("Expected per-branch invoice amounts on payment links");
    }
    if (stored.payment?.paymentLinkUrl) {
      throw new Error("Parent payment link URL should be null for multi-branch quotations");
    }
    if (Number(stored.payment?.grandTotal) !== 2360) {
      throw new Error(`Expected aggregate total 2360, got ${stored.payment?.grandTotal}`);
    }

    await recordProviderPaymentReported({
      quotationId,
      billingBranchId: "hq",
      providerPaymentId: `manual_hq_${marker}`,
      source: "manual",
      reportedBy: "finance@test.com",
      sendNotifications: false,
    });

    const partialConfirm = await confirmFinancePayment({
      quotationId,
      billingBranchId: "hq",
      financeConfirmedBy: "finance@test.com",
      sendNotifications: false,
    });

    const afterFirst = await getQuotation(quotationId);
    if (afterFirst.payment?.status !== PAYMENT_STATUSES.PARTIAL) {
      throw new Error(`Expected partial parent payment, got ${afterFirst.payment?.status}`);
    }
    if (afterFirst.status !== QUOTATION_STATUSES.APPROVED) {
      throw new Error(`Expected quotation Approved after first branch, got ${afterFirst.status}`);
    }

    const hqConfirmed = await countConfirmedProducts(quotationId, "hq");
    const branchBConfirmed = await countConfirmedProducts(quotationId, branchBId);
    if (hqConfirmed < 1) {
      throw new Error("Expected HQ active products to be payment-confirmed");
    }
    if (branchBConfirmed > 0) {
      throw new Error("Branch B products should not be payment-confirmed yet");
    }

    await recordProviderPaymentReported({
      quotationId,
      billingBranchId: branchBId,
      providerPaymentId: `manual_branch_b_${marker}`,
      source: "manual",
      reportedBy: "finance@test.com",
      sendNotifications: false,
    });

    await confirmFinancePayment({
      quotationId,
      billingBranchId: branchBId,
      financeConfirmedBy: "finance@test.com",
      sendNotifications: false,
    });

    const finalQuotation = await getQuotation(quotationId);
    if (finalQuotation.status !== QUOTATION_STATUSES.PAID) {
      throw new Error(`Expected quotation Paid, got ${finalQuotation.status}`);
    }
    if (finalQuotation.payment?.status !== PAYMENT_STATUSES.PAID) {
      throw new Error(`Expected parent payment paid, got ${finalQuotation.payment?.status}`);
    }

    const leadAfter = await getLeadById(leadId);
    if (leadAfter.status !== "Paid") {
      throw new Error(`Expected lead Paid, got ${leadAfter.status}`);
    }

    const branchBConfirmedAfter = await countConfirmedProducts(quotationId, branchBId);
    if (branchBConfirmedAfter < 1) {
      throw new Error("Expected Branch B active products to be payment-confirmed after final payment");
    }

    if (!partialConfirm.billingBranchId) {
      throw new Error("Expected billingBranchId on first branch confirmation result");
    }

    console.log(
      "[smoke-test-multi-branch-payments] OK — branch links, partial fulfillment, full payment",
    );
  } finally {
    await cleanup(leadId, quotationId);
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[smoke-test-multi-branch-payments] FAILED:", error);
  process.exit(1);
});
