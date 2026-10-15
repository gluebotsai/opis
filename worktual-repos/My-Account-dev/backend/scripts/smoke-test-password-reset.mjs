/**
 * Smoke test: forgot-password OTP flow (request → verify → confirm → login).
 * Forces MAIL_DRY_RUN so admin Outlook is not required.
 */
import "../src/config/load-env.js";

process.env.MAIL_DRY_RUN = "true";

import { migrateDatabase } from "../src/db/migrate.js";
import { pool, query } from "../src/db/pool.js";
import { loginUser } from "../src/modules/auth/session-auth.js";
import { hashPassword } from "../src/modules/users/user-store.js";
import { createLead } from "../src/modules/leads/lead-store.js";
import { createPartner } from "../src/modules/partners/partner-store.js";
import { createReseller } from "../src/modules/resellers/reseller-store.js";
import { gstinWithChecksum } from "../src/modules/platform/tax-number.js";
import {
  confirmPasswordReset,
  requestPasswordResetOtp,
  resolvePasswordResetAccount,
  verifyPasswordResetOtp,
} from "../src/modules/auth/password-reset.js";

const marker = `pwd-reset-smoke-${Date.now()}`;
const salesEmail = `sales-${marker}@example.com`;
const adminEmail = `admin-${marker}@example.com`;
const partnerEmail = `partner-${marker}@example.com`;
const resellerEmail = `reseller-${marker}@example.com`;
const customerEmail = `customer-${marker}@example.com`;
const oldPassword = "OldSmokePass1!";
const newPassword = "NewSmokePass2!";
const API = process.env.VITE_API_PROXY || `http://127.0.0.1:${process.env.MAIL_API_PORT || 3002}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureUser({ email, role, displayName, password }) {
  const hashed = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (email, password, role, display_name, department, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, TRUE, 'smoke-test', 'smoke-test')
     ON CONFLICT (email) DO UPDATE SET
       password = EXCLUDED.password,
       role = EXCLUDED.role,
       is_active = TRUE,
       updated_at = NOW()
     RETURNING id, email, role`,
    [email.toLowerCase(), hashed, role, displayName, role === "admin" ? "Admin" : "Sales"],
  );
  return rows[0];
}

