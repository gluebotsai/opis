/**
 * Payment fulfillment smoke test: approve path, mark paid, idempotency, webhook processor.
 */
import crypto from "node:crypto";

import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { applySmokeDbTimeouts } from "./lib/smokeDbTimeouts.mjs";
import { createLead, getLeadById, updateLead } from "../src/modules/leads/lead-store.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
  getQuotation,
} from "../src/modules/quotations/quotation-store.js";
import { markQuotationPaymentPaid, recordProviderPaymentReported } from "../src/modules/payments/fulfillment.js";
import { syncLeadCustomerFulfillment } from "../src/modules/payments/leadFulfillment.js";
import { validateAssignmentsForDuplicatePurchase } from "../src/modules/payments/duplicatePurchase.js";
import { processStripeWebhookEvent } from "../src/modules/payments/stripeWebhook.js";
import { PAYMENT_STATUSES, PAYMENT_PROVIDERS } from "../src/modules/payments/constants.js";
import { QUOTATION_STATUSES } from "../src/lib/statuses.js";
import {
  cleanupPaymentSmokeLead,
  cleanupPaymentSmokeTargets,
} from "./lib/smoke-payment-cleanup.mjs";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";

const marker = `pay-smoke-${Date.now()}`;
const TEST_PHONE_NUMBER = "7358021408";

function trackTarget(targets, leadId, quotationId = null) {
  if (!leadId) {
    return;
  }
  targets.push({ leadId, quotationId });
}

