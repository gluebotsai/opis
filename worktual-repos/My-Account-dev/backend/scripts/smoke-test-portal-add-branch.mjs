/**
 * Smoke: customer portal add-branch with product purchase.
 * Request → materialize on quote → pay → organization_locations includes branch.
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
  createQuotationsForFinance,
} from "../src/modules/quotations/quotation-store.js";
import {
  confirmFinancePayment,
  recordProviderPaymentReported,
} from "../src/modules/payments/fulfillment.js";
import { PAYMENT_STATUSES } from "../src/modules/payments/constants.js";
import { ensureOrganizationForPaidLead } from "../src/modules/organizations/organization-store.js";
import {
  ensureBranchCustomerUser,
  ensureOrgAdminCustomerUser,
} from "../src/modules/customer-portal/customer-auth.js";
import {
  createCustomerProductRequest,
  materializeProductRequestNewBranches,
} from "../src/modules/customer-product-requests/request-store.js";
import { gstinWithChecksum } from "../src/modules/platform/tax-number.js";

const marker = `portal-add-branch-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueGstin(stateCode = "29") {
  const panBody = `AAAAA${String(Date.now()).slice(-4)}A`;
  return gstinWithChecksum(`${stateCode}${panBody}1Z`);
}

function uniqueMobile() {
  return `9${String(Date.now()).slice(-9)}`;
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

async function seedPaidOrg() {
  const lead = await createLead({
    companyName: `Portal Add Branch ${marker}`,
    industryType: "Technology",
    businessType: "B2B",
    country: "India",
    companySize: "11-50",
    contactName: "Portal Contact",
    designation: "Manager",
    workEmail: `${marker}-hq@example.com`,
    adminEmail: `${marker}-admin@example.com`,
    mobileCountryCode: "+91",
    mobileNumber: uniqueMobile(),
    billingAddress: "1 Portal Add Branch Street",
    taxNumber: uniqueGstin("29"),
    state: "Karnataka",
  });

  const seed = await createQuotationsForFinance({
    leadId: lead.id,
    lead,
    fileName: `${marker}-seed.pdf`,
    pdfBase64: "dGVzdA==",
    invoiceMode: "consolidated",
    subtotal: 1000,
    grandTotal: 1180,
    currency: "INR",
    assignments: [
      {
        productId: "contact-center",
        branchId: "hq",
        billingBranchId: "hq",
        changeType: "new",
      },
    ],
    productSummary: [
      {
        productId: "contact-center",
        name: "Contact center",
        branchLabel: "Head office",
        billingLabel: "Head office",
      },
    ],
  });
  const seedQuote = seed.quotations[0];
  await approveQuotation(seedQuote.id, "finance@test.com", "seed");
  await payQuotation(seedQuote.id);

  const client = await pool.connect();
  try {
    const { organization } = await ensureOrganizationForPaidLead(lead.id, client);
    const ensured = await ensureOrgAdminCustomerUser(client, organization.id, {
      adminEmail: `${marker}-admin@example.com`,
      displayName: "Portal Admin",
    });
    return {
      leadId: lead.id,
      orgId: organization.id,
      adminUserId: ensured.user.id,
      seedQuoteId: seedQuote.id,
    };
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-portal-add-branch] DATABASE_URL is not set");
    process.exit(1);
  }

  applySmokeDbTimeouts(pool);
  await migrateDatabase();

  let leadId = null;
  let orgId = null;
  const quotationIds = [];
  const requestIds = [];

  try {
    const seeded = await seedPaidOrg();
    leadId = seeded.leadId;
    orgId = seeded.orgId;
    quotationIds.push(seeded.seedQuoteId);

    const draftBranchId = crypto.randomUUID();
    const draftBranch = {
      id: draftBranchId,
      label: "Chennai branch",
      address: "22 Anna Salai, Chennai",
      country: "India",
      state: "Tamil Nadu",
      taxNumber: uniqueGstin("33"),
      contactName: "Branch Contact",
      workEmail: `${marker}-chennai@example.com`,
      mobileCountryCode: "+91",
      mobileNumber: uniqueMobile(),
    };

    // Reject: new branch with zero products
    let rejected = false;
    try {
      await createCustomerProductRequest({
        organizationId: orgId,
        customerUserId: seeded.adminUserId,
        sourceLeadId: leadId,
        requestType: "new",
        assignments: [
          {
            productId: "crm",
            branchId: "hq",
            billingBranchId: "hq",
            changeType: "new",
            config: { userCount: 5 },
          },
        ],
        productSummary: [{ productId: "crm", name: "CRM", branchLabel: "Head office" }],
        newBranches: [draftBranch],
        companyName: `Portal Add Branch ${marker}`,
        contactEmail: `${marker}-admin@example.com`,
      });
    } catch (error) {
      rejected = true;
      assert(
        String(error.message || "").includes("at least one product"),
        `Expected empty-branch rejection, got: ${error.message}`,
      );
    }
    assert(rejected, "Expected request with unassigned new branch to be rejected");

    const request = await createCustomerProductRequest({
      organizationId: orgId,
      customerUserId: seeded.adminUserId,
      sourceLeadId: leadId,
      requestType: "new",
      assignments: [
        {
          productId: "crm",
          branchId: draftBranchId,
          billingBranchId: draftBranchId,
          changeType: "new",
          config: { userCount: 5, pricingMode: "crm" },
        },
      ],
      productSummary: [
        {
          productId: "crm",
          name: "CRM",
          branchLabel: "Chennai branch",
          billingLabel: "Chennai branch",
        },
      ],
      newBranches: [draftBranch],
      companyName: `Portal Add Branch ${marker}`,
      contactEmail: `${marker}-admin@example.com`,
    });
    requestIds.push(request.id);
    assert(request.newBranches?.length === 1, "Request should persist newBranches");

    // Before materialize/pay, org locations should not include draft
    const beforePay = await pool.query(
      `SELECT id FROM organization_locations WHERE organization_id = $1 AND id = $2`,
      [orgId, draftBranchId],
    );
    assert(beforePay.rows.length === 0, "Draft branch must not appear in org locations before pay");

    const materialized = await materializeProductRequestNewBranches(request.id);
    assert(materialized.materialized === true, "Expected materialize to copy branches onto lead");

    const leadAfterMaterialize = await getLeadById(leadId);
    assert(
      (leadAfterMaterialize.additionalAddresses || []).some(
        (entry) => String(entry.id) === draftBranchId,
      ),
      "Lead additionalAddresses should include materialized branch",
    );

    const quote = await createQuotation({
      leadId,
      lead: leadAfterMaterialize,
      fileName: `${marker}-crm.pdf`,
      pdfBase64: "dGVzdA==",
      invoiceMode: "consolidated",
      subtotal: 1000,
      grandTotal: 1180,
      currency: "INR",
      sourceProductRequestId: request.id,
      assignments: [
        {
          productId: "crm",
          branchId: draftBranchId,
          billingBranchId: draftBranchId,
          changeType: "new",
          config: { userCount: 5, pricingMode: "crm" },
        },
      ],
      productSummary: [
        {
          productId: "crm",
          name: "CRM",
          branchLabel: "Chennai branch",
          billingLabel: "Chennai branch",
        },
      ],
    });
    quotationIds.push(quote.id);
    await approveQuotation(quote.id, "finance@test.com", "portal-add-branch");
    await payQuotation(quote.id);

    const afterPay = await pool.query(
      `SELECT id, label, address FROM organization_locations WHERE organization_id = $1 AND id = $2`,
      [orgId, draftBranchId],
    );
    assert(afterPay.rows.length === 1, "Paid fulfillment should publish branch to organization_locations");
    assert(
      String(afterPay.rows[0].label || "").includes("Chennai"),
      "Organization location label should match new branch",
    );

    // Branch-user scope: may assign own branch or draft ids only
    const client = await pool.connect();
    let branchUserId;
    try {
      const branchUser = await ensureBranchCustomerUser(client, orgId, {
        branchId: "hq",
        email: `${marker}-branch@example.com`,
        displayName: "Branch User",
      });
      branchUserId = branchUser.user.id;
    } finally {
      client.release();
    }

    const otherBranchId = crypto.randomUUID();
    let branchRejected = false;
    try {
      await createCustomerProductRequest({
        organizationId: orgId,
        customerUserId: branchUserId,
        sourceLeadId: leadId,
        requestType: "new",
        assignments: [
          {
            productId: "ticketing",
            branchId: otherBranchId,
            billingBranchId: otherBranchId,
            changeType: "new",
            config: { userCount: 2 },
          },
        ],
        productSummary: [{ productId: "ticketing", name: "Ticketing" }],
        newBranches: [
          {
            id: otherBranchId,
            label: "Branch user site",
            address: "9 Branch Lane",
            country: "India",
            state: "Karnataka",
            taxNumber: uniqueGstin("29"),
            workEmail: `${marker}-branch-site@example.com`,
            mobileCountryCode: "+91",
            mobileNumber: uniqueMobile(),
          },
        ],
        companyName: `Portal Add Branch ${marker}`,
        contactEmail: `${marker}-branch@example.com`,
      });
      // Direct service call does not enforce branch-user scope (HTTP layer does).
      // Assert service accepts; API scope covered by assignment id belonging to drafts.
      requestIds.push(
        (
          await pool.query(
            `SELECT id FROM customer_product_requests
             WHERE organization_id = $1 AND contact_email = $2
             ORDER BY created_at DESC LIMIT 1`,
            [orgId, `${marker}-branch@example.com`],
          )
        ).rows[0]?.id,
      );
    } catch (error) {
      branchRejected = true;
      throw error;
    }
    assert(!branchRejected, "Branch user creating draft+product via service should succeed");

    console.log("[smoke-test-portal-add-branch] OK");
  } catch (error) {
    console.error("[smoke-test-portal-add-branch] FAILED:", error);
    process.exitCode = 1;
  } finally {
    for (const requestId of requestIds.filter(Boolean)) {
      await pool.query(`DELETE FROM customer_product_requests WHERE id = $1`, [requestId]).catch(() => {});
    }
    if (leadId) {
      await cleanupPaymentSmokeLead(leadId);
    }
    await pool.end().catch(() => {});
  }
}

main();
