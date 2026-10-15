/**
 * Per-branch finance quotes: 2 branches → 2 finance approvals → 2 payment links →
 * 2 branch portal credentials; lead Paid only when both are paid.
 */
import crypto from "node:crypto";

import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { createLead, getLeadById } from "../src/modules/leads/lead-store.js";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotationsForFinance,
  getApprovedQuotationPayment,
  getQuotation,
} from "../src/modules/quotations/quotation-store.js";
import {
  confirmFinancePayment,
  recordProviderPaymentReported,
} from "../src/modules/payments/fulfillment.js";
import { PAYMENT_STATUSES } from "../src/modules/payments/constants.js";
import { QUOTATION_STATUSES } from "../src/lib/statuses.js";
import { loginCustomerUser, regenerateBranchPortalPassword } from "../src/modules/customer-portal/customer-auth.js";
import { ensureOrganizationForPaidLead } from "../src/modules/organizations/organization-store.js";

const marker = `per-branch-finance-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup(leadId, quotationIds = []) {
  const client = await pool.connect();
  try {
    if (leadId) {
      const { rows: orgs } = await client.query(
        `SELECT id FROM organizations WHERE source_lead_id = $1`,
        [leadId],
      );
      for (const org of orgs) {
        await client.query(`DELETE FROM product_access_grants WHERE customer_user_id IN (
          SELECT id FROM customer_users WHERE organization_id = $1
        )`, [org.id]);
        await client.query(`DELETE FROM customer_auth_sessions WHERE organization_id = $1`, [
          org.id,
        ]);
        await client.query(`DELETE FROM customer_users WHERE organization_id = $1`, [org.id]);
      }
    }

    for (const quotationId of quotationIds) {
      if (!quotationId) continue;
      await client.query(`DELETE FROM quotation_branch_payments WHERE quotation_id = $1`, [
        quotationId,
      ]);
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
      await client.query(`DELETE FROM subscriptions WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM purchase_orders WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM quotation_invoices WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_summary_items WHERE quotation_id = $1`, [
        quotationId,
      ]);
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

async function payQuotation(quotationId, markerSuffix) {
  await recordProviderPaymentReported({
    quotationId,
    providerPaymentId: `manual_${marker}_${markerSuffix}`,
    source: "manual",
    reportedBy: "finance@test.com",
    sendNotifications: false,
  });

  return confirmFinancePayment({
    quotationId,
    financeConfirmedBy: "finance@test.com",
    sendNotifications: false,
  });
}

async function issueAndLoginBranch(leadId, branchId, email, displayName) {
  const client = await pool.connect();
  try {
    const { organization } = await ensureOrganizationForPaidLead(leadId, client);
    assert(organization?.id, "Expected organization after payment");
    const portalAccess = await regenerateBranchPortalPassword(client, organization.id, {
      branchId,
      email,
      displayName,
    });
    assert(portalAccess?.temporaryPassword, `Expected temporary password for ${email}`);
    assert(portalAccess?.email === email, `Expected branch email ${email}`);
    const session = await loginCustomerUser(portalAccess.email, portalAccess.temporaryPassword);
    assert(session?.user?.branchId === branchId, `Expected branch_user for ${branchId}`);
    assert(session?.user?.role === "branch_user", `Expected branch_user role, got ${session?.user?.role}`);
    return portalAccess;
  } finally {
    client.release();
  }
}

async function countBranchUsers(organizationId) {
  const { rows } = await pool.query(
    `SELECT email, branch_id, role FROM customer_users
     WHERE organization_id = $1 AND branch_id IS NOT NULL
     ORDER BY email`,
    [organizationId],
  );
  return rows;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-per-branch-finance] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const branchBId = crypto.randomUUID();
  const hqEmail = `${marker}-hq@example.com`;
  const branchBEmail = `${marker}-branch-b@example.com`;
  let leadId;
  let quotationIds = [];
  let singleLeadId;
  let singleQuotationIds = [];
  let partialLeadId;
  let partialQuotationIds = [];

  try {
    const lead = await createLead(withSmokeLeadContact({
      companyName: `Per Branch Finance ${marker}`,
      billingAddress: "HQ Street 1",
      workEmail: hqEmail,
      additionalAddresses: [
        {
          id: branchBId,
          label: "Branch B",
          address: "Branch B Street",
          country: "IN",
          workEmail: branchBEmail,
        },
      ],
    }));
    leadId = lead.id;

    const { quotations } = await createQuotationsForFinance({
      leadId,
      lead,
      fileName: `${marker}-primary.pdf`,
      pdfBase64: "dGVzdA==",
      invoiceMode: "per_branch",
      subtotal: 2000,
      grandTotal: 2360,
      currency: "INR",
      assignments: [
        {
          productId: "contact-center",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
        {
          productId: "contact-center",
          branchId: branchBId,
          billingBranchId: branchBId,
          changeType: "new",
        },
      ],
      invoices: [
        {
          fileName: `${marker}-hq.pdf`,
          pdfBase64: "aHE=",
          billingBranchId: "hq",
          branchLabel: "Head office",
          subtotal: 1000,
          grandTotal: 1180,
        },
        {
          fileName: `${marker}-branch-b.pdf`,
          pdfBase64: "YnI=",
          billingBranchId: branchBId,
          branchLabel: "Branch B",
          subtotal: 1000,
          grandTotal: 1180,
        },
      ],
      productSummary: [
        {
          productId: "contact-center",
          name: "Contact center",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
        {
          productId: "contact-center",
          name: "Contact center",
          branchLabel: "Branch B",
          billingLabel: "Branch B",
        },
      ],
    });

    assert(quotations.length === 2, `Expected 2 finance quotations, got ${quotations.length}`);
    quotationIds = quotations.map((entry) => entry.id);

    for (const quotation of quotations) {
      assert(quotation.status === QUOTATION_STATUSES.PENDING, "Expected pending finance quote");
      assert(
        (quotation.invoices || []).length === 1,
        `Expected single invoice per quote, got ${(quotation.invoices || []).length}`,
      );
      const expectedLabel =
        quotation.branchSummary?.branchLabel || quotation.invoices?.[0]?.branchLabel || "";
      const summary = quotation.productSummary || [];
      assert(
        summary.length === 1,
        `Expected 1 product summary row for ${expectedLabel}, got ${summary.length}`,
      );
      assert(
        summary.every(
          (item) =>
            item.branchLabel === expectedLabel || item.billingLabel === expectedLabel,
        ),
        `Product summary for ${expectedLabel} must not include other branches: ${JSON.stringify(summary)}`,
      );
      assert(
        quotation.branchSummary?.productCount === 1,
        `Expected productCount 1 for ${expectedLabel}`,
      );
      assert(
        quotation.branchSummary?.branchCount === 1 ||
          quotation.branchSummary?.billingBranchId ||
          quotation.invoices?.[0]?.billingBranchId,
        "Expected per-branch metadata on quotation",
      );
    }

    const labels = quotations.map(
      (entry) =>
        entry.branchSummary?.branchLabel || entry.invoices?.[0]?.branchLabel || "",
    );
    assert(labels.includes("Head office"), "Expected Head office quote label");
    assert(labels.includes("Branch B"), "Expected Branch B quote label");

    for (const quotation of quotations) {
      await approveQuotation(quotation.id, "finance@test.com", "per-branch finance smoke");
      const branchId = quotation.invoices?.[0]?.billingBranchId;
      const grandTotal = Number(quotation.invoices?.[0]?.grandTotal || 1180);
      await attachPaymentToQuotation(quotation.id, {
        provider: "stripe",
        paymentLinkUrl: `https://checkout.stripe.example/${quotation.id}`,
        paymentLinkId: `plink_${marker}_${branchId}`,
        subtotal: Number(quotation.invoices?.[0]?.subtotal || 1000),
        grandTotal,
        currency: "INR",
        amountLabel: `INR ${grandTotal.toFixed(2)}`,
        status: PAYMENT_STATUSES.PENDING,
        dryRun: true,
      });
    }

    const approvedQuotes = await Promise.all(quotationIds.map((id) => getQuotation(id)));
    const linkIds = approvedQuotes.map((entry) => entry.payment?.paymentLinkId).filter(Boolean);
    assert(linkIds.length === 2, `Expected 2 payment links, got ${linkIds.length}`);
    assert(new Set(linkIds).size === 2, "Expected distinct payment link ids");

    const hqQuote = approvedQuotes.find(
      (entry) => entry.invoices?.[0]?.billingBranchId === "hq",
    );
    const branchBQuote = approvedQuotes.find(
      (entry) => entry.invoices?.[0]?.billingBranchId === branchBId,
    );
    assert(hqQuote && branchBQuote, "Expected HQ and Branch B quotations");

    await payQuotation(hqQuote.id, "hq");

    const afterFirstHq = await getQuotation(hqQuote.id);
    assert(afterFirstHq.status === QUOTATION_STATUSES.PAID, "HQ quote should be Paid");
    const afterFirstBranchB = await getQuotation(branchBQuote.id);
    assert(
      afterFirstBranchB.status === QUOTATION_STATUSES.APPROVED,
      "Branch B quote should still be Approved",
    );

    const leadAfterFirst = await getLeadById(leadId);
    assert(
      leadAfterFirst.status === "Partially paid",
      `Lead must be Partially paid after only one branch quote; got ${leadAfterFirst.status}`,
    );

    const orgClient = await pool.connect();
    let organizationId;
    try {
      const { organization } = await ensureOrganizationForPaidLead(leadId, orgClient);
      organizationId = organization.id;
    } finally {
      orgClient.release();
    }

    await issueAndLoginBranch(leadId, "hq", hqEmail, "Head office");

    await payQuotation(branchBQuote.id, "branch-b");

    const finalHq = await getQuotation(hqQuote.id);
    const finalBranchB = await getQuotation(branchBQuote.id);
    assert(finalHq.status === QUOTATION_STATUSES.PAID, "HQ quote should remain Paid");
    assert(finalBranchB.status === QUOTATION_STATUSES.PAID, "Branch B quote should be Paid");

    const leadFinal = await getLeadById(leadId);
    assert(leadFinal.status === "Paid", `Expected lead Paid, got ${leadFinal.status}`);

    const aggregatePayment = await getApprovedQuotationPayment(leadId);
    assert(aggregatePayment?.payment, "Expected an aggregated payment record for the lead");
    const branchPayments = aggregatePayment.payment.branchPayments || [];
    assert(
      branchPayments.length === 2,
      `Expected 2 branch payments in aggregate, got ${branchPayments.length}`,
    );
    assert(
      aggregatePayment.payment.status === "paid",
      `Expected aggregate payment status paid, got ${aggregatePayment.payment.status}`,
    );
    const aggregateLabels = branchPayments.map((entry) => entry.branchLabel);
    assert(aggregateLabels.includes("Head office"), "Aggregate must include Head office payment");
    assert(aggregateLabels.includes("Branch B"), "Aggregate must include Branch B payment");
    assert(
      branchPayments.every((entry) => entry.status === "paid"),
      "Each branch payment should be paid",
    );
    assert(
      (aggregatePayment.invoices || []).length === 2,
      `Expected merged invoices from both branches, got ${(aggregatePayment.invoices || []).length}`,
    );

    console.log(
      "[smoke-test-per-branch-finance] OK — aggregate exposes both branch payments",
    );

    await issueAndLoginBranch(leadId, branchBId, branchBEmail, "Branch B");

    const branchUsers = await countBranchUsers(organizationId);
    assert(
      branchUsers.length >= 2,
      `Expected at least 2 branch portal users, got ${branchUsers.length}`,
    );
    const emails = new Set(branchUsers.map((row) => row.email));
    assert(emails.has(hqEmail), "Expected HQ branch portal email");
    assert(emails.has(branchBEmail), "Expected Branch B portal email");

    console.log(
      "[smoke-test-per-branch-finance] OK — 2 quotes, 2 links, 2 branch credentials, lead Paid after both",
    );

    // Separate deal: pay HQ only → Partially paid
    const partialLead = await createLead(withSmokeLeadContact({
      companyName: `Partial Pay ${marker}`,
      billingAddress: "HQ Street 1",
      workEmail: `${marker}-partial-hq@example.com`,
      additionalAddresses: [
        {
          id: crypto.randomUUID(),
          label: "Branch P",
          address: "Branch P Street",
          country: "IN",
          workEmail: `${marker}-partial-b@example.com`,
        },
      ],
    }));
    partialLeadId = partialLead.id;
    const partialBranchId = partialLead.additionalAddresses[0].id;
    const { quotations: partialQuotes } = await createQuotationsForFinance({
      leadId: partialLead.id,
      lead: partialLead,
      fileName: `${marker}-partial.pdf`,
      pdfBase64: "dGVzdA==",
      invoiceMode: "per_branch",
      subtotal: 2000,
      grandTotal: 2360,
      currency: "INR",
      assignments: [
        {
          productId: "contact-center",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
        {
          productId: "contact-center",
          branchId: partialBranchId,
          billingBranchId: partialBranchId,
          changeType: "new",
        },
      ],
      invoices: [
        {
          fileName: `${marker}-partial-hq.pdf`,
          pdfBase64: "aHE=",
          billingBranchId: "hq",
          branchLabel: "Head office",
          subtotal: 1000,
          grandTotal: 1180,
        },
        {
          fileName: `${marker}-partial-b.pdf`,
          pdfBase64: "YnI=",
          billingBranchId: partialBranchId,
          branchLabel: "Branch P",
          subtotal: 1000,
          grandTotal: 1180,
        },
      ],
      productSummary: [
        {
          productId: "contact-center",
          name: "Contact center",
          branchLabel: "Head office",
          billingLabel: "Head office",
        },
        {
          productId: "contact-center",
          name: "Contact center",
          branchLabel: "Branch P",
          billingLabel: "Branch P",
        },
      ],
    });
    partialQuotationIds = partialQuotes.map((entry) => entry.id);
    for (const quotation of partialQuotes) {
      await approveQuotation(quotation.id, "finance@test.com", "partial pay smoke");
      const grandTotal = Number(quotation.invoices?.[0]?.grandTotal || 1180);
      await attachPaymentToQuotation(quotation.id, {
        provider: "stripe",
        paymentLinkUrl: `https://checkout.stripe.example/${quotation.id}`,
        paymentLinkId: `plink_partial_${quotation.id}`,
        subtotal: Number(quotation.invoices?.[0]?.subtotal || 1000),
        grandTotal,
        currency: "INR",
        amountLabel: `INR ${grandTotal.toFixed(2)}`,
        status: PAYMENT_STATUSES.PENDING,
        dryRun: true,
      });
    }
    const partialHq = partialQuotes.find((entry) => entry.invoices?.[0]?.billingBranchId === "hq");
    await payQuotation(partialHq.id, "partial-hq");
    const leadPartial = await getLeadById(partialLead.id);
    assert(
      leadPartial.status === "Partially paid",
      `Expected Partially paid after one branch payment, got ${leadPartial.status}`,
    );
    console.log("[smoke-test-per-branch-finance] OK — one branch paid → lead Partially paid");

    const singleLead = await createLead(withSmokeLeadContact({
      companyName: `Single Branch Finance ${marker}`,
      billingAddress: "Solo Street 1",
      workEmail: `${marker}-single@example.com`,
    }));
    singleLeadId = singleLead.id;

    const { quotations: singleQuotations } = await createQuotationsForFinance({
      leadId: singleLeadId,
      lead: singleLead,
      fileName: `${marker}-single.pdf`,
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
      invoices: [
        {
          fileName: `${marker}-single-hq.pdf`,
          pdfBase64: "aHE=",
          billingBranchId: "hq",
          branchLabel: "Head office",
          subtotal: 1000,
          grandTotal: 1180,
        },
      ],
    });

    assert(
      singleQuotations.length === 1,
      `Expected 1 single-branch quotation, got ${singleQuotations.length}`,
    );
    singleQuotationIds = singleQuotations.map((entry) => entry.id);
    const singleQuotation = singleQuotations[0];

    await approveQuotation(singleQuotation.id, "finance@test.com", "single-branch smoke");
    await attachPaymentToQuotation(singleQuotation.id, {
      provider: "stripe",
      paymentLinkUrl: `https://checkout.stripe.example/${singleQuotation.id}`,
      paymentLinkId: `plink_${marker}_single`,
      subtotal: 1000,
      grandTotal: 1180,
      currency: "INR",
      amountLabel: "INR 1180.00",
      status: PAYMENT_STATUSES.PENDING,
      dryRun: true,
    });
    await payQuotation(singleQuotation.id, "single");

    const singleAggregate = await getApprovedQuotationPayment(singleLeadId);
    assert(singleAggregate?.payment, "Expected a payment record for the single-branch lead");
    assert(
      (singleAggregate.payment.branchPayments || []).length === 0,
      "Single-branch lead should not synthesize branch payments",
    );
    assert(
      singleAggregate.payment.status === "paid",
      `Expected single-branch payment paid, got ${singleAggregate.payment.status}`,
    );
    assert(
      Boolean(singleAggregate.payment.paidAt),
      "Single-branch payment should expose paidAt",
    );

    console.log(
      "[smoke-test-per-branch-finance] OK — single-branch payment stays single (backward compatible)",
    );
  } finally {
    await cleanup(leadId, quotationIds);
    await cleanup(singleLeadId, singleQuotationIds);
    await cleanup(partialLeadId, partialQuotationIds);
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[smoke-test-per-branch-finance] FAILED:", error);
  process.exit(1);
});
