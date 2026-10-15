/**
 * Partner commission flow smoke test:
 *   slabs → bank upsert → partner lead paid → pending commission → mark paid
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import {
  createCommissionSlab,
  deleteCommissionSlab,
  getPartnerBankAccount,
  listFinanceCommissions,
  listPartnerCommissions,
  markPartnerCommissionPaid,
  upsertPartnerBankAccount,
} from "../src/modules/commissions/commission-store.js";
import { createLead } from "../src/modules/leads/lead-store.js";
import { createPartner } from "../src/modules/partners/partner-store.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
} from "../src/modules/quotations/quotation-store.js";
import { markQuotationPaymentPaid } from "../src/modules/payments/fulfillment.js";
import { PAYMENT_STATUSES } from "../src/modules/payments/constants.js";
import {
  cleanupPaymentSmokeLead,
  cleanupPaymentSmokeTargets,
} from "./lib/smoke-payment-cleanup.mjs";

const marker = `commission-smoke-${Date.now()}`;
const uniqueMobile = String(9400000000 + (Date.now() % 59999999));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanupPartner(partnerId, slabIds = []) {
  const client = await pool.connect();
  try {
    if (partnerId) {
      await client.query(`DELETE FROM partner_commission_entries WHERE partner_id = $1`, [
        partnerId,
      ]);
      await client.query(`DELETE FROM partner_bank_accounts WHERE partner_id = $1`, [partnerId]);
      await client.query(`DELETE FROM partner_users WHERE partner_id = $1`, [partnerId]);
      await client.query(`DELETE FROM partners WHERE id = $1`, [partnerId]);
    }
    for (const slabId of slabIds) {
      await client.query(`DELETE FROM commission_slabs WHERE id = $1`, [slabId]);
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-partner-commissions] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const cleanupTargets = [];
  const slabIds = [];
  let partnerId = null;
  let leadId = null;
  let quotationId = null;

  try {
    const partner = await createPartner({
      companyName: `Commission Partner ${marker}`,
      contactName: "Commission Contact",
      workEmail: `work-${marker}@partner.test`,
      country: "India",
      loginEmail: `login-${marker}@partner.test`,
      password: "PartnerSmoke1!",
      displayName: "Commission Partner",
    });
    partnerId = partner.id;

    const bank = await upsertPartnerBankAccount(partnerId, {
      accountHolderName: "Commission Contact",
      bankName: "Test Bank",
      accountNumber: "1234567890",
      ifscOrRouting: "TEST0001234",
      branchName: "MG Road",
    });
    assert(bank?.accountNumber === "1234567890", "Bank account should round-trip on upsert");
    const loadedBank = await getPartnerBankAccount(partnerId);
    assert(loadedBank?.ifscOrRouting === "TEST0001234", "Bank account should reload");

    const dealAmount = 9_876_543_210;
    const lowMax = 9_876_543_099.99;
    const highMin = 9_876_543_100;

    const slabLow = await createCommissionSlab({
      country: "India",
      minAmount: 9_876_540_000,
      maxAmount: lowMax,
      ratePercent: 5,
      sortOrder: 91001,
      isActive: true,
      currency: "INR",
    });
    slabIds.push(slabLow.id);

    const slabHigh = await createCommissionSlab({
      country: "India",
      minAmount: highMin,
      maxAmount: 9_876_549_999,
      ratePercent: 8,
      sortOrder: 91002,
      isActive: true,
      currency: "INR",
    });
    slabIds.push(slabHigh.id);

    const lead = await createLead(
      {
        companyName: `Commission Co ${marker}`,
        industryType: "Technology & Software",
        businessType: "B2B",
        country: "India",
        companySize: "11-50 employees",
        contactName: "Deal Contact",
        designation: "CEO",
        workEmail: `deal-${marker}@customer.test`,
        adminEmail: `admin-${marker}@customer.test`,
        billingAddress: "1 Commission Street",
        taxNumber: `29CMN${String(Date.now()).slice(-7)}Z1`,
        state: "Karnataka",
        mobileCountryCode: "+91",
        mobileNumber: uniqueMobile,
      },
      { partnerId },
    );
    leadId = lead.id;
    cleanupTargets.push({ leadId });

    const expectedRate = 8;
    const expectedCommission = Number(((dealAmount * expectedRate) / 100).toFixed(2));

    const quotation = await createQuotation({
      leadId,
      lead,
      fileName: `${marker}.pdf`,
      pdfBase64: "dGVzdA==",
      subtotal: dealAmount,
      grandTotal: dealAmount,
      currency: "INR",
      assignments: [
        {
          productId: "product-commission-smoke",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });
    quotationId = quotation.id;
    cleanupTargets.push({ leadId, quotationId });

    await approveQuotation(quotationId, "finance@test.com", "approved for commission smoke");
    await attachPaymentToQuotation(quotationId, {
      provider: "manual",
      paymentLinkUrl: null,
      paymentLinkId: null,
      subtotal: dealAmount,
      grandTotal: dealAmount,
      currency: "INR",
      amountLabel: `INR ${dealAmount.toLocaleString("en-IN")}`,
      status: PAYMENT_STATUSES.PENDING,
      dryRun: true,
    });

    const paid = await markQuotationPaymentPaid({
      quotationId,
      source: "manual",
      sendNotifications: false,
      financeConfirmedBy: "finance-smoke@test.com",
    });
    assert(!paid.alreadyPaid, "First confirm should not already be paid");
    assert(paid.payment?.status === PAYMENT_STATUSES.PAID, "Payment should be paid");

    const financePending = await listFinanceCommissions({ status: "pending" });
    const pendingEntry = financePending.find((entry) => entry.quotationId === quotationId);
    assert(pendingEntry, "Pending commission entry should exist after finance confirm");
    assert(pendingEntry.partnerId === partnerId, "Commission should belong to partner");
    assert(
      pendingEntry.dealAmount === dealAmount,
      `Deal amount expected ${dealAmount}, got ${pendingEntry.dealAmount}`,
    );
    assert(
      pendingEntry.ratePercent === expectedRate,
      `Rate expected ${expectedRate}, got ${pendingEntry.ratePercent}`,
    );
    assert(
      pendingEntry.commissionAmount === expectedCommission,
      `Commission expected ${expectedCommission}, got ${pendingEntry.commissionAmount}`,
    );

    const partnerBefore = await listPartnerCommissions(partnerId);
    assert(
      partnerBefore.summary.pendingTotal === expectedCommission,
      "Partner pending total should match commission",
    );
    assert(
      partnerBefore.entries.some(
        (entry) => entry.quotationId === quotationId && entry.status === "pending",
      ),
      "Partner list should show pending entry",
    );

    const paidEntry = await markPartnerCommissionPaid(pendingEntry.id, {
      paidBy: "finance-smoke@test.com",
      payoutReference: `UTR-${marker}`,
      notes: "Smoke payout",
    });
    assert(paidEntry.status === "paid", "Commission should be marked paid");
    assert(paidEntry.payoutReference === `UTR-${marker}`, "Payout reference should persist");

    const partnerAfter = await listPartnerCommissions(partnerId);
    assert(
      partnerAfter.summary.paidTotal === expectedCommission,
      "Partner paid total should match after mark-paid",
    );
    assert(
      partnerAfter.entries.some(
        (entry) => entry.quotationId === quotationId && entry.status === "paid",
      ),
      "Partner list should show paid entry",
    );

    const secondPaid = await markQuotationPaymentPaid({
      quotationId,
      source: "manual",
      sendNotifications: false,
    });
    assert(secondPaid.alreadyPaid, "Second confirm should be idempotent");
    const financeAll = await listFinanceCommissions({});
    const matching = financeAll.filter((entry) => entry.quotationId === quotationId);
    assert(matching.length === 1, "Commission accrual must remain unique per quotation");

    console.log(
      "[smoke-test-partner-commissions] OK — slabs, bank, accrue, mark-paid, partner visibility",
    );
  } finally {
    await cleanupPaymentSmokeTargets(cleanupTargets);
    for (const slabId of [...slabIds].reverse()) {
      try {
        await deleteCommissionSlab(slabId);
      } catch {
        // entry may still reference slab briefly; force delete below
      }
    }
    await cleanupPartner(partnerId, slabIds);
    if (leadId) {
      await cleanupPaymentSmokeLead(leadId, quotationId);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("[smoke-test-partner-commissions] FAILED", error);
    process.exit(1);
  });
