/**
 * Payment fulfillment smoke test: approve path, mark paid, idempotency, webhook processor.
 */
import crypto from "node:crypto";

import "../server/load-env.js";
import { migrateDatabase } from "../server/db/migrate.js";
import { pool } from "../server/db/pool.js";
import { createLead, getLeadById, updateLead } from "../server/leads.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
  getQuotation,
} from "../server/quotations.js";
import { markQuotationPaymentPaid } from "../server/payments/fulfillment.js";
import { syncLeadCustomerFulfillment } from "../server/payments/leadFulfillment.js";
import { validateAssignmentsForDuplicatePurchase } from "../server/payments/duplicatePurchase.js";
import { processStripeWebhookEvent } from "../server/payments/stripeWebhook.js";
import { PAYMENT_STATUSES } from "../server/payments/constants.js";
import { QUOTATION_STATUSES } from "../server/statuses.js";

const marker = `pay-smoke-${Date.now()}`;

async function cleanup(leadId, quotationId) {
  const client = await pool.connect();
  try {
    if (quotationId) {
      await client.query(
        `DELETE FROM subscription_invoices
         WHERE subscription_id IN (SELECT id FROM subscriptions WHERE quotation_id = $1)`,
        [quotationId],
      );
      await client.query(
        `DELETE FROM subscription_items WHERE purchase_order_id IN (
          SELECT id FROM purchase_orders WHERE quotation_id = $1
        )`,
        [quotationId],
      );
      await client.query(
        `DELETE FROM subscription_entitlements WHERE subscription_id IN (
          SELECT id FROM subscriptions WHERE quotation_id = $1
        )`,
        [quotationId],
      );
      await client.query(
        `DELETE FROM renewal_events WHERE subscription_id IN (
          SELECT id FROM subscriptions WHERE quotation_id = $1
        )`,
        [quotationId],
      );
      await client.query(`DELETE FROM subscriptions WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM purchase_orders WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM payment_webhook_events WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_summary_items WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-payments] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  let leadId;
  let quotationId;
  let testLeadId;
  let testQuotationId;

  try {
    const lead = await createLead({
      companyName: `Payment Smoke ${marker}`,
      billingAddress: "1 Test Street",
      workEmail: `${marker}@example.com`,
    });
    leadId = lead.id;

    const quotation = await createQuotation({
      leadId,
      lead,
      fileName: `${marker}.pdf`,
      pdfBase64: "dGVzdA==",
      subtotal: 1000,
      grandTotal: 1180,
      currency: "INR",
      assignments: [
        {
          productId: "product-pay-smoke",
          branchId: "hq",
          billingTargetId: "hq",
          changeType: "new",
        },
      ],
    });
    quotationId = quotation.id;

    await approveQuotation(quotationId, "finance@test.com", "approved for payment test");

    await attachPaymentToQuotation(quotationId, {
      provider: "stripe",
      paymentLinkUrl: `https://checkout.stripe.example/${quotationId}`,
      paymentLinkId: `plink_${marker}`,
      subtotal: 1000,
      grandTotal: 1180,
      currency: "INR",
      amountLabel: "INR 1,180.00",
      status: PAYMENT_STATUSES.PENDING,
      dryRun: true,
    });

    const firstPaid = await markQuotationPaymentPaid({
      quotationId,
      providerPaymentId: `pi_${marker}`,
      source: "manual",
      sendNotifications: false,
    });

    if (firstPaid.alreadyPaid) {
      throw new Error("First mark-paid should not be already paid");
    }

    const secondPaid = await markQuotationPaymentPaid({
      quotationId,
      providerPaymentId: `pi_${marker}`,
      source: "manual",
      sendNotifications: false,
    });

    if (!secondPaid.alreadyPaid) {
      throw new Error("Second mark-paid should be idempotent");
    }

    const stored = await getQuotation(quotationId);
    if (stored.status !== QUOTATION_STATUSES.PAID) {
      throw new Error(`Expected quotation Paid, got ${stored.status}`);
    }
    if (stored.payment?.status !== PAYMENT_STATUSES.PAID) {
      throw new Error(`Expected payment paid, got ${stored.payment?.status}`);
    }

    const refreshedLead = await getLeadById(leadId);
    if (refreshedLead.status !== "Paid") {
      throw new Error(`Expected lead Paid, got ${refreshedLead.status}`);
    }
    if (!refreshedLead.activeProducts?.length) {
      throw new Error("Expected active_products after mark-paid");
    }

    await updateLead(leadId, { productDraft: null });

    const eventId = `evt_${crypto.randomUUID()}`;
    const stripeEvent = {
      id: eventId,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${marker}`,
          payment_status: "paid",
          payment_intent: `pi_webhook_${marker}`,
          metadata: { quotation_id: quotationId, lead_id: leadId },
        },
      },
    };

    const webhookResult = await processStripeWebhookEvent(stripeEvent);
    if (!webhookResult.alreadyPaid) {
      throw new Error("Webhook on already-paid quotation should be idempotent");
    }

    const duplicateWebhook = await processStripeWebhookEvent(stripeEvent);
    if (!duplicateWebhook.duplicate) {
      throw new Error("Duplicate Stripe event id should be ignored");
    }

    console.log("[smoke-test-payments] OK — mark paid, idempotency, lead/quotation status, webhook");

    const testLead = await createLead({
      companyName: `Test Phone Smoke ${marker}`,
      billingAddress: "2 Test Street",
      workEmail: `testphone-${marker}@example.com`,
      mobileCountryCode: "+91",
      mobileNumber: "7358021408",
    });
    testLeadId = testLead.id;

    const testQuotation = await createQuotation({
      leadId: testLeadId,
      lead: testLead,
      fileName: `${marker}-testphone.pdf`,
      pdfBase64: "dGVzdA==",
      subtotal: 500,
      grandTotal: 590,
      currency: "INR",
      assignments: [
        {
          productId: "contact-center",
          branchId: "hq",
          billingTargetId: "hq",
          changeType: "new",
        },
      ],
    });
    testQuotationId = testQuotation.id;
    await approveQuotation(testQuotationId, "finance@test.com", "test phone");
    await attachPaymentToQuotation(testQuotationId, {
      provider: "stripe",
      paymentLinkUrl: `https://checkout.stripe.example/test-${testQuotationId}`,
      paymentLinkId: `plink_test_${marker}`,
      subtotal: 500,
      grandTotal: 590,
      currency: "INR",
      amountLabel: "INR 590.00",
      status: PAYMENT_STATUSES.PENDING,
      dryRun: true,
    });

    const autoPaid = await syncLeadCustomerFulfillment(testLeadId);
    if (!autoPaid.autoPay?.testPhone) {
      throw new Error("Test phone should auto-mark payment");
    }

    const testLeadAfter = await getLeadById(testLeadId);
    if (testLeadAfter.status !== "Paid" || !testLeadAfter.activeProducts?.length) {
      throw new Error("Test phone expected Paid lead with active_products");
    }
    console.log("[smoke-test-payments] OK — test phone auto-pay");

    const paidLead = await createLead({
      companyName: `Duplicate Block ${marker}`,
      billingAddress: "3 Test Street",
      workEmail: `dup-${marker}@example.com`,
    });
    const paidQuote = await createQuotation({
      leadId: paidLead.id,
      lead: paidLead,
      fileName: `${marker}-dup.pdf`,
      pdfBase64: "ZHVw",
      subtotal: 100,
      grandTotal: 118,
      currency: "INR",
      assignments: [
        { productId: "crm", branchId: "hq", billingTargetId: "hq", changeType: "new" },
      ],
    });
    await approveQuotation(paidQuote.id, "finance@test.com", "dup seed");
    await attachPaymentToQuotation(paidQuote.id, {
      provider: "stripe",
      paymentLinkUrl: `https://checkout.stripe.example/dup-${paidQuote.id}`,
      paymentLinkId: `plink_dup_${marker}`,
      subtotal: 100,
      grandTotal: 118,
      currency: "INR",
      amountLabel: "INR 118.00",
      status: PAYMENT_STATUSES.PENDING,
      dryRun: true,
    });
    await markQuotationPaymentPaid({
      quotationId: paidQuote.id,
      sendNotifications: false,
    });

    let duplicateBlocked = false;
    try {
      await createQuotation({
        leadId: paidLead.id,
        lead: paidLead,
        fileName: `${marker}-dup2.pdf`,
        pdfBase64: "ZHVwMg==",
        subtotal: 100,
        grandTotal: 118,
        currency: "INR",
        assignments: [
          { productId: "crm", branchId: "hq", billingTargetId: "hq", changeType: "new" },
        ],
      });
    } catch (error) {
      duplicateBlocked = error?.code === "DUPLICATE_PURCHASE";
    }
    if (!duplicateBlocked) {
      throw new Error("Duplicate new purchase should be blocked server-side");
    }
    await cleanup(paidLead.id, paidQuote.id);
    console.log("[smoke-test-payments] OK — duplicate purchase guard");

    const leadA = await createLead({
      companyName: `HQ A ${marker}`,
      billingAddress: "A Street",
      workEmail: `hqa-${marker}@example.com`,
    });
    const leadB = await createLead({
      companyName: `HQ B ${marker}`,
      billingAddress: "B Street",
      workEmail: `hqb-${marker}@example.com`,
    });
    const quoteA = await createQuotation({
      leadId: leadA.id,
      lead: leadA,
      fileName: `${marker}-a.pdf`,
      pdfBase64: "YQ==",
      subtotal: 100,
      grandTotal: 118,
      currency: "INR",
      assignments: [
        { productId: "contact-center", branchId: "hq", billingTargetId: "hq", changeType: "new" },
      ],
    });
    const quoteB = await createQuotation({
      leadId: leadB.id,
      lead: leadB,
      fileName: `${marker}-b.pdf`,
      pdfBase64: "Yg==",
      subtotal: 200,
      grandTotal: 236,
      currency: "INR",
      assignments: [
        { productId: "contact-center", branchId: "hq", billingTargetId: "hq", changeType: "new" },
      ],
    });
    await approveQuotation(quoteA.id, "finance@test.com", "a");
    await approveQuotation(quoteB.id, "finance@test.com", "b");
    const leadAAfter = await getLeadById(leadA.id);
    const leadBAfter = await getLeadById(leadB.id);
    if (!leadAAfter.activeProducts?.length || !leadBAfter.activeProducts?.length) {
      throw new Error("Both HQ leads should have active products after approve");
    }
    if (leadAAfter.activeProducts[0].key === leadBAfter.activeProducts[0].key) {
      throw new Error("Active product keys must be lead-scoped");
    }
    await cleanup(leadA.id, quoteA.id);
    await cleanup(leadB.id, quoteB.id);
    console.log("[smoke-test-payments] OK — lead-scoped active product keys");
  } catch (error) {
    console.error("[smoke-test-payments] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await cleanup(leadId, quotationId);
    await cleanup(testLeadId, testQuotationId);
    await pool.end();
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();
