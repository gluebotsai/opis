/**
 * Smoke test: open cancellation/drop requests block customer product requests.
 */
import "../src/config/load-env.js";
import crypto from "node:crypto";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { createLead } from "../src/modules/leads/lead-store.js";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
  getQuotation,
} from "../src/modules/quotations/quotation-store.js";
import { markQuotationPaymentPaid } from "../src/modules/payments/fulfillment.js";
import { syncSubscriptionsFromQuotation } from "../src/modules/subscriptions/subscription-store.js";
import { convertLeadToOrganization } from "../src/modules/organizations/organization-store.js";
import {
  createCustomerCancellationRequest,
  REQUEST_KINDS,
} from "../src/modules/branch-requests/cancellation-requests.js";
import { createCustomerProductRequest } from "../src/modules/customer-product-requests/request-store.js";
import { PAYMENT_STATUSES } from "../src/modules/payments/constants.js";
import { ensureOrgAdminCustomerUser } from "../src/modules/customer-portal/customer-auth.js";
import { CUSTOMER_ROLES } from "../src/modules/customer-portal/customer-auth.js";

const marker = `cug-smoke-${Date.now()}`;

async function cleanup(client, { leadId, orgId, quotationIds = [] }) {
  for (const quotationId of quotationIds) {
    await client.query(`DELETE FROM customer_product_requests WHERE source_lead_id = $1`, [leadId]);
    await client.query(`DELETE FROM branch_cancellation_requests WHERE source_lead_id = $1`, [leadId]);
    await client.query(`DELETE FROM payment_webhook_events WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM purchase_orders WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM quotations WHERE id = $1`, [quotationId]);
  }

  if (orgId) {
    await client.query(`DELETE FROM customer_auth_sessions WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM customer_users WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM renewal_events WHERE subscription_id IN (
      SELECT id FROM subscriptions WHERE organization_id = $1
    )`, [orgId]);
    await client.query(`DELETE FROM subscription_invoices WHERE subscription_id IN (
      SELECT id FROM subscriptions WHERE organization_id = $1
    )`, [orgId]);
    await client.query(`DELETE FROM subscriptions WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM organization_locations WHERE organization_id = $1`, [orgId]);
    await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  }

  if (leadId) {
    await client.query(`DELETE FROM active_products WHERE lead_id = $1`, [leadId]);
    await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
  }
}

async function seedPaidOrg(client) {
  const lead = await createLead(withSmokeLeadContact({
    companyName: `CUG Smoke ${marker}`,
    billingAddress: "HQ Street 1",
    workEmail: `${marker}-hq@example.com`,
    adminEmail: `${marker}-admin@example.com`,
  }));

  const quotation = await createQuotation({
    leadId: lead.id,
    lead,
    fileName: `${marker}.pdf`,
    pdfBase64: "dGVzdA==",
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
  });

  await approveQuotation(quotation.id, "finance@test.com", "cancellation upgrade gate smoke");
  await attachPaymentToQuotation(quotation.id, {
    provider: "stripe",
    paymentLinkUrl: `https://checkout.stripe.example/${quotation.id}`,
    paymentLinkId: `plink_${marker}`,
    subtotal: 1000,
    grandTotal: 1180,
    currency: "INR",
    amountLabel: "INR 1,180.00",
    status: PAYMENT_STATUSES.PENDING,
    dryRun: true,
  });

  await markQuotationPaymentPaid({
    quotationId: quotation.id,
    providerPaymentId: `pi_${marker}`,
    source: "manual",
    sendNotifications: false,
  });

  await getQuotation(quotation.id);
  const { organization } = await convertLeadToOrganization(lead.id, client);
  await syncSubscriptionsFromQuotation(quotation.id, client);

  const { rows: subs } = await client.query(
    `SELECT * FROM subscriptions WHERE organization_id = $1`,
    [organization.id],
  );

  const { user } = await ensureOrgAdminCustomerUser(client, organization.id, {
    adminEmail: `${marker}-admin@example.com`,
    workEmail: `${marker}-hq@example.com`,
    contactName: "HQ Branch User",
  });

  return {
    lead,
    organization,
    quotation,
    subscription: subs[0],
    orgAdmin: {
      id: user.id,
      role: CUSTOMER_ROLES.BRANCH_USER,
      branchId: user.branchId || "hq",
    },
  };
}

