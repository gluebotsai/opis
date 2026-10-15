/**
 * Smoke: HQ customer submits "Request new branch", session stays valid,
 * pending request is listable immediately, and continued navigation works
 * without creating a stale active-session lock.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { createLead } from "../src/modules/leads/lead-store.js";
import { convertLeadToOrganization } from "../src/modules/organizations/organization-store.js";
import {
  ensureOrgAdminCustomerUser,
  getCustomerEntitlements,
  getCustomerSession,
  loginCustomerUser,
  setCustomerPortalPassword,
} from "../src/modules/customer-portal/customer-auth.js";
import {
  createBranchAddRequest,
  listBranchAddRequestsForOrganization,
} from "../src/modules/branch-requests/add-requests.js";
import { runWithOrganizationContext } from "../src/db/tenantContext.js";
import { isSessionAlreadyActiveError } from "../src/modules/auth/session-concurrency.js";
import { gstinWithChecksum } from "../src/modules/platform/tax-number.js";

const marker = `customer-bar-${Date.now()}`;
const password = "CustomerBranchAdd1!";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup({ leadId, orgId, customerUserId }) {
  const client = await pool.connect();
  try {
    if (orgId) {
      await client.query(`DELETE FROM branch_add_requests WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM customer_auth_sessions WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM product_access_grants WHERE customer_user_id IN (
        SELECT id FROM customer_users WHERE organization_id = $1
      )`, [orgId]);
      await client.query(`DELETE FROM customer_users WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM organization_locations WHERE organization_id = $1`, [orgId]);
    }
    if (leadId) {
      await client.query(
        `UPDATE leads SET organization_id = NULL, converted_organization_id = NULL WHERE id = $1`,
        [leadId],
      );
    }
    if (orgId) {
      await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    if (leadId) {
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
    if (customerUserId) {
      await client.query(`DELETE FROM customer_auth_sessions WHERE customer_user_id = $1`, [
        customerUserId,
      ]);
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-customer-branch-add-request] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  const email = `${marker}-admin@example.com`;
  let leadId = null;
  let orgId = null;
  let customerUserId = null;

  try {
    const lead = await createLead({
      companyName: `Customer BAR ${marker}`,
      industryType: "Technology",
      businessType: "B2B",
      country: "India",
      companySize: "11-50",
      contactName: "HQ Admin",
      designation: "Manager",
      workEmail: `${marker}-hq@example.com`,
      adminEmail: email,
      mobileCountryCode: "+91",
      mobileNumber: `9${String(Date.now()).slice(-9)}`,
      billingAddress: "1 Branch Request Street",
      taxNumber: gstinWithChecksum(`29AAAAA${String(Date.now()).slice(-4)}A1Z`),
      state: "Karnataka",
    });
    leadId = lead.id;

    const client = await pool.connect();
    try {
      const { organization } = await convertLeadToOrganization(lead.id, client);
      orgId = organization.id;
      const ensured = await ensureOrgAdminCustomerUser(client, organization.id, {
        adminEmail: email,
        workEmail: `${marker}-hq@example.com`,
        contactName: "HQ Admin",
      });
      assert(ensured?.user?.id, "HQ customer user should be created");
      customerUserId = ensured.user.id;
      await setCustomerPortalPassword(client, customerUserId, password);
      await client.query(`DELETE FROM customer_auth_sessions WHERE customer_user_id = $1`, [
        customerUserId,
      ]);
    } finally {
      client.release();
    }

    const login = await loginCustomerUser(email, password);
    assert(login?.token, "Customer login should return a token");
    assert(
      await getCustomerSession(login.token),
      "Customer session should be readable after login",
    );

    const created = await runWithOrganizationContext(orgId, async () => {
      const entitlements = await getCustomerEntitlements(customerUserId);
      assert(entitlements?.user?.isHeadOffice, "HQ user should be head office");
      assert(entitlements?.organization?.sourceLeadId, "Organization should link to lead");
      return createBranchAddRequest({
        organizationId: orgId,
        customerUserId,
        customerUser: entitlements.user,
        sourceLeadId: entitlements.organization.sourceLeadId,
        companyName: entitlements.organization.companyName || "",
        contactEmail: email,
        body: {},
        headOfficeVerified: true,
      });
    });

    assert(created?.id, "Branch add request should be created");
    assert(created.status === "submitted", "New request should be submitted");

    // Immediate continued navigation: same token must still work.
    assert(
      await getCustomerSession(login.token),
      "Customer session must remain valid after branch add submit",
    );

    const listed = await runWithOrganizationContext(orgId, () =>
      listBranchAddRequestsForOrganization(orgId),
    );
    assert(
      listed.some((entry) => entry.id === created.id && entry.status === "submitted"),
      "Pending branch add request should appear immediately in the org list",
    );

    const entitlementsAfter = await runWithOrganizationContext(orgId, () =>
      getCustomerEntitlements(customerUserId),
    );
    assert(entitlementsAfter?.user?.isHeadOffice, "Entitlements navigation should still work");
    assert(
      await getCustomerSession(login.token),
      "Customer session must remain valid after continued entitlements navigation",
    );

    const { rows: sessions } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM customer_auth_sessions
       WHERE customer_user_id = $1 AND expires_at > NOW()`,
      [customerUserId],
    );
    assert(sessions[0]?.count === 1, "Exactly one active customer session should remain");

    let blocked = false;
    try {
      await loginCustomerUser(email, password);
    } catch (error) {
      blocked = isSessionAlreadyActiveError(error);
    }
    assert(
      blocked,
      "Second login should hit the normal single-session lock (not a stale orphan lock)",
    );

    console.log("[smoke-test-customer-branch-add-request] OK", {
      requestNumber: created.requestNumber,
      orgId,
    });
  } catch (error) {
    console.error("[smoke-test-customer-branch-add-request] FAILED", error);
    process.exitCode = 1;
  } finally {
    await cleanup({ leadId, orgId, customerUserId });
    await pool.end();
  }
}

main();
