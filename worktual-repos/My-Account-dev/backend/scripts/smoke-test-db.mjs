/**
 * CI smoke test: migrate, create lead + quotation with branch FK path, then clean up.
 * Requires DATABASE_URL (from env or .env in project root).
 */
import "../src/config/load-env.js";
import crypto from "node:crypto";
import { migrateDatabase } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { applySmokeDbTimeouts } from "./lib/smokeDbTimeouts.mjs";
import { createLead, updateLead } from "../src/modules/leads/lead-store.js";
import { createQuotation } from "../src/modules/quotations/quotation-store.js";
import { gstinWithChecksum } from "../src/modules/platform/tax-number.js";

const marker = `ci-smoke-${Date.now()}`;
const uniqueDigits = String(Date.now()).slice(-9);
const hqGst = gstinWithChecksum(`29AAAAA${uniqueDigits.slice(-4)}A1Z`);
const branchGst = gstinWithChecksum(`29BBBBB${uniqueDigits.slice(-4)}A1Z`);
const hqMobile = `9${uniqueDigits}`;
const branchMobile = `8${uniqueDigits}`;

async function cleanup(leadId, quotationIds = []) {
  const client = await pool.connect();
  try {
    for (const quotationId of quotationIds) {
      if (!quotationId) continue;
      await client.query(`DELETE FROM product_assignments WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM product_summary_items WHERE quotation_id = $1`, [quotationId]);
      await client.query(`DELETE FROM quotations WHERE id = $1`, [quotationId]);
    }
    if (leadId) {
      const { rows: orgRows } = await client.query(
        `SELECT organization_id, converted_organization_id FROM leads WHERE id = $1`,
        [leadId],
      );
      const orgIds = [
        ...new Set(
          [orgRows[0]?.organization_id, orgRows[0]?.converted_organization_id].filter(Boolean),
        ),
      ];

      for (const orgId of orgIds) {
        await client.query(
          `UPDATE organizations SET source_lead_id = NULL, updated_at = NOW() WHERE id = $1`,
          [orgId],
        );
      }
      await client.query(
        `UPDATE leads
         SET organization_id = NULL, converted_organization_id = NULL, updated_at = NOW()
         WHERE id = $1`,
        [leadId],
      );
      await client.query(`DELETE FROM branches WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
      for (const orgId of orgIds) {
        await client.query(`DELETE FROM organization_locations WHERE organization_id = $1`, [orgId]);
        await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
      }
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[smoke-test-db] DATABASE_URL is not set");
    process.exit(1);
  }

  applySmokeDbTimeouts(pool);
  await migrateDatabase();

  let leadId;
  let quotationIds = [];

  try {
    const lead = await createLead({
      companyName: `Smoke Test ${marker}`,
      country: "India",
      state: "Karnataka",
      billingAddress: "1 Test Street",
      workEmail: `${marker}@example.com`,
      mobileCountryCode: "+91",
      mobileNumber: hqMobile,
      taxNumber: hqGst,
      additionalAddresses: [
        {
          label: "Branch A",
          address: "2 Branch Road",
          country: "India",
          state: "Karnataka",
          taxNumber: branchGst,
          mobileCountryCode: "+91",
          mobileNumber: branchMobile,
        },
      ],
    });
    leadId = lead.id;

    const clientAssignmentId = crypto.randomUUID();
    const sharedAssignment = {
      id: clientAssignmentId,
      productId: "product-smoke",
      branchId: "hq",
      billingBranchId: "hq",
      changeType: "new",
    };

    const quotation = await createQuotation({
      leadId,
      fileName: `${marker}-1.pdf`,
      pdfBase64: "dGVzdA==",
      assignments: [sharedAssignment],
    });
    quotationIds.push(quotation.id);

    // Second quotation uses upgrade (duplicate new purchase is blocked while first is pending).
    const quotation2 = await createQuotation({
      leadId,
      fileName: `${marker}-2.pdf`,
      pdfBase64: "dGVzdDI=",
      assignments: [
        {
          id: crypto.randomUUID(),
          productId: "product-smoke",
          branchId: "hq",
          billingBranchId: "hq",
          changeType: "upgrade",
        },
      ],
    });
    quotationIds.push(quotation2.id);

    // Mirrors ComposeEmailPage: submitQuotation then clearProductDraft → updateLead → syncBranches
    await updateLead(leadId, { productDraft: null });

    console.log("[smoke-test-db] OK — quotations + upgrade path + post-send update");
  } catch (error) {
    console.error("[smoke-test-db] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await cleanup(leadId, quotationIds);
    await pool.end();
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();
