/**
 * Branch isolation smoke test (service-layer).
 * Verifies product-request listing filter and cancellation branch scope.
 */
import crypto from "node:crypto";

import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { createLead } from "../src/modules/leads/lead-store.js";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";
import { convertLeadToOrganization } from "../src/modules/organizations/organization-store.js";
import {
  createCustomerProductRequest,
  listCustomerProductRequests,
} from "../src/modules/customer-product-requests/request-store.js";
import {
  createCustomerCancellationRequest,
  REQUEST_KINDS,
  EFFECTIVE_TIMINGS,
} from "../src/modules/branch-requests/cancellation-requests.js";
import {
  CUSTOMER_ROLES,
  ensureBranchCustomerUser,
  getCustomerEntitlements,
} from "../src/modules/customer-portal/customer-auth.js";

const marker = `branch-iso-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup({ leadId, orgId }) {
  const client = await pool.connect();
  try {
    if (leadId) {
      await client.query(
        `UPDATE leads SET organization_id = NULL, converted_organization_id = NULL WHERE id = $1`,
        [leadId],
      );
    }
    if (orgId) {
      await client.query(`DELETE FROM customer_product_requests WHERE organization_id = $1`, [orgId]);
      await client.query(`DELETE FROM branch_cancellation_requests WHERE organization_id = $1`, [
        orgId,
      ]);
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
  await migrateDatabase();

  const branchA = crypto.randomUUID();
  const branchB = crypto.randomUUID();
  let leadId = null;
  let orgId = null;

  try {
    const lead = await createLead(withSmokeLeadContact({
      companyName: `Iso Smoke ${marker}`,
      billingAddress: "HQ Street 1",
      workEmail: `${marker}-hq@example.com`,
      adminEmail: `${marker}-admin@example.com`,
      additionalAddresses: [
        {
          id: branchA,
          label: "Branch A",
          address: "Branch A Street",
          country: "IN",
          workEmail: `a-${marker}@example.com`,
        },
        {
          id: branchB,
          label: "Branch B",
          address: "Branch B Street",
          country: "IN",
          workEmail: `b-${marker}@example.com`,
        },
      ],
    }));
    leadId = lead.id;

    const client = await pool.connect();
    let organization;
    let admin;
    try {
      ({ organization } = await convertLeadToOrganization(lead.id, client));
      orgId = organization.id;

      // Ensure both branch locations exist for cancellation scope checks.
      const { rows: locations } = await client.query(
        `SELECT id FROM organization_locations WHERE organization_id = $1`,
        [orgId],
      );
      const existingIds = new Set(locations.map((row) => row.id));
      for (const [id, label] of [
        [branchA, "Branch A"],
        [branchB, "Branch B"],
      ]) {
        if (existingIds.has(id)) {
          continue;
        }
        await client.query(
          `INSERT INTO organization_locations (id, organization_id, label, address, status)
           VALUES ($1, $2, $3, $4, 'active')`,
          [id, orgId, label, `${label} Street`],
        );
      }

      const hqResult = await ensureBranchCustomerUser(client, orgId, {
        branchId: "hq",
        email: `${marker}-hq@example.com`,
        displayName: "HQ User",
      });
      admin = hqResult?.user;
    } finally {
      client.release();
    }

    assert(admin?.id, "HQ branch user missing");

    const { rows: branchUserRows } = await pool.query(
      `INSERT INTO customer_users (
         organization_id, email, display_name, role, branch_id, password_hash, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING *`,
      [
        orgId,
        `portal-a-${marker}@example.com`,
        "Branch A User",
        CUSTOMER_ROLES.BRANCH_USER,
        branchA,
        "plain:smoke-password",
      ],
    );
    const branchAUser = {
      id: branchUserRows[0].id,
      customerUserId: branchUserRows[0].id,
      email: branchUserRows[0].email,
      role: CUSTOMER_ROLES.BRANCH_USER,
      branchId: branchA,
      organizationId: orgId,
    };

    await createCustomerProductRequest({
      organizationId: orgId,
      customerUserId: admin.id,
      sourceLeadId: leadId,
      requestType: "new",
      assignments: [
        {
          productId: "cdp",
          branchId: branchB,
          billingBranchId: branchB,
          changeType: "new",
          config: { region: "India", billingCycle: "monthly" },
        },
      ],
      productSummary: [{ productId: "cdp", name: "CDP", branchLabel: "Branch B" }],
      companyName: organization.companyName,
      contactEmail: admin.email,
    });

    await createCustomerProductRequest({
      organizationId: orgId,
      customerUserId: branchAUser.id,
      sourceLeadId: leadId,
      requestType: "upgrade",
      assignments: [
        {
          productId: "crm",
          branchId: branchA,
          billingBranchId: branchA,
          changeType: "addon",
          config: { region: "India", billingCycle: "monthly" },
        },
      ],
      productSummary: [{ productId: "crm", name: "CRM", branchLabel: "Branch A" }],
      companyName: organization.companyName,
      contactEmail: branchAUser.email,
    });

    const forA = await listCustomerProductRequests(orgId, { branchId: branchA });
    const forB = await listCustomerProductRequests(orgId, { branchId: branchB });
    const forAdmin = await listCustomerProductRequests(orgId);

    assert(forA.length === 1, `Branch A should see 1 request, saw ${forA.length}`);
    assert(
      forA.every((entry) =>
        (entry.assignments || []).every((a) => String(a.branchId) === branchA),
      ),
      "Branch A list leaked Branch B request",
    );
    assert(forB.length === 1, `Branch B should see 1 request, saw ${forB.length}`);
    assert(forAdmin.length >= 2, "Org-wide list should include both branches");

    let cancelForbidden = false;
    try {
      await createCustomerCancellationRequest({
        organizationId: orgId,
        customerUserId: branchAUser.id,
        customerUser: branchAUser,
        sourceLeadId: leadId,
        requestKind: REQUEST_KINDS.DROP_BRANCH,
        branchId: branchB,
        customerNote: "should fail",
        effectiveTiming: EFFECTIVE_TIMINGS.END_OF_PERIOD,
        companyName: organization.companyName,
        contactEmail: branchAUser.email,
      });
    } catch (error) {
      cancelForbidden = /assigned branch/i.test(error.message);
    }
    assert(cancelForbidden, "Branch A cancel for Branch B must throw scope error");

    // Branch users see all account locations; product/cancel scope stays own-branch.
    const branchEntitlements = await getCustomerEntitlements(branchAUser.id);
    const locationIds = new Set(
      (branchEntitlements?.organization?.locations || []).map((entry) => String(entry.id)),
    );
    assert(locationIds.has("hq") || locationIds.size >= 2, "Branch user should see multiple locations");
    assert(locationIds.has(branchA), "Branch user should see their own location");
    assert(locationIds.has(branchB), "Branch user should see other account locations");

    console.log("PASS smoke-test-branch-isolation");
  } finally {
    await cleanup({ leadId, orgId });
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("FAIL smoke-test-branch-isolation");
  console.error(error);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
