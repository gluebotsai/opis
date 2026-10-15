/**
 * Smoke: customer portal single-session + admin force-logout unlock.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { applySmokeDbTimeouts } from "./lib/smokeDbTimeouts.mjs";
import { createLead } from "../src/modules/leads/lead-store.js";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";
import { convertLeadToOrganization } from "../src/modules/organizations/organization-store.js";
import {
  ensureOrgAdminCustomerUser,
  forceLogoutCustomerUserByAdmin,
  loginCustomerUser,
  setCustomerPortalPassword,
} from "../src/modules/customer-portal/customer-auth.js";
import {
  SESSION_ALREADY_ACTIVE_CODE,
  isSessionAlreadyActiveError,
} from "../src/modules/auth/session-concurrency.js";
import { gstinWithChecksum } from "../src/modules/platform/tax-number.js";

const marker = `customer-session-${Date.now()}`;
const password = "CustomerSessionPass1!";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup({ leadId, orgId, customerUserId }) {
  const client = await pool.connect();
  try {
    if (customerUserId) {
      await client.query(`DELETE FROM customer_auth_sessions WHERE customer_user_id = $1`, [
        customerUserId,
      ]);
    }
    if (leadId) {
      await client.query(
        `UPDATE leads SET organization_id = NULL, converted_organization_id = NULL WHERE id = $1`,
        [leadId],
      );
    }
    if (orgId) {
      await client.query(`DELETE FROM product_access_grants WHERE customer_user_id IN (
        SELECT id FROM customer_users WHERE organization_id = $1
      )`, [orgId]);
      await client.query(`DELETE FROM customer_auth_sessions WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM customer_users WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organization_locations WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    if (leadId) {
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-customer-single-session] DATABASE_URL is not set");
    process.exit(1);
  }

  applySmokeDbTimeouts(pool);
  await migrateDatabase();

  let leadId = null;
  let orgId = null;
  let customerUserId = null;
  const email = `${marker}-admin@example.com`;

  try {
    const lead = await createLead(
      withSmokeLeadContact({
        companyName: `Customer Session ${marker}`,
        billingAddress: "1 Session Street",
        workEmail: `${marker}-hq@example.com`,
        adminEmail: email,
        taxNumber: gstinWithChecksum(`29AAAAA${String(Date.now()).slice(-4)}A1Z`),
        state: "Karnataka",
        country: "India",
      }),
    );
    leadId = lead.id;

    const client = await pool.connect();
    try {
      const { organization } = await convertLeadToOrganization(lead.id, client);
      orgId = organization.id;
      const ensured = await ensureOrgAdminCustomerUser(client, organization.id, {
        adminEmail: email,
        workEmail: `${marker}-hq@example.com`,
        contactName: "Session Admin",
      });
      customerUserId = ensured.user.id;
      await setCustomerPortalPassword(client, customerUserId, password);
      await client.query(`DELETE FROM customer_auth_sessions WHERE customer_user_id = $1`, [
        customerUserId,
      ]);
    } finally {
      client.release();
    }

    const first = await loginCustomerUser(email, password);
    assert(first?.token, "First customer login should return a token");

    let blocked = false;
    try {
      await loginCustomerUser(email, password);
    } catch (error) {
      blocked = isSessionAlreadyActiveError(error);
      assert(error.code === SESSION_ALREADY_ACTIVE_CODE, "Expected session_already_active code");
    }
    assert(blocked, "Second customer login should be blocked");

    const { logoutCustomerUser } = await import("../src/modules/customer-portal/customer-auth.js");
    await logoutCustomerUser(first.token);

    const afterLogout = await loginCustomerUser(email, password);
    assert(afterLogout?.token, "Login after customer logout should succeed");
    assert(afterLogout.token !== first.token, "Login after logout should mint a different token");

    let blockedAgain = false;
    try {
      await loginCustomerUser(email, password);
    } catch (error) {
      blockedAgain = isSessionAlreadyActiveError(error);
    }
    assert(blockedAgain, "Second login should still be blocked while session active");

    const adminResult = await forceLogoutCustomerUserByAdmin(customerUserId);
    assert(adminResult?.ok === true, "Admin force logout should return ok");

    const afterAdmin = await loginCustomerUser(email, password);
    assert(afterAdmin?.token, "Login after admin force logout should succeed");
    assert(afterAdmin.token !== afterLogout.token, "New login should mint a different token");

    console.log("[smoke-test-customer-single-session] PASS");
  } catch (error) {
    console.error(
      "[smoke-test-customer-single-session] FAIL:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await cleanup({ leadId, orgId, customerUserId });
    await pool.end().catch(() => {});
  }
}

main();
