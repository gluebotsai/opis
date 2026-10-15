/**
 * CI smoke test: migrate, create lead + quotation with branch FK path, then clean up.
 * Requires DATABASE_URL (from env or .env in project root).
 */
import "../server/load-env.js";
import crypto from "node:crypto";
import { migrateDatabase } from "../server/db/migrate.js";
import { pool } from "../server/db/pool.js";
import { createLead, updateLead } from "../server/leads.js";
import { createQuotation } from "../server/quotations.js";

const marker = `ci-smoke-${Date.now()}`;

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
      await client.query(`DELETE FROM branches WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM additional_addresses WHERE lead_id = $1`, [leadId]);
      await client.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
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

  await migrateDatabase();

  let leadId;
  let quotationIds = [];

  try {
    const lead = await createLead({
      companyName: `Smoke Test ${marker}`,
      billingAddress: "1 Test Street",
      workEmail: `${marker}@example.com`,
      additionalAddresses: [{ label: "Branch A", address: "2 Branch Road" }],
    });
    leadId = lead.id;

    const clientAssignmentId = crypto.randomUUID();
    const sharedAssignment = {
      id: clientAssignmentId,
      productId: "product-smoke",
      branchId: "hq",
      billingTargetId: "hq",
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
          billingTargetId: "hq",
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
