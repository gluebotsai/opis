/**
 * Seed Acme demo customer: CCAAS + Campaign, paid, fixed portal credentials.
 * Usage: node scripts/seed-demo-customer.mjs
 */
import "../server/load-env.js";

import { migrateDatabase } from "../server/db/migrate.js";
import { pool } from "../server/db/pool.js";
import { createLead, getLeadById } from "../server/leads.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
} from "../server/quotations.js";
import { markQuotationPaymentPaid } from "../server/payments/fulfillment.js";
import {
  ensureDefaultCustomerUser,
  setCustomerPortalPassword,
} from "../server/customerAuth.js";
import { ensureOrganizationForPaidLead } from "../server/organizations.js";
import { PAYMENT_STATUSES } from "../server/payments/constants.js";
import { buildModulesFromPlan } from "../src/lib/ccaasModules.js";
import { DEFAULT_PRICING_CATALOG } from "../src/lib/pricingCatalogDefaults.js";
import { createDefaultCcaasAddons, createDefaultUsageDetails } from "../src/lib/ccaasConfiguration.js";

const DEMO_EMAIL = "acme.multi.product@worktual.demo";
const DEMO_PASSWORD = "EBbNRcYc-IkV";
const DEMO_COMPANY = "Acme Multi-Product Industries";
const MONTHLY_PRICE_CAMPAIGN = 35000;

function buildCcaasConfig() {
  const modules = buildModulesFromPlan("pro", DEFAULT_PRICING_CATALOG, "India");
  modules.digitalChannels = { optionId: "ai-auto-attendant-live", price: "15000" };
  modules.dashboard = { optionId: "dynamic", price: "5000" };

  return {
    productId: "contact-center",
    pricingMode: "ccaas",
    licenseTier: "pro",
    modules,
    usageDetails: createDefaultUsageDetails(),
    addons: createDefaultCcaasAddons(),
    billingCycle: "monthly",
    region: "India",
    currency: "INR",
    taxLabel: "GST",
  };
}

function estimateCcaasMrr(config) {
  let total = 0;
  for (const selection of Object.values(config.modules || {})) {
    total += Number(selection?.price) || 0;
  }
  return total;
}

