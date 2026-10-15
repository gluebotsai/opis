/**
 * Subscription billing smoke test: proration rules, invoice persistence, scheduler.
 */
import "../server/load-env.js";
import crypto from "node:crypto";

import { migrateDatabase } from "../server/db/migrate.js";
import { pool } from "../server/db/pool.js";
import { createLead, getLeadById } from "../server/leads.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
} from "../server/quotations.js";
import { markQuotationPaymentPaid } from "../server/payments/fulfillment.js";
import { PAYMENT_STATUSES } from "../server/payments/constants.js";
import { buildInitialSubscriptionInvoices } from "../server/billing/subscriptionInvoices.js";
import { processScheduledSubscriptionInvoices } from "../server/billing/subscriptionInvoices.js";
import { calculateProratedAmount } from "../server/billing/amounts.js";
import {
  countRemainingDays,
  getInvoice2GenerationDate,
  getServicePeriodEndForInvoice1,
  getServicePeriodForInvoice2,
  getServicePeriodStart,
  toDateString,
} from "../server/billing/dates.js";

const marker = `billing-smoke-${Date.now()}`;
const MONTHLY_PRICE = 30000;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertClose(actual, expected, label) {
  if (Math.abs(actual - expected) > 0.01) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function runDateRuleTests() {
  const cases = [
    {
      purchase: "2026-01-15",
      inv1Start: "2026-01-16",
      inv1End: "2026-01-31",
      inv1Days: 16,
      inv2Start: "2026-02-01",
      inv2End: "2026-02-28",
      inv2Gen: "2026-01-20",
      inv2Status: "scheduled",
    },
    {
      purchase: "2026-01-25",
      inv1Start: "2026-01-26",
      inv1End: "2026-01-31",
      inv1Days: 6,
      inv2Start: "2026-02-01",
      inv2End: "2026-02-28",
      inv2Gen: "2026-01-25",
      inv2Status: "generated",
    },
    {
      purchase: "2026-01-28",
      inv1Start: "2026-01-29",
      inv1End: "2026-01-31",
      inv1Days: 3,
      inv2Start: "2026-02-01",
      inv2End: "2026-02-28",
      inv2Gen: "2026-01-28",
      inv2Status: "generated",
    },
    {
      purchase: "2026-01-20",
      inv1Start: "2026-01-21",
      inv1End: "2026-01-31",
      inv1Days: 11,
      inv2Start: "2026-02-01",
      inv2End: "2026-02-28",
      inv2Gen: "2026-01-20",
      inv2Status: "scheduled",
    },
  ];

  for (const testCase of cases) {
    const purchase = testCase.purchase;
    const start = getServicePeriodStart(purchase);
    const end = getServicePeriodEndForInvoice1(purchase);
    const inv2 = getServicePeriodForInvoice2(purchase);

    assertEqual(toDateString(start), testCase.inv1Start, `${purchase} invoice1 start`);
    assertEqual(toDateString(end), testCase.inv1End, `${purchase} invoice1 end`);
    assertEqual(countRemainingDays(start, end), testCase.inv1Days, `${purchase} invoice1 days`);
    assertEqual(toDateString(inv2.start), testCase.inv2Start, `${purchase} invoice2 start`);
    assertEqual(toDateString(inv2.end), testCase.inv2End, `${purchase} invoice2 end`);
    assertEqual(
      toDateString(getInvoice2GenerationDate(purchase)),
      testCase.inv2Gen,
      `${purchase} invoice2 generation`,
    );

    const invoices = buildInitialSubscriptionInvoices({
      purchaseDate: purchase,
      monthlyPrice: MONTHLY_PRICE,
    });
    assertEqual(invoices[1].status, testCase.inv2Status, `${purchase} invoice2 status`);
    assertClose(
      invoices[0].subtotal,
      calculateProratedAmount(MONTHLY_PRICE, testCase.inv1Days),
      `${purchase} prorated subtotal`,
    );
    assertClose(invoices[1].subtotal, MONTHLY_PRICE, `${purchase} full monthly subtotal`);
  }

  const leapYearInvoices = buildInitialSubscriptionInvoices({
    purchaseDate: "2024-01-15",
    monthlyPrice: MONTHLY_PRICE,
  });
  assertEqual(leapYearInvoices[1].servicePeriodEnd, "2024-02-29", "leap year february end");
}

async function cleanup(leadId, quotationId) {
  const client = await pool.connect();
  try {
    if (quotationId) {
      await client.query(
        `DELETE FROM subscription_invoices
         WHERE subscription_id IN (SELECT id FROM subscriptions WHERE quotation_id = $1)`,
        [quotationId],
      );
      await client.query(`DELETE FROM subscription_items WHERE purchase_order_id IN (
        SELECT id FROM purchase_orders WHERE quotation_id = $1
      )`, [quotationId]);
      await client.query(`DELETE FROM subscription_entitlements WHERE subscription_id IN (
        SELECT id FROM subscriptions WHERE quotation_id = $1
      )`, [quotationId]);
      await client.query(`DELETE FROM renewal_events WHERE subscription_id IN (
        SELECT id FROM subscriptions WHERE quotation_id = $1
      )`, [quotationId]);
      await client.query(`DELETE FROM subscriptions WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM purchase_orders WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_summary_items WHERE quotation_id = $1`, [quotationId]);
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

async function runIntegrationTest() {
  const lead = await createLead({
    companyName: `Billing Smoke ${marker}`,
    billingAddress: "1 Test Street",
    workEmail: `${marker}@example.com`,
  });

  const quotation = await createQuotation({
    leadId: lead.id,
    lead,
    fileName: `${marker}.pdf`,
    pdfBase64: "dGVzdA==",
    subtotal: 16000,
    grandTotal: 18880,
    currency: "INR",
    assignments: [
      {
        productId: "product-billing-smoke",
        branchId: "hq",
        billingTargetId: "hq",
        changeType: "new",
        config: {
          billingCycle: "monthly",
          monthlyBasePrice: MONTHLY_PRICE,
          pricingMode: "crm",
        },
      },
    ],
    productSummary: [
      {
        productId: "product-billing-smoke",
        priceLabel: `INR ${MONTHLY_PRICE.toLocaleString("en-IN")}/month`,
      },
    ],
  });

  await approveQuotation(quotation.id, "finance@test.com", "approved for billing test");
  await attachPaymentToQuotation(quotation.id, {
    provider: "stripe",
    paymentLinkUrl: `https://checkout.stripe.example/${quotation.id}`,
    paymentLinkId: `plink_${marker}`,
    subtotal: 16000,
    grandTotal: 18880,
    currency: "INR",
    amountLabel: "INR 18,880.00",
    status: PAYMENT_STATUSES.PENDING,
    dryRun: true,
  });

  const paidAt = new Date("2026-01-15T10:00:00.000Z");
  const paid = await markQuotationPaymentPaid({
    quotationId: quotation.id,
    providerPaymentId: `pi_${marker}`,
    source: "manual",
    paidAt,
    sendNotifications: false,
  });

  if (!paid.productSync?.hubSync?.invoicesBySubscription) {
    throw new Error("Expected invoicesBySubscription in hub sync result");
  }

  const subscriptionIds = Object.keys(paid.productSync.hubSync.invoicesBySubscription);
  if (subscriptionIds.length !== 1) {
    throw new Error(`Expected 1 subscription with invoices, got ${subscriptionIds.length}`);
  }

  const invoices = paid.productSync.hubSync.invoicesBySubscription[subscriptionIds[0]];
  if (invoices.length !== 2) {
    throw new Error(`Expected 2 invoices, got ${invoices.length}`);
  }

  assertEqual(invoices[0].sequence, 1, "invoice1 sequence");
  assertEqual(invoices[0].status, "generated", "invoice1 status");
  assertEqual(invoices[0].servicePeriodStart, "2026-01-16", "invoice1 service start");
  assertEqual(invoices[0].remainingDays, 16, "invoice1 remaining days");
  assertClose(invoices[0].subtotal, 16000, "invoice1 subtotal");
  assertClose(invoices[0].grandTotal, 18880, "invoice1 grand total");

  assertEqual(invoices[1].sequence, 2, "invoice2 sequence");
  assertEqual(invoices[1].generationDate, "2026-01-20", "invoice2 generation date");
  assertEqual(invoices[1].servicePeriodStart, "2026-02-01", "invoice2 service start");
  assertClose(invoices[1].subtotal, MONTHLY_PRICE, "invoice2 subtotal");

  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE subscription_invoices
       SET status = 'scheduled', generation_date = CURRENT_DATE - INTERVAL '1 day'
       WHERE id = $1`,
      [invoices[1].id],
    );
  } finally {
    client.release();
  }

  const promoted = await processScheduledSubscriptionInvoices();
  const promotedInvoice = promoted.find((entry) => entry.id === invoices[1].id);
  if (!promotedInvoice || promotedInvoice.status !== "generated") {
    throw new Error("Expected scheduled invoice 2 to be promoted to generated");
  }

  const refreshedLead = await getLeadById(lead.id);
  if (refreshedLead.status !== "Paid") {
    throw new Error(`Expected lead Paid, got ${refreshedLead.status}`);
  }

  return { leadId: lead.id, quotationId: quotation.id };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-billing] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();
  runDateRuleTests();

  let leadId;
  let quotationId;

  try {
    const result = await runIntegrationTest();
    leadId = result.leadId;
    quotationId = result.quotationId;
    console.log("[smoke-test-billing] OK — proration rules, invoice persistence, scheduler");
  } catch (error) {
    console.error("[smoke-test-billing] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await cleanup(leadId, quotationId);
    await pool.end();
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();
