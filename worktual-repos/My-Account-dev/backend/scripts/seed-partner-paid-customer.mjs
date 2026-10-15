/**
 * Seed (kept in DB): partner → partner lead → quotation → finance approve + pay
 * → customer portal user + partner commission entry.
 *
 * Usage: pnpm exec tsx scripts/seed-partner-paid-customer.mjs
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import {
  createCommissionSlab,
  listFinanceCommissions,
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

const stamp = Date.now();
const marker = `seed-partner-${stamp}`;
const mobile = String(9500000000 + (stamp % 49999999));

const PARTNER_PASSWORD = "Aa1!PartnerSeed99";
const CUSTOMER_EMAIL = `customer-${marker}@customer.test`;

async function resolveProductId() {
  const { rows } = await pool.query(
    `SELECT id, name
     FROM pricing_products
     WHERE COALESCE(is_active, TRUE) = TRUE
     ORDER BY name
     LIMIT 5`,
  ).catch(async () => {
    const fallback = await pool.query(
      `SELECT DISTINCT product_id AS id, product_id AS name
       FROM product_assignments
       WHERE product_id IS NOT NULL AND product_id <> ''
       LIMIT 5`,
    );
    return fallback;
  });

  if (rows[0]?.id) {
    return { productId: rows[0].id, productName: rows[0].name || rows[0].id };
  }

  return { productId: "contact-center", productName: "Contact Center" };
}

async function ensureIndiaSlabForDeal(dealAmount) {
  const { rows } = await pool.query(
    `SELECT id, min_amount, max_amount FROM commission_slabs
     WHERE country = 'India'
       AND is_active = TRUE
       AND min_amount <= $1
       AND (max_amount IS NULL OR max_amount >= $1)
     ORDER BY sort_order, min_amount
     LIMIT 1`,
    [dealAmount],
  );
  if (rows[0]?.id) {
    return rows[0].id;
  }
  const slab = await createCommissionSlab({
    country: "India",
    minAmount: 0,
    maxAmount: 999_999_999,
    ratePercent: 5,
    sortOrder: 1,
    isActive: true,
    currency: "INR",
  });
  return slab.id;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed-partner-paid-customer] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();
  const { productId, productName } = await resolveProductId();

  const dealAmount = 125000;
  const implementationFee = 25000;
  const subscriptionAmount = 100000;
  const grandTotal = dealAmount;
  await ensureIndiaSlabForDeal(dealAmount);

  const partner = await createPartner({
    companyName: `Seed Partner Co ${stamp}`,
    contactName: "Seed Partner Contact",
    workEmail: `work-${marker}@partner.test`,
    country: "India",
    loginEmail: `portal-${marker}@partner.test`,
    password: PARTNER_PASSWORD,
    displayName: "Seed Partner Contact",
  });

  await upsertPartnerBankAccount(partner.id, {
    accountHolderName: "Seed Partner Contact",
    bankName: "HDFC Bank",
    accountNumber: "50100123456789",
    ifscOrRouting: "HDFC0001234",
    branchName: "Chennai",
  });

  const lead = await createLead(
    {
      companyName: `Seed Customer ${stamp}`,
      industryType: "Technology & Software",
      businessType: "B2B",
      country: "India",
      companySize: "11-50 employees",
      contactName: "Seed Customer Admin",
      designation: "CEO",
      workEmail: CUSTOMER_EMAIL,
      adminEmail: CUSTOMER_EMAIL,
      billingAddress: "12 Seed Street, Bengaluru",
      taxNumber: `29AAAAA${String(stamp).slice(-4)}A1Z5`,
      state: "Karnataka",
      mobileCountryCode: "+91",
      mobileNumber: mobile,
    },
    { partnerId: partner.id },
  );

  const quotation = await createQuotation({
    leadId: lead.id,
    lead,
    fileName: `${marker}.pdf`,
    pdfBase64: "dGVzdA==",
    subtotal: grandTotal,
    grandTotal,
    currency: "INR",
    notes: "Seed quote: implementation + product subscription",
    assignments: [
      {
        productId,
        branchId: "hq",
        billingBranchId: "hq",
        changeType: "new",
        config: {
          planName: `${productName} Annual`,
          implementationEnabled: true,
          implementationFee,
          implementationCost: implementationFee,
          implementationPurchased: false,
          basePrice: subscriptionAmount,
          billingCycle: "annual",
          currency: "INR",
        },
      },
    ],
  });

  await approveQuotation(
    quotation.id,
    "onboarding.finance@worktual.com",
    "Approved seeded partner customer quote",
  );
  await attachPaymentToQuotation(quotation.id, {
    provider: "manual",
    paymentLinkUrl: null,
    paymentLinkId: null,
    subtotal: grandTotal,
    grandTotal,
    currency: "INR",
    amountLabel: `INR ${grandTotal.toLocaleString("en-IN")}`,
    status: PAYMENT_STATUSES.PENDING,
    dryRun: true,
  });

  const paid = await markQuotationPaymentPaid({
    quotationId: quotation.id,
    source: "manual",
    sendNotifications: false,
    financeConfirmedBy: "onboarding.finance@worktual.com",
  });

  const commissions = await listFinanceCommissions({ status: "pending" });
  const commission = commissions.find((entry) => entry.quotationId === quotation.id) || null;

  const { rows: orgs } = await pool.query(
    `SELECT id, source_lead_id, company_name, tenant_id, lifecycle_status, created_at
     FROM organizations
     WHERE source_lead_id = $1
     LIMIT 1`,
    [lead.id],
  );
  const { rows: customers } = await pool.query(
    `SELECT id, email, display_name, organization_id
     FROM customer_users
     WHERE organization_id = $1 OR email = $2
     ORDER BY created_at DESC
     LIMIT 5`,
    [orgs[0]?.id || null, CUSTOMER_EMAIL],
  );
  const { rows: activeProducts } = await pool.query(
    `SELECT key, product_id, branch_id
     FROM active_products
     WHERE lead_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [lead.id],
  );

  const summary = {
    partner: {
      id: partner.id,
      companyName: partner.companyName,
      loginEmail: `portal-${marker}@partner.test`,
      password: PARTNER_PASSWORD,
      country: "India",
    },
    lead: {
      id: lead.id,
      companyName: lead.companyName,
      tenantId: lead.tenantId,
      workEmail: CUSTOMER_EMAIL,
      partnerId: partner.id,
    },
    quotation: {
      id: quotation.id,
      grandTotal,
      currency: "INR",
      productId,
      implementationFee,
      subscriptionAmount,
      paymentStatus: paid.payment?.status || null,
      alreadyPaid: Boolean(paid.alreadyPaid),
    },
    organization: orgs[0] || null,
    customerUsers: customers,
    activeProducts,
    commission: commission
      ? {
          id: commission.id,
          status: commission.status,
          dealAmount: commission.dealAmount,
          ratePercent: commission.ratePercent,
          commissionAmount: commission.commissionAmount,
        }
      : null,
  };

  console.log(JSON.stringify(summary, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error("[seed-partner-paid-customer] failed:", error);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