async function cleanupExistingDemo(client) {
  const { rows: leads } = await client.query(`SELECT id FROM leads WHERE work_email = $1`, [
    DEMO_EMAIL,
  ]);

  for (const lead of leads) {
    const leadId = lead.id;
    const { rows: quotations } = await client.query(
      `SELECT id FROM quotations WHERE lead_id = $1`,
      [leadId],
    );

    for (const quotation of quotations) {
      const quotationId = quotation.id;
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

    await client.query(`DELETE FROM active_products WHERE lead_id = $1`, [leadId]);
    await client.query(
      `DELETE FROM product_access_grants WHERE customer_user_id IN (
        SELECT id FROM customer_users WHERE organization_id IN (
          SELECT id FROM organizations WHERE source_lead_id = $1
        )
      )`,
      [leadId],
    );
    await client.query(
      `DELETE FROM customer_auth_sessions WHERE organization_id IN (
        SELECT id FROM organizations WHERE source_lead_id = $1
      )`,
      [leadId],
    );
    await client.query(
      `DELETE FROM customer_users WHERE organization_id IN (
        SELECT id FROM organizations WHERE source_lead_id = $1
      )`,
      [leadId],
    );
    await client.query(`DELETE FROM organizations WHERE source_lead_id = $1`, [leadId]);
    await client.query(`DELETE FROM branches WHERE lead_id = $1`, [leadId]);
    await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
    await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed-demo-customer] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const client = await pool.connect();
  try {
    await cleanupExistingDemo(client);
  } finally {
    client.release();
  }

  const ccaasConfig = buildCcaasConfig();
  const ccaasMrr = estimateCcaasMrr(ccaasConfig);
  const subtotal = ccaasMrr + MONTHLY_PRICE_CAMPAIGN;
  const grandTotal = Math.round(subtotal * 1.18 * 100) / 100;

  const lead = await createLead({
    companyName: DEMO_COMPANY,
    contactName: "Priya Sharma",
    billingAddress: "42 MG Road, Indiranagar, Bengaluru, Karnataka 560038",
    workEmail: DEMO_EMAIL,
    adminEmail: DEMO_EMAIL,
    phone: "+91 98765 43210",
    country: "India",
    companySize: "201-500",
    businessType: "enterprise",
    isDecisionMaker: true,
    decisionMakerName: "Priya Sharma",
    additionalAddresses: [
      { label: "Mumbai Branch", address: "12 Nariman Point, Mumbai, Maharashtra 400021" },
      { label: "Delhi Branch", address: "88 Connaught Place, New Delhi 110001" },
    ],
  });

  const quotation = await createQuotation({
    leadId: lead.id,
    lead,
    fileName: "acme-ccaas-campaign-invoice.pdf",
    pdfBase64: "ZGVtbw==",
    subtotal,
    grandTotal,
    currency: "INR",
    assignments: [
      {
        productId: "contact-center",
        branchId: "hq",
        billingTargetId: "hq",
        changeType: "new",
        config: ccaasConfig,
      },
      {
        productId: "campaign",
        branchId: "hq",
        billingTargetId: "hq",
        changeType: "new",
        config: {
          billingCycle: "monthly",
          pricingMode: "campaign",
          monthlyBasePrice: MONTHLY_PRICE_CAMPAIGN,
          region: "India",
          currency: "INR",
        },
      },
    ],
    productSummary: [
      {
        productId: "contact-center",
        priceLabel: `INR ${ccaasMrr.toLocaleString("en-IN")}/month`,
      },
      {
        productId: "campaign",
        priceLabel: `INR ${MONTHLY_PRICE_CAMPAIGN.toLocaleString("en-IN")}/month`,
      },
    ],
  });

  await approveQuotation(
    quotation.id,
    "finance@worktual.test",
    "Acme CCAAS + Campaign purchase approved",
  );
  await attachPaymentToQuotation(quotation.id, {
    provider: "manual",
    paymentLinkUrl: `https://payments.worktual.demo/${quotation.id}`,
    paymentLinkId: `demo_plink_${quotation.id.slice(0, 8)}`,
    subtotal,
    grandTotal,
    currency: "INR",
    amountLabel: `INR ${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    status: PAYMENT_STATUSES.PENDING,
    dryRun: true,
  });

  await markQuotationPaymentPaid({
    quotationId: quotation.id,
    source: "manual",
    sendNotifications: false,
  });

  const refreshedLead = await getLeadById(lead.id);
  const dbClient = await pool.connect();
  try {
    const { organization } = await ensureOrganizationForPaidLead(lead.id, dbClient);
    const portalAccess = await ensureDefaultCustomerUser(dbClient, organization.id, {
      workEmail: refreshedLead.workEmail,
      adminEmail: refreshedLead.adminEmail,
      contactName: refreshedLead.contactName,
    });
    await setCustomerPortalPassword(dbClient, portalAccess.user.id, DEMO_PASSWORD);
  } finally {
    dbClient.release();
    await pool.end();
  }

  const loginUrl = `${String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "")}/`;
  const products = refreshedLead.activeProducts?.map((entry) => entry.productId) || [];

  console.log("");
  console.log("=== Demo customer created ===");
  console.log(`Company:      ${DEMO_COMPANY}`);
  console.log(`Contact:      Priya Sharma`);
  console.log(`Lead ID:      ${lead.id}`);
  console.log(`Quotation ID: ${quotation.id}`);
  console.log(`Status:       ${refreshedLead.status}`);
  console.log(`Products:     ${products.join(", ")}`);
  console.log(`Active count: ${products.length}`);
  console.log(`CCAAS MRR:    INR ${ccaasMrr.toLocaleString("en-IN")}`);
  console.log(`Campaign MRR: INR ${MONTHLY_PRICE_CAMPAIGN.toLocaleString("en-IN")}`);
  console.log("");
  console.log("=== Customer portal credentials ===");
  console.log(`Login URL:  ${loginUrl}`);
  console.log(`Email:      ${DEMO_EMAIL}`);
  console.log(`Password:   ${DEMO_PASSWORD}`);
  console.log("");
}

main().catch((error) => {
  console.error("[seed-demo-customer] FAILED:", error);
  process.exit(1);
});
