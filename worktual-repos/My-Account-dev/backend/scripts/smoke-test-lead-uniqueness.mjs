/**
 * CI smoke test: lead contact and GST uniqueness validation.
 */
import "../src/config/load-env.js";
import crypto from "node:crypto";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { applySmokeDbTimeouts } from "./lib/smokeDbTimeouts.mjs";
import { createLead, updateLead } from "../src/modules/leads/lead-store.js";
import { gstinWithChecksum, isValidGstin } from "../src/modules/platform/tax-number.js";
import { cleanupPaymentSmokeLead } from "./lib/smoke-payment-cleanup.mjs";
import { createUser } from "../src/modules/users/user-store.js";

const marker = `lead-uniqueness-${Date.now()}`;
const uniqueDigits = crypto.randomInt(1_000_000_000, 9_999_999_999);
const leadAPhone = `9${String(uniqueDigits).slice(0, 9)}`;
const leadBPhone = `8${String(uniqueDigits).slice(0, 9)}`;
const puneBranchPhone = `70${String(uniqueDigits).slice(0, 8)}`;
const bangaloreBranchPhone = `71${String(uniqueDigits).slice(0, 8)}`;
const gstNumber = gstinWithChecksum(`27AAAAA${String(uniqueDigits).slice(-4)}A1Z`);
const sharedState = "Maharashtra";
const otherState = "Karnataka";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(isValidGstin(gstNumber), `Smoke GSTIN fixture must be valid, got "${gstNumber}"`);