async function cleanup(
  userIds,
  emails,
  { partnerId = null, resellerId = null, orgId = null, leadId = null } = {},
) {
  const client = await pool.connect();
  try {
    for (const email of emails) {
      await client.query(`DELETE FROM password_reset_otps WHERE lower(email) = lower($1)`, [email]);
    }
    for (const userId of userIds) {
      await client.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
    if (orgId) {
      await client.query(`DELETE FROM customer_auth_sessions WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM customer_users WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    if (leadId) {
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM lead_assignments WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
    if (partnerId) {
      await client.query(`DELETE FROM partner_auth_sessions WHERE partner_id = $1`, [partnerId]);
      await client.query(`DELETE FROM partner_users WHERE partner_id = $1`, [partnerId]);
      await client.query(`DELETE FROM partners WHERE id = $1`, [partnerId]);
    }
    if (resellerId) {
      await client.query(`DELETE FROM reseller_auth_sessions WHERE reseller_id = $1`, [resellerId]);
      await client.query(`DELETE FROM reseller_users WHERE reseller_id = $1`, [resellerId]);
      await client.query(`DELETE FROM resellers WHERE id = $1`, [resellerId]);
    }
  } finally {
    client.release();
  }
}

async function http(path, body) {
  try {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: response.status, data, reachable: true };
  } catch (error) {
    return {
      status: 0,
      data: { error: error instanceof Error ? error.message : String(error) },
      reachable: false,
    };
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-password-reset] DATABASE_URL is not set");
    process.exit(1);
  }

  console.log("[smoke-test-password-reset] MAIL_DRY_RUN forced true");
  await migrateDatabase();

  const userIds = [];
  const emails = [
    salesEmail,
    adminEmail,
    partnerEmail,
    resellerEmail,
    customerEmail,
    `missing-${marker}@example.com`,
  ];
  let partnerId = null;
  let resellerId = null;
  let orgId = null;
  let leadId = null;

  try {
    const sales = await ensureUser({
      email: salesEmail,
      role: "sales",
      displayName: "Smoke Sales",
      password: oldPassword,
    });
    const admin = await ensureUser({
      email: adminEmail,
      role: "admin",
      displayName: "Smoke Admin",
      password: oldPassword,
    });
    userIds.push(sales.id, admin.id);

    const partner = await createPartner({
      companyName: `Partner ${marker}`,
      contactName: "Partner Contact",
      workEmail: `work-${marker}@partner.test`,
      country: "India",
      loginEmail: partnerEmail,
      password: oldPassword,
      displayName: "Partner Portal Smoke",
    });
    partnerId = partner.id;

    const resellerGst = gstinWithChecksum(`29AAAAA${String(Date.now()).slice(-4)}A1Z`);
    const reseller = await createReseller({
      companyName: `Reseller ${marker}`,
      contactName: "Reseller Contact",
      workEmail: `ops-${marker}@reseller.test`,
      invoiceEmail: `billing-${marker}@reseller.test`,
      taxNumber: resellerGst,
      billingAddress: "2 Reseller Road",
      country: "India",
      mobileCountryCode: "+91",
      mobileNumber: `9${String(Date.now()).slice(-9)}`,
      loginEmail: resellerEmail,
      password: oldPassword,
      displayName: "Reseller Portal Smoke",
    });
    resellerId = reseller.id;

    const customerLead = await createLead({
      companyName: `Customer Org ${marker}`,
      industryType: "Technology",
      businessType: "B2B",
      country: "India",
      companySize: "11-50",
      contactName: "Customer Admin",
      designation: "Admin",
      workEmail: `work-${marker}@customer.test`,
      adminEmail: customerEmail,
      mobileCountryCode: "+91",
      mobileNumber: `8${String(Date.now()).slice(-9)}`,
      billingAddress: "1 Customer Street",
      taxNumber: gstinWithChecksum(`29BBBBB${String(Date.now()).slice(-4)}A1Z`),
      state: "Karnataka",
    });
    leadId = customerLead.id;

    const hashedCustomer = await hashPassword(oldPassword);
    const { rows: orgRows } = await query(
      `INSERT INTO organizations (
         source_lead_id, tenant_id, company_name, contact_name, work_email, admin_email, country,
         lifecycle_status, converted_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'India', 'active', NOW())
       RETURNING id`,
      [
        leadId,
        `tp${String(Date.now()).slice(-14)}`,
        `Customer Org ${marker}`,
        "Customer Admin",
        `work-${marker}@customer.test`,
        customerEmail,
      ],
    );
    orgId = orgRows[0].id;
    await query(
      `INSERT INTO customer_users (
         organization_id, email, password_hash, display_name, role, branch_id, is_active
       ) VALUES ($1, $2, $3, $4, 'branch_user', 'hq', TRUE)`,
      [orgId, customerEmail.toLowerCase(), hashedCustomer, "Customer Portal Smoke"],
    );

    // 1) Account resolution
    const salesAccount = await resolvePasswordResetAccount(salesEmail);
    assert(salesAccount?.accountType === "internal", "Sales should be resettable");
    assert(!salesAccount.blocked, "Sales must not be blocked");

    const adminAccount = await resolvePasswordResetAccount(adminEmail);
    assert(adminAccount?.blocked === true, "Admin must be blocked from reset");

    const missing = await resolvePasswordResetAccount(`missing-${marker}@example.com`);
    assert(missing === null, "Unknown email should resolve to null");

    for (const [label, email, expectedType] of [
      ["partner", partnerEmail, "partner"],
      ["reseller", resellerEmail, "reseller"],
      ["customer", customerEmail, "customer"],
    ]) {
      const account = await resolvePasswordResetAccount(email);
      assert(account?.accountType === expectedType, `${label} should resolve as ${expectedType}`);
      const portalReq = await requestPasswordResetOtp(email);
      assert(portalReq.ok === true, `${label} OTP request should succeed`);
      assert(/^\d{6}$/.test(portalReq.dryRunOtp || ""), `${label} should return dryRunOtp`);
      await query(`DELETE FROM password_reset_otps WHERE lower(email) = lower($1)`, [email]);
    }
    console.log("[smoke-test-password-reset] OK — partner/reseller/customer OTP dry-run");

    // 2) Unknown email → explicit not-found error (no OTP)
    let unknownFailed = false;
    try {
      await requestPasswordResetOtp(`missing-${marker}@example.com`);
    } catch (error) {
      unknownFailed = true;
      assert(
        /no account found/i.test(error instanceof Error ? error.message : String(error)),
        "Unknown email should report account not found",
      );
    }
    assert(unknownFailed, "Unknown email request must fail");

    // 3) Admin → generic success, no OTP issued
    const adminReq = await requestPasswordResetOtp(adminEmail);
    assert(adminReq.ok === true, "Admin request should return ok");
    assert(!adminReq.dryRunOtp, "Admin must not receive OTP");
    const { rows: adminOtps } = await query(
      `SELECT id FROM password_reset_otps WHERE lower(email) = lower($1) AND consumed_at IS NULL`,
      [adminEmail],
    );
    assert(adminOtps.length === 0, "Admin must not get an open OTP row");

    // 4) Sales request → OTP (dry-run)
    const request = await requestPasswordResetOtp(salesEmail);
    assert(request.ok === true, "Sales request should succeed");
    assert(
      /6-digit code was sent/i.test(request.message || ""),
      "Sales success message should confirm code was sent",
    );
    assert(/^\d{6}$/.test(request.dryRunOtp || ""), `Expected dryRunOtp, got ${request.dryRunOtp}`);

    // 5) Wrong OTP rejected
    let wrongFailed = false;
    try {
      await verifyPasswordResetOtp(salesEmail, "000000");
    } catch {
      wrongFailed = true;
    }
    assert(wrongFailed, "Wrong OTP should fail");

    // 6) Correct OTP → reset token
    const verified = await verifyPasswordResetOtp(salesEmail, request.dryRunOtp);
    assert(verified.resetToken, "Verify should return resetToken");

    // 7) Confirm password
    const confirmed = await confirmPasswordReset({
      email: salesEmail,
      resetToken: verified.resetToken,
      password: newPassword,
    });
    assert(confirmed.ok === true, "Confirm should succeed");

    // 8) Login with new password works; old fails
    const session = await loginUser(salesEmail, newPassword);
    assert(session?.token, "Login with new password should work");

    let oldRejected = false;
    try {
      await loginUser(salesEmail, oldPassword);
    } catch {
      oldRejected = true;
    }
    assert(oldRejected, "Old password must not login");

    // 9) Consumed OTP cannot be reused
    let reuseFailed = false;
    try {
      await verifyPasswordResetOtp(salesEmail, request.dryRunOtp);
    } catch {
      reuseFailed = true;
    }
    assert(reuseFailed, "Consumed OTP must not verify again");

    // 10) HTTP endpoints (optional if API is up with latest code)
    const health = await http("/api/health", {});
    if (!health.reachable || health.status !== 200 && health.status !== 0) {
      // GET via fetch POST body won't work for health - use GET
    }
    let apiHealthOk = false;
    try {
      const hr = await fetch(`${API}/api/health`);
      apiHealthOk = hr.ok;
    } catch {
      apiHealthOk = false;
    }

    if (apiHealthOk) {
      const httpUnknown = await http("/api/auth/password-reset/request", {
        email: `http-missing-${marker}@example.com`,
      });
      if (httpUnknown.status === 404) {
        console.warn(
          "[smoke-test-password-reset] API running but password-reset routes missing — restart mail API",
        );
      } else {
        assert(httpUnknown.status === 400, `HTTP request unknown: ${httpUnknown.status}`);
        assert(
          /no account found/i.test(httpUnknown.data?.error || ""),
          "HTTP unknown should return not-found error",
        );
        console.log("[smoke-test-password-reset] HTTP request endpoint reachable");

        // Regression: Content-Type + known sales email must parse body (not silent not_found).
        // Re-insert sales row — confirmPasswordReset already ran; password may have changed.
        await ensureUser({
          email: salesEmail,
          role: "sales",
          displayName: "Smoke Sales",
          password: newPassword,
        });
        const httpSales = await http("/api/auth/password-reset/request", {
          email: salesEmail,
        });
        assert(httpSales.status === 200 || httpSales.status === 503, `HTTP sales request: ${httpSales.status}`);
        if (httpSales.status === 200) {
          assert(httpSales.data?.ok === true, "HTTP sales request should return ok");
          const { rows: httpOtps } = await query(
            `SELECT id FROM password_reset_otps WHERE lower(email) = lower($1) AND consumed_at IS NULL`,
            [salesEmail],
          );
          assert(
            httpOtps.length >= 1,
            "HTTP sales request must create an OTP row (Content-Type body must reach the API)",
          );
          // dryRunOtp only present when the *API process* has MAIL_DRY_RUN=true.
          if (httpSales.data?.dryRunOtp) {
            assert(/^\d{6}$/.test(httpSales.data.dryRunOtp), "HTTP dryRunOtp should be 6 digits");
            console.log("[smoke-test-password-reset] HTTP sales request returned dryRunOtp");
          } else {
            console.log(
              "[smoke-test-password-reset] HTTP sales request created OTP (API may send real mail)",
            );
          }
        } else {
          // 503 = body was parsed but admin mailbox unavailable — still proves Content-Type works.
          console.log(
            "[smoke-test-password-reset] HTTP sales request reached send path (503 mailbox unavailable)",
          );
        }
      }
    } else {
      console.warn(`[smoke-test-password-reset] API not reachable at ${API}; skipped HTTP checks`);
    }

    console.log("[smoke-test-password-reset] PASS");
  } finally {
    await cleanup(userIds, emails, { partnerId, resellerId, orgId, leadId });
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("[smoke-test-password-reset] FAIL:", error instanceof Error ? error.message : error);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