function upgradeAssignment(productId, branchId) {
  return {
    productId,
    branchId,
    billingBranchId: branchId,
    changeType: "upgrade",
    config: {
      pricingMode: "ccaas",
      licenseTier: "professional",
      billingCycle: "monthly",
      usageDetails: { agentCount: 5 },
    },
  };
}

async function expectRejected(fn, expectedMessage) {
  try {
    await fn();
    throw new Error(`Expected rejection: ${expectedMessage}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected rejection: ${expectedMessage}`) {
      throw error;
    }
    if (!(error instanceof Error) || !error.message.includes(expectedMessage)) {
      throw new Error(`Expected "${expectedMessage}" but got "${error?.message || error}"`);
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-cancellation-upgrade-gate] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const client = await pool.connect();
  let ctx;

  try {
    ctx = await seedPaidOrg(client);
    const { organization, lead, subscription, orgAdmin } = ctx;

    await createCustomerCancellationRequest({
      organizationId: organization.id,
      customerUserId: orgAdmin.id,
      customerUser: orgAdmin,
      sourceLeadId: lead.id,
      requestKind: REQUEST_KINDS.CANCEL_PRODUCT,
      branchId: subscription.branch_id,
      productId: subscription.product_id,
      subscriptionId: subscription.id,
      customerNote: "Cancel before upgrade attempt",
      companyName: organization.company_name,
    });

    await expectRejected(
      () =>
        createCustomerProductRequest({
          organizationId: organization.id,
          customerUserId: orgAdmin.id,
          sourceLeadId: lead.id,
          requestType: "upgrade",
          assignments: [upgradeAssignment(subscription.product_id, subscription.branch_id)],
        }),
      "open cancellation request and cannot be upgraded",
    );

    console.log("[smoke-test-cancellation-upgrade-gate] OK — upgrade blocked during product cancellation");

    await client.query(`DELETE FROM branch_cancellation_requests WHERE organization_id = $1`, [
      organization.id,
    ]);

    const allowed = await createCustomerProductRequest({
      organizationId: organization.id,
      customerUserId: orgAdmin.id,
      sourceLeadId: lead.id,
      requestType: "upgrade",
      assignments: [upgradeAssignment(subscription.product_id, subscription.branch_id)],
    });

    if (!allowed?.id) {
      throw new Error("Upgrade request should succeed when no cancellation is open");
    }

    console.log("[smoke-test-cancellation-upgrade-gate] OK — upgrade allowed without open cancellation");

    await client.query(`DELETE FROM customer_product_requests WHERE organization_id = $1`, [
      organization.id,
    ]);

    await createCustomerCancellationRequest({
      organizationId: organization.id,
      customerUserId: orgAdmin.id,
      customerUser: orgAdmin,
      sourceLeadId: lead.id,
      requestKind: REQUEST_KINDS.DROP_BRANCH,
      branchId: "hq",
      customerNote: "Drop branch before new product attempt",
      companyName: organization.company_name,
    });

    await expectRejected(
      () =>
        createCustomerProductRequest({
          organizationId: organization.id,
          customerUserId: orgAdmin.id,
          sourceLeadId: lead.id,
          requestType: "new",
          assignments: [
            {
              productId: "crm",
              branchId: "hq",
              billingBranchId: "hq",
              changeType: "new",
              config: { pricingMode: "crm", userCount: 3 },
            },
          ],
        }),
      "open cancellation request and cannot accept product changes",
    );

    console.log("[smoke-test-cancellation-upgrade-gate] OK — new product blocked during branch drop");
  } catch (error) {
    console.error("[smoke-test-cancellation-upgrade-gate] FAILED:", error);
    process.exitCode = 1;
  } finally {
    if (ctx) {
      await cleanup(client, {
        leadId: ctx.lead.id,
        orgId: ctx.organization.id,
        quotationIds: [ctx.quotation.id],
      });
    }
    client.release();
    await pool.end();
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();