async function expectFailure(label, promise, expectedFragment) {
  try {
    await promise;
    throw new Error(`${label}: expected failure but operation succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("expected failure but operation succeeded")) {
      throw error;
    }
    assert(
      !expectedFragment || message.toLowerCase().includes(expectedFragment.toLowerCase()),
      `${label}: expected message containing "${expectedFragment}", got "${message}"`,
    );
  }
}

async function cleanup(ids) {
  for (const leadId of ids.leadIds || []) {
    await cleanupPaymentSmokeLead(leadId);
  }

  const client = await pool.connect();
  try {
    for (const customerUserId of ids.customerUserIds || []) {
      await client.query(`DELETE FROM customer_auth_sessions WHERE customer_user_id = $1`, [
        customerUserId,
      ]);
      await client.query(`DELETE FROM customer_users WHERE id = $1`, [customerUserId]);
    }
    for (const userId of ids.userIds || []) {
      await client.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  } finally {
    client.release();
  }
}

function baseLeadPayload(overrides = {}) {
  return {
    companyName: `Uniqueness Smoke ${marker}`,
    industryType: "Technology",
    businessType: "B2B",
    country: "India",
    companySize: "11-50",
    contactName: "Smoke Tester",
    designation: "Manager",
    workEmail: `lead-a-${marker}@example.com`,
    adminEmail: `admin-a-${marker}@example.com`,
    mobileCountryCode: "+91",
    mobileNumber: leadAPhone,
    billingAddress: "100 Uniqueness Street",
    taxNumber: gstNumber,
    state: sharedState,
    ...overrides,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-lead-uniqueness] DATABASE_URL is not set");
    process.exit(1);
  }

  applySmokeDbTimeouts(pool);
  await migrateDatabase();

  const ids = { leadIds: [], userIds: [], organizationIds: [], customerUserIds: [] };

  try {
    const leadA = await createLead(baseLeadPayload());
    ids.leadIds.push(leadA.id);

    await expectFailure(
      "duplicate work email across leads",
      createLead(
        baseLeadPayload({
          companyName: `Duplicate Email ${marker}`,
          workEmail: `lead-a-${marker}@example.com`,
          adminEmail: `admin-b-${marker}@example.com`,
          mobileNumber: leadBPhone,
          taxNumber: gstinWithChecksum(`29DDDDD${String(uniqueDigits).slice(-4)}A1Z`),
          state: otherState,
        }),
      ),
      "work email",
    );

    await expectFailure(
      "duplicate mobile across leads",
      createLead(
        baseLeadPayload({
          companyName: `Duplicate Phone ${marker}`,
          workEmail: `lead-b-${marker}@example.com`,
          adminEmail: `admin-c-${marker}@example.com`,
          mobileNumber: leadAPhone,
          taxNumber: gstinWithChecksum(`29EEEEE${String(uniqueDigits).slice(-4)}A1Z`),
          state: otherState,
        }),
      ),
      "mobile number",
    );

    const staffEmail = `staff-login-${marker}@example.com`;
    const staffUser = await createUser(
      {
        email: staffEmail,
        password: "Smoke-test-password-1",
        role: "sales",
        displayName: "Smoke Staff Login",
        mobileCountryCode: "+91",
        mobileNumber: `7${String(uniqueDigits).slice(0, 9)}`,
      },
      "smoke-test",
    );
    ids.userIds.push(staffUser.id);

    await expectFailure(
      "lead work email conflicts with staff login",
      createLead(
        baseLeadPayload({
          companyName: `Staff Email Clash ${marker}`,
          workEmail: staffEmail,
          adminEmail: `admin-staff-${marker}@example.com`,
          mobileNumber: `6${String(uniqueDigits).slice(0, 9)}`,
          taxNumber: gstinWithChecksum(`29BBBBB${String(uniqueDigits).slice(-4)}A1Z`),
          state: otherState,
        }),
      ),
      "staff user",
    );

    const portalEmail = `portal-${marker}@example.com`;
    // createLead already creates a prospect organization (unique source_lead_id).
    const { rows: orgRows } = await pool.query(
      `SELECT organization_id FROM leads WHERE id = $1`,
      [leadA.id],
    );
    const organizationId = orgRows[0]?.organization_id;
    assert(organizationId, "Expected prospect organization_id on lead A");
    ids.organizationIds.push(organizationId);

    await pool.query(
      `UPDATE organizations
       SET work_email = $2,
           admin_email = $2,
           lifecycle_status = 'active',
           updated_at = NOW()
       WHERE id = $1`,
      [organizationId, portalEmail],
    );

    const customerInsert = await pool.query(
      `INSERT INTO customer_users (
         organization_id, email, password_hash, display_name, role, branch_id, is_active
       ) VALUES ($1, $2, 'smoke-hash', 'Portal User', 'branch_user', 'hq', TRUE)
       RETURNING id`,
      [organizationId, portalEmail],
    );
    ids.customerUserIds.push(customerInsert.rows[0].id);

    await expectFailure(
      "lead work email conflicts with customer portal login",
      createLead(
        baseLeadPayload({
          companyName: `Portal Email Clash ${marker}`,
          workEmail: portalEmail,
          adminEmail: `admin-portal-${marker}@example.com`,
          mobileNumber: `61${String(uniqueDigits).slice(0, 8)}`,
          taxNumber: gstinWithChecksum(`29CCCCC${String(uniqueDigits).slice(-4)}A1Z`),
          state: otherState,
        }),
      ),
      "customer portal",
    );

    const withSameStateBranch = await updateLead(leadA.id, {
      additionalAddresses: [
        {
          id: crypto.randomUUID(),
          label: "Pune branch",
          address: "200 Branch Road, Pune",
          country: "India",
          state: sharedState,
          taxNumber: gstNumber,
          mobileCountryCode: "+91",
          mobileNumber: puneBranchPhone,
        },
      ],
    });
    assert(withSameStateBranch, "Update with same-state shared GST failed unexpectedly");
    assert(
      withSameStateBranch.additionalAddresses?.length === 1,
      "Expected one additional address after update",
    );

    await expectFailure(
      "same GST in different state within company",
      updateLead(leadA.id, {
        additionalAddresses: [
          ...(withSameStateBranch.additionalAddresses || []),
          {
            id: crypto.randomUUID(),
            label: "Bangalore branch",
            address: "300 Branch Road, Bangalore",
            country: "India",
            state: otherState,
            taxNumber: gstNumber,
            mobileCountryCode: "+91",
            mobileNumber: bangaloreBranchPhone,
          },
        ],
      }),
      "must start with 29",
    );

    await expectFailure(
      "staff user with lead phone",
      createUser(
        {
          email: `staff-${marker}@example.com`,
          password: "Smoke-test-password-1",
          role: "sales",
          displayName: "Smoke Staff",
          mobileCountryCode: "+91",
          mobileNumber: leadAPhone,
        },
        "smoke-test",
      ),
      "mobile number",
    );

    console.log("[smoke-test-lead-uniqueness] PASS");
  } catch (error) {
    console.error(
      "[smoke-test-lead-uniqueness] FAIL:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await cleanup(ids);
    await pool.end();
  }
}

await main();
