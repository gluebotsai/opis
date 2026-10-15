/**
 * Branch cancellation smoke test: per-product cancel, branch drop, grace alert dedup.
 */
import "../server/load-env.js";
import crypto from "node:crypto";
import { migrateDatabase } from "../server/db/migrate.js";
import { pool } from "../server/db/pool.js";
import { createLead } from "../server/leads.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
  getQuotation,
} from "../server/quotations.js";
import { markQuotationPaymentPaid } from "../server/payments/fulfillment.js";
import { syncSubscriptionsFromQuotation } from "../server/subscriptions.js";
import { convertLeadToOrganization } from "../server/organizations.js";
import {
  createCustomerCancellationRequest,
  approveCancellationRequest,
  withdrawCancellationRequest,
  REQUEST_KINDS,
} from "../server/branchCancellationRequests.js";
import { dropBranch, cancelProductAtBranch } from "../server/branchLifecycle.js";
import { processUnpaidGraceAlerts } from "../server/billing/unpaidGraceAlerts.js";
import { processScheduledCancellations } from "../server/billing/scheduledCancellations.js";
import { EFFECTIVE_TIMINGS } from "../server/branchCancellationRequests.js";
import { PAYMENT_STATUSES } from "../server/payments/constants.js";
import { ensureOrgAdminCustomerUser } from "../server/customerAuth.js";
import { CUSTOMER_ROLES } from "../server/customerAuth.js";

const marker = `bcr-smoke-${Date.now()}`;

