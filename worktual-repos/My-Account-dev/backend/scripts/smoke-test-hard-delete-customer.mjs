/**
 * Hard-delete customer smoke: create lead + org + portal user → wipe → assert gone.
 */
import "../src/config/load-env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { createLead, getLeadById } from "../src/modules/leads/lead-store.js";
import { withSmokeLeadContact } from "./lib/smokeLeadContact.mjs";
import { ensureOrganizationForPaidLead } from "../src/modules/organizations/organization-store.js";
import { ensureDefaultCustomerUser } from "../src/modules/customer-portal/customer-auth.js";
import { hardDeleteCustomerByLeadId } from "../src/modules/customer-portal/deletion.js";
import { createQuotation } from "../src/modules/quotations/quotation-store.js";

const marker = `hard-delete-${Date.now()}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-hard-delete-customer] DATABASE_URL is not set");
    process.exit(1);
  }

  await migrateDatabase();

  let leadId;

  try {
    const lead = await createLead(withSmokeLeadContact({
      companyName: `Hard Delete Co ${marker}`,
      billingAddress: "1 Delete Street",
      workEmail: `hq-${marker}@example.com`,
      adminEmail: `admin-${marker}@example.com`,
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
          productId: "contact-center",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "new",
        },
      ],
    });

    const client = await pool.connect();
    let organizationId;
    try {
      const { organization } = await ensureOrganizationForPaidLead(leadId, client);
      organizationId = organization.id;
      // Mirror tenancy: paid/prospect leads keep organization_id (RESTRICT FK on org delete).
      await client.query(
        `UPDATE leads
         SET organization_id = COALESCE(organization_id, $2),
             converted_organization_id = COALESCE(converted_organization_id, $2)
         WHERE id = $1`,
        [leadId, organizationId],
      );
      const portal = await ensureDefaultCustomerUser(client, organization.id, {
        workEmail: lead.workEmail,
        adminEmail: lead.adminEmail,
        contactName: lead.contactName || "Admin",
      });
      assert(portal?.user?.email, "Expected portal user after ensure");
    } finally {
      client.release();
    }

    const beforeLead = await getLeadById(leadId);
    assert(beforeLead, "Lead should exist before delete");

    const result = await hardDeleteCustomerByLeadId(leadId, {
      actor: { type: "smoke", email: "smoke@test.com" },
    });
    assert(result.leadId === leadId, "Expected deleted lead id in result");

    const afterLead = await getLeadById(leadId);
    assert(!afterLead, "Lead should be gone after hard delete");

    const { rows: orgRows } = await pool.query(
      `SELECT id FROM organizations WHERE id = $1 OR source_lead_id = $2`,
      [organizationId, leadId],
    );
    assert(orgRows.length === 0, "Organization should be gone");

    const { rows: userRows } = await pool.query(
      `SELECT id FROM customer_users WHERE organization_id = $1`,
      [organizationId],
    );
    assert(userRows.length === 0, "Portal users should be gone");

    const { rows: quoteRows } = await pool.query(`SELECT id FROM quotations WHERE id = $1`, [
      quotation.id,
    ]);
    assert(quoteRows.length === 0, "Quotation should be gone");

    leadId = null;
    console.log("[smoke-test-hard-delete-customer] OK — lead, org, portal user, quote wiped");
  } catch (error) {
    if (leadId) {
      try {
        await hardDeleteCustomerByLeadId(leadId, { actor: { type: "smoke-cleanup" } });
      } catch {
        // already gone or partial
      }
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[smoke-test-hard-delete-customer] FAILED:", error);
  process.exit(1);
});