async function cleanupStaleTestPhoneLeads() {
  const { rows } = await pool.query(
    `SELECT id
     FROM leads
     WHERE regexp_replace(
       COALESCE(mobile_country_code, '') || COALESCE(mobile_number, ''),
       '\\D',
       '',
       'g'
     ) LIKE $1`,
    [`%${TEST_PHONE_NUMBER}`],
  );

  for (const row of rows) {
    await cleanupPaymentSmokeLead(row.id);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-payments] DATABASE_URL is not set");
    process.exit(1);
  }

  applySmokeDbTimeouts(pool);
  await migrateDatabase();

  const cleanupTargets = [];
  let leadId;
  let quotationId;
  let testLeadId;
  let testQuotationId;

  try {
    const lead = await createLead(withSmokeLeadContact({
      companyName: `Payment Smoke ${marker}`,
      billingAddress: "1 Test Street",
      workEmail: `${marker}@example.com`,
    }));
    leadId = lead.id;
    trackTarget(cleanupTargets, leadId);

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
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });
    quotationId = quotation.id;
    trackTarget(cleanupTargets, leadId, quotationId);

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
      throw new Error("Duplicate Stripe event id should be marked duplicate");
    }
    if (!duplicateWebhook.alreadyPaid) {
      throw new Error("Duplicate Stripe webhook should remain idempotent (already paid)");
    }

    console.log("[smoke-test-payments] OK — mark paid, idempotency, lead/quotation status, webhook");

    // Gateway report auto-confirms; manual report stays reported until confirm.
    const gatewayLead = await createLead(withSmokeLeadContact({
      companyName: `Gateway Auto ${marker}`,
      billingAddress: "Gateway Street",
      workEmail: `gateway-${marker}@example.com`,
      adminEmail: `gateway-admin-${marker}@example.com`,
    }));
    trackTarget(cleanupTargets, gatewayLead.id);
    const gatewayQuote = await createQuotation({
      leadId: gatewayLead.id,
      lead: gatewayLead,
      fileName: `${marker}-gateway.pdf`,
      pdfBase64: "Z2F0ZXdheQ==",
      subtotal: 200,
      grandTotal: 236,
      currency: "INR",
      assignments: [
        {
          productId: "product-pay-smoke",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });
    trackTarget(cleanupTargets, gatewayLead.id, gatewayQuote.id);
    await approveQuotation(gatewayQuote.id, "finance@test.com", "gateway auto");
    await attachPaymentToQuotation(gatewayQuote.id, {
      provider: "razorpay",
      paymentLinkUrl: `https://rzp.example/${gatewayQuote.id}`,
      paymentLinkId: `plink_gw_${marker}`,
      subtotal: 200,
      grandTotal: 236,
      currency: "INR",
      amountLabel: "INR 236.00",
      status: PAYMENT_STATUSES.PENDING,
      dryRun: true,
    });

    const gatewayReport = await recordProviderPaymentReported({
      quotationId: gatewayQuote.id,
      providerPaymentId: `pay_gw_${marker}`,
      source: PAYMENT_PROVIDERS.RAZORPAY,
      sendNotifications: false,
    });
    if (!gatewayReport.autoConfirmed) {
      throw new Error("Razorpay report should auto-confirm");
    }
    const gatewayStored = await getQuotation(gatewayQuote.id);
    if (gatewayStored.status !== QUOTATION_STATUSES.PAID) {
      throw new Error(`Expected gateway quotation Paid, got ${gatewayStored.status}`);
    }
    if (gatewayStored.payment?.status !== PAYMENT_STATUSES.PAID) {
      throw new Error(`Expected gateway payment paid, got ${gatewayStored.payment?.status}`);
    }

    const manualLead = await createLead(withSmokeLeadContact({
      companyName: `Manual Report ${marker}`,
      billingAddress: "Manual Street",
      workEmail: `manual-${marker}@example.com`,
    }));
    trackTarget(cleanupTargets, manualLead.id);
    const manualQuote = await createQuotation({
      leadId: manualLead.id,
      lead: manualLead,
      fileName: `${marker}-manual.pdf`,
      pdfBase64: "bWFudWFs",
      subtotal: 150,
      grandTotal: 177,
      currency: "INR",
      assignments: [
        {
          productId: "product-pay-smoke",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });
    trackTarget(cleanupTargets, manualLead.id, manualQuote.id);
    await approveQuotation(manualQuote.id, "finance@test.com", "manual report");
    await attachPaymentToQuotation(manualQuote.id, {
      provider: "manual",
      paymentLinkUrl: null,
      paymentLinkId: null,
      subtotal: 150,
      grandTotal: 177,
      currency: "INR",
      amountLabel: "INR 177.00",
      status: PAYMENT_STATUSES.PENDING,
      dryRun: true,
    });

    const manualReport = await recordProviderPaymentReported({
      quotationId: manualQuote.id,
      providerPaymentId: `bank_${marker}`,
      source: PAYMENT_PROVIDERS.BANK_TRANSFER,
      reportedBy: "finance@test.com",
      sendNotifications: false,
    });
    if (manualReport.autoConfirmed) {
      throw new Error("Bank transfer report must not auto-confirm");
    }
    const manualStored = await getQuotation(manualQuote.id);
    if (manualStored.payment?.status !== PAYMENT_STATUSES.REPORTED) {
      throw new Error(`Expected manual payment reported, got ${manualStored.payment?.status}`);
    }
    if (manualStored.status === QUOTATION_STATUSES.PAID) {
      throw new Error("Manual report must not mark quotation Paid yet");
    }

    console.log("[smoke-test-payments] OK — gateway auto-confirm vs manual two-step");

    await cleanupStaleTestPhoneLeads();

    const testLead = await createLead(withSmokeLeadContact({
      companyName: `Test Phone Smoke ${marker}`,
      billingAddress: "2 Test Street",
      workEmail: `testphone-${marker}@example.com`,
      mobileCountryCode: "+91",
      mobileNumber: TEST_PHONE_NUMBER,
    }));
    testLeadId = testLead.id;
    trackTarget(cleanupTargets, testLeadId);

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
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });
    testQuotationId = testQuotation.id;
    trackTarget(cleanupTargets, testLeadId, testQuotationId);
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

    const paidLead = await createLead(withSmokeLeadContact({
      companyName: `Duplicate Block ${marker}`,
      billingAddress: "3 Test Street",
      workEmail: `dup-${marker}@example.com`,
    }));
    trackTarget(cleanupTargets, paidLead.id);
    const paidQuote = await createQuotation({
      leadId: paidLead.id,
      lead: paidLead,
      fileName: `${marker}-dup.pdf`,
      pdfBase64: "ZHVw",
      subtotal: 100,
      grandTotal: 118,
      currency: "INR",
      assignments: [
        { productId: "crm", branchId: "hq", billingBranchId: "hq", changeType: "new" },
      ],
    });
    trackTarget(cleanupTargets, paidLead.id, paidQuote.id);
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
          { productId: "crm", branchId: "hq", billingBranchId: "hq", changeType: "new" },
        ],
      });
    } catch (error) {
      duplicateBlocked = error?.code === "DUPLICATE_PURCHASE";
    }
    if (!duplicateBlocked) {
      throw new Error("Duplicate new purchase should be blocked server-side");
    }
    console.log("[smoke-test-payments] OK — duplicate purchase guard");

    const leadA = await createLead(withSmokeLeadContact({
      companyName: `HQ A ${marker}`,
      billingAddress: "A Street",
      workEmail: `hqa-${marker}@example.com`,
    }));
    trackTarget(cleanupTargets, leadA.id);
    const leadB = await createLead(withSmokeLeadContact({
      companyName: `HQ B ${marker}`,
      billingAddress: "B Street",
      workEmail: `hqb-${marker}@example.com`,
    }));
    trackTarget(cleanupTargets, leadB.id);
    const quoteA = await createQuotation({
      leadId: leadA.id,
      lead: leadA,
      fileName: `${marker}-a.pdf`,
      pdfBase64: "YQ==",
      subtotal: 100,
      grandTotal: 118,
      currency: "INR",
      assignments: [
        { productId: "contact-center", branchId: "hq", billingBranchId: "hq", changeType: "new" },
      ],
    });
    trackTarget(cleanupTargets, leadA.id, quoteA.id);
    const quoteB = await createQuotation({
      leadId: leadB.id,
      lead: leadB,
      fileName: `${marker}-b.pdf`,
      pdfBase64: "Yg==",
      subtotal: 200,
      grandTotal: 236,
      currency: "INR",
      assignments: [
        { productId: "contact-center", branchId: "hq", billingBranchId: "hq", changeType: "new" },
      ],
    });
    trackTarget(cleanupTargets, leadB.id, quoteB.id);
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
    console.log("[smoke-test-payments] OK — lead-scoped active product keys");
  } catch (error) {
    console.error("[smoke-test-payments] FAILED:", error);
    process.exitCode = 1;
  } finally {
    try {
      await cleanupPaymentSmokeTargets(cleanupTargets);
    } catch (cleanupError) {
      console.error("[smoke-test-payments] Cleanup failed:", cleanupError);
      process.exitCode = 1;
    }
    await pool.end();
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();
