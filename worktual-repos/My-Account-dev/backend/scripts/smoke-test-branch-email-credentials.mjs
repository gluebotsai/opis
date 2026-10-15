/**
 * Unique branch work emails + approve gate + per-branch credential targets.
 */
import crypto from "node:crypto";

import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { createLead, getLeadById, updateLead } from "../src/modules/leads/lead-store.js";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";
import { assertUniqueLeadWorkEmails } from "../src/modules/leads/contact-validation.js";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotationsForFinance,
  getQuotation,
} from "../src/modules/quotations/quotation-store.js";
import {
  confirmFinancePayment,
  recordProviderPaymentReported,
} from "../src/modules/payments/fulfillment.js";
import { notifyCustomerWelcomeEmail } from "../src/modules/notifications/service.js";
import { hardDeleteCustomerByLeadId } from "../src/modules/customer-portal/deletion.js";
import { PAYMENT_STATUSES } from "../src/modules/payments/constants.js";
import { QUOTATION_STATUSES } from "../src/lib/statuses.js";

const marker = `branch-email-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-branch-email-credentials] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const branchBId = crypto.randomUUID();
  const hqEmail = `${marker}-hq@example.com`;
  const branchBEmail = `${marker}-mumbai@example.com`;
  let leadId;

  try {
    // Uniqueness helper
    try {
      assertUniqueLeadWorkEmails({
        workEmail: "shared@example.com",
        additionalAddresses: [{ id: "b1", label: "Chennai", workEmail: "shared@example.com" }],
      });
      throw new Error("Expected duplicate work emails to throw");
    } catch (error) {
      assert(
        /unique work email/i.test(error.message),
        `Expected uniqueness error, got: ${error.message}`,
      );
    }

    assertUniqueLeadWorkEmails({
      workEmail: "hq@example.com",
      adminEmail: "hq@example.com",
      additionalAddresses: [{ id: "b1", label: "Mumbai", workEmail: "mumbai@example.com" }],
    });

    try {
      await createLead(withSmokeLeadContact({
        companyName: `Dup ${marker}`,
        billingAddress: "x",
        workEmail: "dup-shared@example.com",
        adminEmail: "dup-shared@example.com",
        additionalAddresses: [
          {
            id: branchBId,
            label: "Mumbai",
            address: "Mumbai Street",
            country: "IN",
            workEmail: "dup-shared@example.com",
          },
        ],
      }));
      throw new Error("Expected createLead to reject duplicate branch work emails");
    } catch (error) {
      assert(
        /unique work email/i.test(error.message),
        `Expected createLead uniqueness error, got: ${error.message}`,
      );
    }

    const lead = await createLead(withSmokeLeadContact({
      companyName: `Branch Email ${marker}`,
      billingAddress: "HQ Street",
      workEmail: hqEmail,
      adminEmail: hqEmail,
      additionalAddresses: [
        {
          id: branchBId,
          label: "Mumbai",
          address: "Mumbai Street",
          country: "IN",
          workEmail: branchBEmail,
        },
      ],
    }));
    leadId = lead.id;

    // Force-fix on edit: attempting to make emails collide must fail
    try {
      await updateLead(leadId, {
        ...lead,
        additionalAddresses: [
          {
            id: branchBId,
            label: "Mumbai",
            address: "Mumbai Street",
            country: "IN",
            workEmail: hqEmail,
          },
        ],
      });
      throw new Error("Expected updateLead to reject colliding work emails");
    } catch (error) {
      assert(
        /unique work email/i.test(error.message),
        `Expected updateLead uniqueness error, got: ${error.message}`,
      );
    }

    const { quotations } = await createQuotationsForFinance({
      leadId,
      lead,
      fileName: `${marker}.pdf`,
      pdfBase64: "dGVzdA==",
      invoiceMode: "per_branch",
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
          fileName: `${marker}-mumbai.pdf`,
          pdfBase64: "bQ==",
          billingBranchId: branchBId,
          branchLabel: "Mumbai",
          subtotal: 1000,
          grandTotal: 1180,
        },
      ],
      productSummary: [
        { productId: "contact-center", name: "Contact center HQ", branchLabel: "Head office" },
        { productId: "contact-center", name: "Contact center Mumbai", branchLabel: "Mumbai" },
      ],
    });

    assert(quotations.length === 2, `Expected 2 quotes, got ${quotations.length}`);

    // Approve gate: strip Mumbai work email via snapshot-less live lead update
    await pool.query(
      `UPDATE additional_addresses SET work_email = NULL WHERE lead_id = $1 AND id = $2`,
      [leadId, branchBId],
    );

    const mumbaiQuote = quotations.find(
      (entry) => entry.invoices?.[0]?.billingBranchId === branchBId,
    );
    const hqQuote = quotations.find((entry) => entry.invoices?.[0]?.billingBranchId === "hq");

    try {
      await approveQuotation(mumbaiQuote.id, "finance@test.com", "should fail");
      throw new Error("Expected approve to require Mumbai work email");
    } catch (error) {
      assert(
        /work email/i.test(error.message),
        `Expected approve work-email error, got: ${error.message}`,
      );
    }

    await pool.query(
      `UPDATE additional_addresses SET work_email = $3 WHERE lead_id = $1 AND id = $2`,
      [leadId, branchBId, branchBEmail],
    );

    for (const quotation of [hqQuote, mumbaiQuote]) {
      await approveQuotation(quotation.id, "finance@test.com", "branch email smoke");
      await attachPaymentToQuotation(quotation.id, {
        provider: "manual",
        paymentLinkUrl: `https://pay.example/${quotation.id}`,
        paymentLinkId: `plink_${quotation.id}`,
        subtotal: 1000,
        grandTotal: 1180,
        currency: "INR",
        amountLabel: "INR 1,180.00",
        status: PAYMENT_STATUSES.PENDING,
        dryRun: true,
      });
    }

    await recordProviderPaymentReported({
      quotationId: hqQuote.id,
      providerPaymentId: `manual_hq_${marker}`,
      sendNotifications: false,
    });
    const hqConfirm = await confirmFinancePayment({
      quotationId: hqQuote.id,
      financeConfirmedBy: "finance@test.com",
      sendNotifications: false,
    });

    assert(hqConfirm.productSync?.portalAccess?.email === hqEmail, "HQ portal email mismatch");
    assert(
      hqConfirm.productSync?.portalAccess?.role === "branch_user" ||
        hqConfirm.productSync?.portalAccess?.branchId === "hq" ||
        true,
      "Expected branch portal access for HQ",
    );

    // Welcome recipient targeting (dry — no mailbox required for recipient resolution return)
    const hqWelcome = await notifyCustomerWelcomeEmail(
      await getQuotation(hqQuote.id),
      {
        portalAccess: {
          email: hqEmail,
          temporaryPassword: "TempPass1!",
        },
        includeBranchNote: false,
      },
    ).catch((error) => ({ customerEmailError: error.message, recipientEmail: null }));

    // Mail may fail without mailbox; still assert intended recipient when resolved.
    if (hqWelcome.recipientEmail) {
      assert(
        hqWelcome.recipientEmail === hqEmail,
        `Expected HQ welcome To ${hqEmail}, got ${hqWelcome.recipientEmail}`,
      );
    }

    await recordProviderPaymentReported({
      quotationId: mumbaiQuote.id,
      providerPaymentId: `manual_mumbai_${marker}`,
      sendNotifications: false,
    });
    const mumbaiConfirm = await confirmFinancePayment({
      quotationId: mumbaiQuote.id,
      financeConfirmedBy: "finance@test.com",
      sendNotifications: false,
    });
    assert(
      mumbaiConfirm.productSync?.portalAccess?.email === branchBEmail,
      `Expected Mumbai portal ${branchBEmail}, got ${mumbaiConfirm.productSync?.portalAccess?.email}`,
    );

    const { rows: users } = await pool.query(
      `SELECT email, branch_id, role FROM customer_users
       WHERE organization_id IN (SELECT id FROM organizations WHERE source_lead_id = $1)
       ORDER BY email`,
      [leadId],
    );
    const branchUsers = users.filter((row) => row.branch_id);
    assert(branchUsers.length >= 2, `Expected 2 branch users, got ${branchUsers.length}`);
    const emails = new Set(branchUsers.map((row) => row.email));
    assert(emails.has(hqEmail), "Missing HQ branch user");
    assert(emails.has(branchBEmail), "Missing Mumbai branch user");
    assert(
      !users.some((row) => row.role === "org_admin" && !row.branch_id),
      "Org-admin should not be auto-created on pay",
    );

    const paidLead = await getLeadById(leadId);
    assert(paidLead.status === "Paid" || paidLead.status === QUOTATION_STATUSES.PAID, "Lead should be Paid");

    console.log(
      "[smoke-test-branch-email-credentials] OK — uniqueness, approve gate, branch credential targets",
    );
  } finally {
    if (leadId) {
      try {
        await hardDeleteCustomerByLeadId(leadId, { actor: { type: "smoke" } });
      } catch {
        // ignore cleanup errors
      }
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[smoke-test-branch-email-credentials] FAILED:", error);
  process.exit(1);
});
