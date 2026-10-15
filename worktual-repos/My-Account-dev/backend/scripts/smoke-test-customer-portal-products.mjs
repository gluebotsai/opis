/**
 * Smoke: after paying for an additional NEW product, customer portal entitlements
 * (and therefore product space) must include both subscriptions.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { applySmokeDbTimeouts } from "./lib/smokeDbTimeouts.mjs";
import { cleanupPaymentSmokeLead } from "./lib/smoke-payment-cleanup.mjs";
import { createLead, getLeadById } from "../src/modules/leads/lead-store.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
} from "../src/modules/quotations/quotation-store.js";
import {
  confirmFinancePayment,
  recordProviderPaymentReported,
} from "../src/modules/payments/fulfillment.js";
import { PAYMENT_STATUSES } from "../src/modules/payments/constants.js";
import { ensureOrganizationForPaidLead } from "../src/modules/organizations/organization-store.js";
import {
  ensureOrgAdminCustomerUser,
  getCustomerEntitlements,
  loginCustomerUser,
  regenerateCustomerPortalPassword,
} from "../src/modules/customer-portal/customer-auth.js";
import { buildLeadDashboardModel } from "../../frontend/src/lib/leadDashboard.js";
import { organizationToLeadShape } from "../../frontend/src/lib/customerPortal.js";
import { gstinWithChecksum } from "../src/modules/platform/tax-number.js";

const marker = `portal-products-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function payQuotation(quotationId) {
  await attachPaymentToQuotation(quotationId, {
    provider: "stripe",
    paymentLinkUrl: `https://checkout.stripe.example/${quotationId}`,
    paymentLinkId: `plink_${quotationId.slice(0, 8)}`,
    subtotal: 1000,
    grandTotal: 1180,
    currency: "INR",
    amountLabel: "INR 1,180.00",
    status: PAYMENT_STATUSES.PENDING,
    dryRun: true,
  });

  await recordProviderPaymentReported({
    quotationId,
    providerPaymentId: `pi_${quotationId.slice(0, 8)}`,
    source: "manual",
    sendNotifications: false,
  });

  return confirmFinancePayment({
    quotationId,
    providerPaymentId: `pi_${quotationId.slice(0, 8)}`,
    source: "manual",
    sendNotifications: false,
  });
}

async function cleanup({ leadId }) {
  if (leadId) {
    await cleanupPaymentSmokeLead(leadId);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-customer-portal-products] DATABASE_URL is not set");
    process.exit(1);
  }

  applySmokeDbTimeouts(pool);
  await migrateDatabase();

  let leadId = null;
  let orgId = null;
  const quotationIds = [];

  try {
    const lead = await createLead({
      companyName: `Portal Products ${marker}`,
      industryType: "Technology",
      businessType: "B2B",
      country: "India",
      companySize: "11-50",
      contactName: "Portal Contact",
      designation: "Manager",
      workEmail: `${marker}-hq@example.com`,
      adminEmail: `${marker}-admin@example.com`,
      mobileCountryCode: "+91",
      mobileNumber: `9${String(Date.now()).slice(-9)}`,
      billingAddress: "1 Portal Street",
      taxNumber: gstinWithChecksum(`29AAAAA${String(Date.now()).slice(-4)}A1Z`),
      state: "Karnataka",
    });
    leadId = lead.id;

    const firstQuote = await createQuotation({
      leadId: lead.id,
      lead,
      fileName: `${marker}-first.pdf`,
      pdfBase64: "Zmlyc3Q=",
      subtotal: 1000,
      grandTotal: 1180,
      currency: "INR",
      assignments: [
        {
          productId: "campaign",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: {
            pricingMode: "campaign",
            region: "India",
            billingCycle: "monthly",
            currency: "INR",
            basePlanEnabled: true,
            includedContacts: 50000,
          },
        },
      ],
      productSummary: [
        {
          productId: "campaign",
          name: "AI Native Campaign Management",
          priceLabel: "INR 1,000",
          branchLabel: "Head office",
          billingLabel: "Head office",
          changeTypeLabel: "New purchase",
        },
      ],
    });
    quotationIds.push(firstQuote.id);
    await approveQuotation(firstQuote.id, "finance@test.com", "first product");
    await payQuotation(firstQuote.id);

    const client = await pool.connect();
    let portalUserId;
    try {
      const { organization } = await ensureOrganizationForPaidLead(leadId, client);
      orgId = organization.id;
      assert(orgId, "Organization should exist after first payment");

      const ensured = await ensureOrgAdminCustomerUser(client, orgId, {
        contactName: lead.contactName,
        workEmail: lead.workEmail,
        adminEmail: lead.adminEmail,
      });
      assert(ensured?.user?.id, "HQ branch portal user should be created");
      assert(ensured.user.branchId, "Portal user must be branch-scoped");
      portalUserId = ensured.user.id;
    } finally {
      client.release();
    }

    let entitlements = await getCustomerEntitlements(portalUserId);
    assert(entitlements?.subscriptions?.length === 1, "Portal should see 1 product after first payment");
    assert(
      entitlements.subscriptions[0].productId === "campaign",
      "First portal product should be campaign",
    );

    let portalLead = organizationToLeadShape(entitlements.organization, entitlements.subscriptions);
    let dashboard = buildLeadDashboardModel(portalLead);
    assert(
      dashboard?.activeProducts?.length === 1,
      `Customer dashboard should show 1 product, got ${dashboard?.activeProducts?.length}`,
    );

    // Second NEW product purchase (same customer, already has credentials).
    const refreshedLead = await getLeadById(leadId);
    const secondQuote = await createQuotation({
      leadId,
      lead: refreshedLead,
      fileName: `${marker}-second.pdf`,
      pdfBase64: "c2Vjb25k",
      subtotal: 2000,
      grandTotal: 2360,
      currency: "INR",
      assignments: [
        {
          productId: "value-management",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
          config: {
            pricingMode: "value-management",
            region: "India",
            billingCycle: "monthly",
            currency: "INR",
            subscriptionEnabled: true,
            monthlyActiveUsers: 10000,
          },
        },
      ],
      productSummary: [
        {
          productId: "value-management",
          name: "AI Native Customer Value Management",
          priceLabel: "INR 2,000",
          branchLabel: "Head office",
          billingLabel: "Head office",
          changeTypeLabel: "New purchase",
        },
      ],
    });
    quotationIds.push(secondQuote.id);
    await approveQuotation(secondQuote.id, "finance@test.com", "second product");
    await payQuotation(secondQuote.id);

    const leadAfter = await getLeadById(leadId);
    const salesProducts = (leadAfter.subscriptions || leadAfter.activeProducts || []).map(
      (entry) => entry.productId,
    );
    assert(
      salesProducts.includes("campaign") && salesProducts.includes("value-management"),
      `Sales lead should have both products, got ${salesProducts.join(",")}`,
    );

    entitlements = await getCustomerEntitlements(portalUserId);
    const portalProductIds = (entitlements?.subscriptions || []).map((entry) => entry.productId);
    console.log("[smoke-test-customer-portal-products] portal products:", portalProductIds.join(", "));

    assert(
      portalProductIds.includes("campaign"),
      "Portal still missing campaign after second payment",
    );
    assert(
      portalProductIds.includes("value-management"),
      "BUG: paid new product value-management not reflected in customer portal entitlements",
    );
    assert(
      portalProductIds.length === 2,
      `Expected 2 portal products, got ${portalProductIds.length}`,
    );

    portalLead = organizationToLeadShape(entitlements.organization, entitlements.subscriptions);
    dashboard = buildLeadDashboardModel(portalLead);
    assert(
      dashboard?.activeProducts?.length === 2,
      `Customer product space should show 2 products, got ${dashboard?.activeProducts?.length}`,
    );

    const clientForLogin = await pool.connect();
    let loginEmail = lead.adminEmail || lead.workEmail;
    let loginPassword = null;
    try {
      const regenerated = await regenerateCustomerPortalPassword(clientForLogin, orgId, {
        contactName: lead.contactName,
        workEmail: lead.workEmail,
        adminEmail: lead.adminEmail,
      });
      assert(regenerated?.temporaryPassword, "Expected temporary portal password for login smoke");
      loginEmail = regenerated.email || loginEmail;
      loginPassword = regenerated.temporaryPassword;
    } finally {
      clientForLogin.release();
    }

    const session = await loginCustomerUser(loginEmail, loginPassword);
    assert(session?.token, "Customer login should return a session token");
    assert(
      session.organizationId === orgId,
      `Customer session org mismatch: ${session.organizationId} vs ${orgId}`,
    );
    console.log("[smoke-test-customer-portal-products] OK — customer login");

    console.log(
      "[smoke-test-customer-portal-products] OK — second paid product appears in customer portal",
    );
  } catch (error) {
    console.error(
      "[smoke-test-customer-portal-products] FAILED:",
      error instanceof Error ? error.stack || error.message : error,
    );
    process.exitCode = 1;
  } finally {
    try {
      await cleanup({ leadId });
    } catch (cleanupError) {
      console.error(
        "[smoke-test-customer-portal-products] cleanup failed:",
        cleanupError instanceof Error ? cleanupError.message : cleanupError,
      );
    }
    await pool.end();
  }
}

main();
