/**
 * Welcome email delivery smoke tests: portal contact policy, delivery states,
 * confirm→login credentials (no resend required), and PENDING idempotency.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import {
  resolveCustomerCcEmails,
  resolvePortalLoginEmail,
} from "../src/lib/customer-contact.js";
import {
  loginCustomerUser,
  regenerateCustomerPortalPassword,
} from "../src/modules/customer-portal/customer-auth.js";
import { ensureOrganizationForPaidLead } from "../src/modules/organizations/organization-store.js";
import { WELCOME_EMAIL_STATUSES } from "../src/modules/payments/constants.js";
import {
  recordWelcomeEmailDeliveryFromNotify,
  recordProviderPaymentReported,
  confirmFinancePayment,
} from "../src/modules/payments/fulfillment.js";
import { pool } from "../src/db/pool.js";
import { createLead } from "../src/modules/leads/lead-store.js";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";
import {
  approveQuotation,
  attachPaymentToQuotation,
  createQuotation,
  getQuotation,
} from "../src/modules/quotations/quotation-store.js";

const marker = `welcome-smoke-${Date.now()}`;

async function cleanup(leadId, quotationId) {
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
    if (quotationId) {
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
      await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_summary_items WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM payments WHERE quotation_id = $1`, [quotationId]);
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function rotatePortalCredentials(lead) {
  const client = await pool.connect();
  try {
    const { organization } = await ensureOrganizationForPaidLead(lead.id, client);
    assert(organization?.id, "Organization missing after confirm");
    const portalAccess = await regenerateCustomerPortalPassword(client, organization.id, {
      workEmail: lead.workEmail,
      adminEmail: lead.adminEmail,
      contactName: lead.contactName,
    });
    assert(portalAccess?.temporaryPassword, "Expected temporary password after regenerate");
    assert(portalAccess?.email, "Expected portal login email after regenerate");
    return portalAccess;
  } finally {
    client.release();
  }
}

async function readPasswordHash(email) {
  const { rows } = await pool.query(
    `SELECT password_hash FROM customer_users WHERE email = $1 ORDER BY updated_at DESC LIMIT 1`,
    [String(email).trim().toLowerCase()],
  );
  return rows[0]?.password_hash || null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-welcome-email] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const loginEmail = resolvePortalLoginEmail({
    adminEmail: "admin@acme.com",
    workEmail: "billing@acme.com",
  });
  assert(loginEmail === "admin@acme.com", "Portal login should prefer admin email");
  assert(
    resolveCustomerCcEmails({ adminEmail: "admin@acme.com", workEmail: "billing@acme.com" }).join(
      ",",
    ) === "billing@acme.com",
    "Work email should CC when different from login",
  );

  let leadId;
  let quotationId;

  try {
    const lead = await createLead(withSmokeLeadContact({
      companyName: `Welcome Smoke ${marker}`,
      billingAddress: "1 Test Street",
      workEmail: `billing-${marker}@acme.com`,
      adminEmail: `admin-${marker}@acme.com`,
    }));
    leadId = lead.id;

    const quotation = await createQuotation({
      leadId,
      lead,
      fileName: `${marker}.pdf`,
      pdfBase64: "dGVzdA==",
      subtotal: 1000,
      grandTotal: 1180,
      currency: "INR",
      assignments: [
        {
          productId: "product-welcome-smoke",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });
    quotationId = quotation.id;

    await approveQuotation(quotationId, "finance@test.com", "welcome smoke");
    await attachPaymentToQuotation(quotationId, {
      provider: "manual",
      subtotal: 1000,
      grandTotal: 1180,
      currency: "INR",
      amountLabel: "INR 1,180.00",
      status: "pending",
      dryRun: true,
    });

    await recordProviderPaymentReported({
      quotationId,
      providerPaymentId: `manual_${marker}`,
      sendNotifications: false,
    });

    await confirmFinancePayment({
      quotationId,
      financeConfirmedBy: "finance@test.com",
      sendNotifications: false,
    });

    // Mimic confirm's deliverWelcomeEmail({ regenerateCredentials: true }) — password
    // rotated immediately before send must work for login without a later resend.
    const firstAccess = await rotatePortalCredentials(lead);
    const firstSession = await loginCustomerUser(
      firstAccess.email,
      firstAccess.temporaryPassword,
    );
    assert(firstSession?.token, "Confirm credentials must allow login without resend");
    assert(
      firstAccess.email === resolvePortalLoginEmail(lead),
      "Login email must match lead admin/work policy",
    );

    // Resend rotates; only the new password works.
    const resentAccess = await rotatePortalCredentials(lead);
    assert(
      resentAccess.temporaryPassword !== firstAccess.temporaryPassword,
      "Resend must rotate temporary password",
    );
    let oldLoginFailed = false;
    try {
      await loginCustomerUser(firstAccess.email, firstAccess.temporaryPassword);
    } catch {
      oldLoginFailed = true;
    }
    assert(oldLoginFailed, "Old password must fail after resend rotation");
    const resentSession = await loginCustomerUser(
      resentAccess.email,
      resentAccess.temporaryPassword,
    );
    assert(resentSession?.token, "Resent credentials must allow login");

    // PENDING in-flight: re-confirm must not rotate again.
    await pool.query(
      `UPDATE payments SET welcome_email_status = $2, updated_at = NOW() WHERE quotation_id = $1`,
      [quotationId, WELCOME_EMAIL_STATUSES.PENDING],
    );
    const hashBefore = await readPasswordHash(resentAccess.email);
    const pendingRetry = await confirmFinancePayment({
      quotationId,
      financeConfirmedBy: "finance@test.com",
      sendNotifications: true,
    });
    assert(pendingRetry.alreadyPaid === true, "Expected alreadyPaid on second confirm");
    assert(pendingRetry.notified !== true, "PENDING must skip auto welcome delivery");
    const hashAfter = await readPasswordHash(resentAccess.email);
    assert(hashBefore === hashAfter, "PENDING confirm must not rotate password");
    const stillValid = await loginCustomerUser(
      resentAccess.email,
      resentAccess.temporaryPassword,
    );
    assert(stillValid?.token, "Credentials must remain valid while welcome is PENDING");

    const sentPayment = await recordWelcomeEmailDeliveryFromNotify(
      quotationId,
      {
        customerNotified: true,
        credentialsDelivered: true,
      },
      { channel: "queue" },
    );
    assert(
      sentPayment.welcomeEmailStatus === WELCOME_EMAIL_STATUSES.SENT,
      `Expected sent, got ${sentPayment.welcomeEmailStatus}`,
    );

    const downgraded = await recordWelcomeEmailDeliveryFromNotify(
      quotationId,
      {
        customerNotified: false,
        credentialsDelivered: false,
        customerEmailError: "simulated failure",
      },
      { channel: "queue" },
    );
    assert(
      downgraded.welcomeEmailStatus === WELCOME_EMAIL_STATUSES.SENT,
      "Sent status must not downgrade on worker retry failure",
    );

    await recordWelcomeEmailDeliveryFromNotify(quotationId, {
      customerNotified: true,
      credentialsDelivered: false,
    });
    const stillSent = await getQuotation(quotationId);
    assert(
      stillSent.payment?.welcomeEmailStatus === WELCOME_EMAIL_STATUSES.SENT,
      "Already sent should not become sent_without_credentials",
    );

    const freshLead = await createLead(withSmokeLeadContact({
      companyName: `Welcome Partial ${marker}`,
      billingAddress: "2 Test Street",
      workEmail: `${marker}@example.com`,
    }));
    const freshQuotation = await createQuotation({
      leadId: freshLead.id,
      lead: freshLead,
      fileName: `${marker}-2.pdf`,
      pdfBase64: "dGVzdA==",
      subtotal: 500,
      grandTotal: 590,
      currency: "INR",
      assignments: [
        {
          productId: "product-welcome-smoke",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });
    await approveQuotation(freshQuotation.id, "finance@test.com", "partial");
    await attachPaymentToQuotation(freshQuotation.id, {
      provider: "manual",
      grandTotal: 590,
      currency: "INR",
      amountLabel: "INR 590.00",
      status: "pending",
      dryRun: true,
    });
    await recordProviderPaymentReported({
      quotationId: freshQuotation.id,
      providerPaymentId: `manual_partial_${marker}`,
      sendNotifications: false,
    });
    await confirmFinancePayment({
      quotationId: freshQuotation.id,
      financeConfirmedBy: "finance@test.com",
      sendNotifications: false,
    });

    const partialOnly = await recordWelcomeEmailDeliveryFromNotify(freshQuotation.id, {
      customerNotified: true,
      credentialsDelivered: false,
    });
    assert(
      partialOnly.welcomeEmailStatus === WELCOME_EMAIL_STATUSES.SENT_WITHOUT_CREDENTIALS,
      `Expected sent_without_credentials, got ${partialOnly.welcomeEmailStatus}`,
    );

    await cleanup(freshLead.id, freshQuotation.id);

    console.log(
      "[smoke-test-welcome-email] OK — contact policy, confirm login, resend rotate, PENDING lock, delivery states",
    );
  } finally {
    if (leadId && quotationId) {
      await cleanup(leadId, quotationId);
    }
  }
}

main().catch((error) => {
  console.error("[smoke-test-welcome-email] FAILED:", error);
  process.exit(1);
});
