/**
 * Partner vs reseller flow smoke tests.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { loginPartnerUser } from "../src/modules/partners/partner-auth.js";
import { createPartner } from "../src/modules/partners/partner-store.js";
import { createReseller } from "../src/modules/resellers/reseller-store.js";
import { loginResellerUser } from "../src/modules/resellers/reseller-auth.js";
import {
  assertLeadSourceExclusive,
  assignLead,
  canUserCreateQuotation,
  createLead,
  getLeadById,
} from "../src/modules/leads/lead-store.js";
import { listUnassignedLeads } from "../src/modules/sales-oversight/oversight-store.js";
import { getActiveSalesAdminUser, listSalesUsers } from "../src/modules/users/user-store.js";

const marker = `partner-reseller-smoke-${Date.now()}`;
const uniqueMobile = String(9100000000 + (Date.now() % 89999999));
const resellerMobile = String(9200000000 + (Date.now() % 79999999));
const resellerLeadMobile = String(9300000000 + (Date.now() % 69999999));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup({ partnerId, resellerId, leadIds = [] }) {
  const client = await pool.connect();
  try {
    for (const leadId of leadIds) {
      await client.query(`DELETE FROM product_assignments WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM lead_assignments WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM branches WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM quotations WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
    }
    if (partnerId) {
      await client.query(`DELETE FROM partner_users WHERE partner_id = $1`, [partnerId]);
      await client.query(`DELETE FROM partners WHERE id = $1`, [partnerId]);
    }
    if (resellerId) {
      await client.query(`DELETE FROM reseller_users WHERE reseller_id = $1`, [resellerId]);
      await client.query(`DELETE FROM resellers WHERE id = $1`, [resellerId]);
    }
  } finally {
    client.release();
  }
}

const leadPayload = {
  companyName: `Smoke Co ${marker}`,
  industryType: "Technology & Software",
  businessType: "B2B",
  country: "India",
  companySize: "11-50 employees",
  contactName: "Smoke Contact",
  designation: "CEO",
  workEmail: `work-${marker}@customer.test`,
  adminEmail: `admin-${marker}@customer.test`,
  billingAddress: "1 Smoke Street",
  taxNumber: `29SMK${String(Date.now()).slice(-7)}Z1`,
  state: "Karnataka",
  mobileCountryCode: "+91",
  mobileNumber: uniqueMobile,
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-partner-reseller] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  let partnerId;
  let resellerId;
  const leadIds = [];

  try {
    try {
      assertLeadSourceExclusive({ partnerId: "a", resellerId: "b" });
      assert(false, "Expected mutual exclusion error");
    } catch (error) {
      assert(
        error instanceof Error && error.message.includes("cannot be both"),
        "Mutual exclusion should reject both partner and reseller",
      );
    }

    const partner = await createPartner({
      companyName: `Partner ${marker}`,
      contactName: "Partner Contact",
      workEmail: `work-${marker}@partner.test`,
      country: "India",
      loginEmail: `portal-${marker}@partner.test`,
      password: "Aa1!SmokeTest99",
      displayName: "Partner Portal",
    });
    partnerId = partner.id;

    const reseller = await createReseller({
      companyName: `Reseller ${marker}`,
      contactName: "Reseller Contact",
      workEmail: `ops-${marker}@reseller.test`,
      invoiceEmail: `billing-${marker}@reseller.test`,
      taxNumber: "29RESELL0001Z1",
      billingAddress: "2 Reseller Road",
      country: "India",
      mobileCountryCode: "+91",
      mobileNumber: resellerMobile,
      loginEmail: `portal-${marker}@reseller.test`,
      password: "Aa1!SmokeTest99",
      displayName: "Reseller Portal",
    });
    resellerId = reseller.id;

    const partnerLogin = await loginPartnerUser(`portal-${marker}@partner.test`, "Aa1!SmokeTest99");
    assert(partnerLogin.partnerId === partnerId, "Partner login should return partner id");

    const resellerLogin = await loginResellerUser(`portal-${marker}@reseller.test`, "Aa1!SmokeTest99");
    assert(resellerLogin.resellerId === resellerId, "Reseller login should return reseller id");

    const partnerLead = await createLead(leadPayload, {
      partnerId,
      assignedUserId: null,
      assignmentReason: null,
    });
    leadIds.push(partnerLead.id);
    assert(partnerLead.partnerId === partnerId, "Partner lead should store partner_id");
    assert(!partnerLead.resellerId, "Partner lead should not have reseller_id");
    assert(!partnerLead.assignedUserId, "Partner lead should start unassigned");

    const salesAdmin = await getActiveSalesAdminUser();
    assert(salesAdmin?.id, "Active sales admin is required for reseller lead assignment");

    const resellerLead = await createLead(
      {
        ...leadPayload,
        companyName: `Reseller Lead ${marker}`,
        workEmail: `reseller-work-${marker}@customer.test`,
        adminEmail: `reseller-admin-${marker}@customer.test`,
        mobileNumber: resellerLeadMobile,
        taxNumber: `29RSL${String(Date.now()).slice(-7)}Z1`,
      },
      {
        resellerId,
        assignedUserId: salesAdmin.id,
        assignmentReason: "Auto-assigned to sales admin for reseller lead",
      },
    );
    leadIds.push(resellerLead.id);
    assert(resellerLead.resellerId === resellerId, "Reseller lead should store reseller_id");
    assert(!resellerLead.partnerId, "Reseller lead should not have partner_id");
    assert(resellerLead.assignedUserId === salesAdmin.id, "Reseller lead should assign sales admin");

    const unassigned = await listUnassignedLeads();
    assert(
      unassigned.some((lead) => lead.id === partnerLead.id),
      "Partner lead should appear in unassigned queue",
    );
    assert(
      !unassigned.some((lead) => lead.id === resellerLead.id),
      "Reseller lead should not appear in unassigned queue",
    );

    const salesUsers = await listSalesUsers();
    const salesExecutive = salesUsers.find((user) => user.role === "sales");
    assert(salesExecutive?.id, "Need at least one sales executive for assignment test");

    await assignLead(partnerLead.id, salesExecutive.id, {
      assignedByUserId: salesAdmin.id,
      reason: "Smoke test assignment",
    });

    const assignedPartnerLead = await getLeadById(partnerLead.id);
    assert(
      assignedPartnerLead.assignedUserId === salesExecutive.id,
      "Partner lead should assign to sales executive",
    );

    const partnerOwnership = {
      partnerId,
      resellerId: null,
      assignedUserId: salesExecutive.id,
      createdByUserId: null,
    };
    const resellerOwnership = {
      partnerId: null,
      resellerId,
      assignedUserId: salesAdmin.id,
      createdByUserId: null,
    };

    assert(
      canUserCreateQuotation({ role: "sales", userId: salesExecutive.id }, partnerOwnership),
      "Assigned sales executive should quote partner lead",
    );
    assert(
      !canUserCreateQuotation({ role: "sales", userId: salesExecutive.id }, resellerOwnership),
      "Sales executive should not quote reseller lead",
    );
    assert(
      canUserCreateQuotation({ role: "sales_admin", userId: salesAdmin.id }, resellerOwnership),
      "Sales admin should quote reseller lead",
    );
    assert(
      canUserCreateQuotation(
        { role: "sales_admin", userId: salesAdmin.id },
        {
          partnerId: null,
          resellerId: null,
          assignedUserId: salesExecutive.id,
          createdByUserId: salesExecutive.id,
        },
      ),
      "Sales admin should quote another agent's direct lead",
    );
    assert(
      !canUserCreateQuotation({ role: "partner", userId: "x" }, partnerOwnership),
      "Partner role should not create quotations",
    );
    assert(
      !canUserCreateQuotation({ role: "reseller", userId: "x" }, resellerOwnership),
      "Reseller role should not create quotations",
    );

    console.log(
      "[smoke-test-partner-reseller] OK — partner/reseller leads, assignment, quote guards, sign-in",
    );
  } finally {
    await cleanup({ partnerId, resellerId, leadIds });
  }
}

main().catch((error) => {
  console.error("[smoke-test-partner-reseller] FAILED:", error);
  process.exit(1);
});