async function cleanup(client, { leadId, orgId, quotationIds = [] }) {
  for (const quotationId of quotationIds) {
    await client.query(`DELETE FROM branch_cancellation_alerts WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM branch_cancellation_requests WHERE related_quotation_id = $1`, [
      quotationId,
    ]);
    await client.query(`DELETE FROM branch_cancellation_requests WHERE source_lead_id = $1`, [leadId]);
    await client.query(`DELETE FROM payment_webhook_events WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM purchase_orders WHERE quotation_id = $1`, [quotationId]);
    await client.query(`DELETE FROM quotations WHERE id = $1`, [quotationId]);
  }

  if (orgId) {
    await client.query(`DELETE FROM product_access_grants WHERE customer_user_id IN (
      SELECT id FROM customer_users WHERE organization_id = $1
    )`, [orgId]);
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

async function seedPaidTwoBranchOrg(client) {
  const branchBId = crypto.randomUUID();

  const lead = await createLead({
    companyName: `BCR Smoke ${marker}`,
    billingAddress: "HQ Street 1",
    workEmail: `${marker}-hq@example.com`,
    adminEmail: `${marker}-admin@example.com`,
    additionalAddresses: [
      {
        id: branchBId,
        label: "Branch B",
        address: "Branch B Street",
        country: "IN",
      },
    ],
  });

  const quotation = await createQuotation({
    leadId: lead.id,
    lead,
    fileName: `${marker}.pdf`,
    pdfBase64: "dGVzdA==",
    subtotal: 2000,
    grandTotal: 2360,
    currency: "INR",
    assignments: [
      {
        productId: "contact-center",
        branchId: "hq",
        billingTargetId: "hq",
        changeType: "new",
      },
      {
        productId: "contact-center",
        branchId: branchBId,
        billingTargetId: branchBId,
        changeType: "new",
      },
    ],
  });

  await approveQuotation(quotation.id, "finance@test.com", "branch cancel smoke");
  await attachPaymentToQuotation(quotation.id, {
    provider: "stripe",
    paymentLinkUrl: `https://checkout.stripe.example/${quotation.id}`,
    paymentLinkId: `plink_${marker}`,
    subtotal: 2000,
    grandTotal: 2360,
    currency: "INR",
    amountLabel: "INR 2,360.00",
    status: PAYMENT_STATUSES.PENDING,
    dryRun: true,
  });

  await markQuotationPaymentPaid({
    quotationId: quotation.id,
    providerPaymentId: `pi_${marker}`,
    source: "manual",
    sendNotifications: false,
  });

  const paidQuotation = await getQuotation(quotation.id);
  const { organization } = await convertLeadToOrganization(lead.id, client);
  await syncSubscriptionsFromQuotation(quotation.id, client);

  const { rows: subs } = await client.query(
    `SELECT * FROM subscriptions WHERE organization_id = $1 ORDER BY location_id`,
    [organization.id],
  );

  const { user } = await ensureOrgAdminCustomerUser(client, organization.id, {
    adminEmail: `${marker}-admin@example.com`,
    workEmail: `${marker}-hq@example.com`,
    contactName: "Org Admin",
  });

  return {
    lead,
    organization,
    quotation,
    subscriptions: subs,
    branchBId,
    orgAdmin: {
      id: user.id,
      role: CUSTOMER_ROLES.ORG_ADMIN,
      locationId: null,
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-branch-cancellation] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const client = await pool.connect();
  let ctx;

  try {
    ctx = await seedPaidTwoBranchOrg(client);
    const hqSub = ctx.subscriptions.find((entry) => entry.location_id === "hq");
    const branchSub = ctx.subscriptions.find((entry) => entry.location_id === ctx.branchBId);

    if (!hqSub || !branchSub) {
      throw new Error("Expected HQ and branch subscriptions");
    }

    const cancelRequest = await createCustomerCancellationRequest({
      organizationId: ctx.organization.id,
      customerUserId: ctx.orgAdmin.id,
      customerUser: ctx.orgAdmin,
      sourceLeadId: ctx.lead.id,
      requestKind: REQUEST_KINDS.CANCEL_PRODUCT,
      locationId: ctx.branchBId,
      productId: branchSub.product_id,
      subscriptionId: branchSub.id,
      customerNote: "Cancel branch B product only",
      companyName: ctx.organization.companyName,
    });

    const approved = await approveCancellationRequest(cancelRequest.id, {
      adminUser: "admin@test.com",
      adminNote: "Approved in smoke test",
      effectiveTiming: EFFECTIVE_TIMINGS.IMMEDIATE,
    });

    const { rows: branchSubAfter } = await client.query(
      `SELECT status FROM subscriptions WHERE id = $1`,
      [branchSub.id],
    );
    const { rows: hqSubAfter } = await client.query(`SELECT status FROM subscriptions WHERE id = $1`, [
      hqSub.id,
    ]);

    if (branchSubAfter[0]?.status !== "cancelled") {
      throw new Error("Branch subscription should be cancelled");
    }
    if (hqSubAfter[0]?.status !== "active") {
      throw new Error("HQ subscription should remain active");
    }
    if (!approved.request || approved.request.status !== "approved") {
      throw new Error("Cancellation request should be approved");
    }

    console.log("[smoke-test-branch-cancellation] OK — per-product cancel leaves other branch active");

    const endPeriodCtx = await seedPaidTwoBranchOrg(client);
    const endBranchSub = endPeriodCtx.subscriptions.find(
      (entry) => entry.location_id === endPeriodCtx.branchBId,
    );
    const endHqSub = endPeriodCtx.subscriptions.find((entry) => entry.location_id === "hq");

    const futureRenewsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await client.query(`UPDATE subscriptions SET renews_at = $2 WHERE id = $1`, [
      endBranchSub.id,
      futureRenewsAt,
    ]);

    const scheduledRequest = await createCustomerCancellationRequest({
      organizationId: endPeriodCtx.organization.id,
      customerUserId: endPeriodCtx.orgAdmin.id,
      customerUser: endPeriodCtx.orgAdmin,
      sourceLeadId: endPeriodCtx.lead.id,
      requestKind: REQUEST_KINDS.CANCEL_PRODUCT,
      locationId: endPeriodCtx.branchBId,
      productId: endBranchSub.product_id,
      subscriptionId: endBranchSub.id,
      customerNote: "Cancel at period end",
      effectiveTiming: EFFECTIVE_TIMINGS.END_OF_PERIOD,
      companyName: endPeriodCtx.organization.companyName,
    });

    const scheduledApproval = await approveCancellationRequest(scheduledRequest.id, {
      adminUser: "admin@test.com",
      adminNote: "Schedule end-of-period cancel",
      effectiveTiming: EFFECTIVE_TIMINGS.END_OF_PERIOD,
    });

    const { rows: scheduledSubRows } = await client.query(
      `SELECT status, cancel_at_period_end FROM subscriptions WHERE id = $1`,
      [endBranchSub.id],
    );

    if (scheduledApproval.request.status !== "approved_scheduled") {
      throw new Error("End-of-period approval should be approved_scheduled");
    }
    if (scheduledSubRows[0]?.status !== "active") {
      throw new Error("Scheduled subscription should remain active before effective date");
    }
    if (!scheduledSubRows[0]?.cancel_at_period_end) {
      throw new Error("Subscription should be flagged cancel_at_period_end");
    }

    const beforeDue = await processScheduledCancellations(client);
    if (beforeDue.cancelledSubscriptions > 0) {
      throw new Error("Scheduled cancellation should not run before effective date");
    }

    await client.query(`UPDATE subscriptions SET cancel_effective_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
      endBranchSub.id,
    ]);

    const afterDue = await processScheduledCancellations(client);
    const { rows: cancelledSubRows } = await client.query(
      `SELECT status FROM subscriptions WHERE id = $1`,
      [endBranchSub.id],
    );
    const { rows: endHqRows } = await client.query(`SELECT status FROM subscriptions WHERE id = $1`, [
      endHqSub.id,
    ]);

    if (afterDue.cancelledSubscriptions < 1) {
      throw new Error("Scheduled cancellation should execute after effective date");
    }
    if (cancelledSubRows[0]?.status !== "cancelled") {
      throw new Error("Subscription should be cancelled after scheduled effective date");
    }
    if (endHqRows[0]?.status !== "active") {
      throw new Error("Other branch subscription should remain active");
    }

    console.log("[smoke-test-branch-cancellation] OK — end-of-period cancel keeps access until due date");

    await cleanup(client, {
      leadId: endPeriodCtx.lead.id,
      orgId: endPeriodCtx.organization.id,
      quotationIds: [endPeriodCtx.quotation.id],
    });

    const withdrawn = await createCustomerCancellationRequest({
      organizationId: ctx.organization.id,
      customerUserId: ctx.orgAdmin.id,
      customerUser: ctx.orgAdmin,
      sourceLeadId: ctx.lead.id,
      requestKind: REQUEST_KINDS.DROP_BRANCH,
      locationId: ctx.branchBId,
      customerNote: "Drop branch",
      companyName: ctx.organization.companyName,
    });

    const withdrawnRow = await withdrawCancellationRequest(
      withdrawn.id,
      ctx.organization.id,
      ctx.orgAdmin.id,
    );
    if (!withdrawnRow || withdrawnRow.status !== "withdrawn") {
      throw new Error("Customer should be able to withdraw pending branch drop request");
    }

    console.log("[smoke-test-branch-cancellation] OK — customer withdraw pending request");

    await client.query(
      `UPDATE subscriptions SET renews_at = NOW() - INTERVAL '20 days' WHERE id = $1`,
      [hqSub.id],
    );

    const firstGrace = await processUnpaidGraceAlerts(client);
    const secondGrace = await processUnpaidGraceAlerts(client);

    if (!firstGrace.total) {
      throw new Error("Expected renewal grace alert on first sweep");
    }
    if (secondGrace.total > firstGrace.total) {
      throw new Error("Grace alerts should dedupe on second sweep");
    }

    console.log("[smoke-test-branch-cancellation] OK — renewal grace alert dedup");

    await dropBranch(client, {
      organizationId: ctx.organization.id,
      locationId: ctx.branchBId,
      adminUser: "admin@test.com",
      reason: "Smoke drop branch",
    });

    const { rows: locationRows } = await client.query(
      `SELECT status FROM organization_locations WHERE organization_id = $1 AND id = $2`,
      [ctx.organization.id, ctx.branchBId],
    );
    if (locationRows[0]?.status !== "inactive") {
      throw new Error("Branch location should be inactive after drop");
    }

    console.log("[smoke-test-branch-cancellation] OK — admin branch drop marks location inactive");
  } catch (error) {
    console.error("[smoke-test-branch-cancellation] FAILED:", error);
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
