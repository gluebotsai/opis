import { pool, withTransaction } from "./db/pool.js";
import { rowToCamel, toIso } from "./db/util.js";
import { ensureAssignmentBranchRows } from "./leads.js";
import {
  deleteQuoteSession as deleteQuoteSessionRow,
  selectQuoteSession,
  upsertQuoteSession,
} from "./repositories/raw/quoteSessions.repo.js";

function mapQuoteSession(row) {
  if (!row) {
    return null;
  }

  const session = rowToCamel(row);
  return {
    lead: session.leadSnapshot || null,
    fileName: session.fileName || "",
    pdfBase64: session.pdfBase64 || "",
    assignments: session.assignments || [],
    productSummary: session.productSummary || [],
    invoices: session.invoices || [],
    invoiceMode: session.invoiceMode || "consolidated",
    branchSummary: session.branchSummary || null,
    createdAt: toIso(session.createdAt),
    updatedAt: toIso(session.updatedAt),
  };
}

export async function getQuoteSession(leadId) {
  const row = await selectQuoteSession(pool, leadId);
  return mapQuoteSession(row);
}

export async function saveQuoteSession(leadId, payload) {
  return withTransaction(async (client) => {
    const leadSnapshot = payload.lead || null;
    if (leadSnapshot) {
      await ensureAssignmentBranchRows(
        client,
        leadId,
        leadSnapshot,
        payload.assignments || [],
      );
    }

    const row = await upsertQuoteSession(client, leadId, [
      leadId,
      JSON.stringify(payload.lead || null),
      payload.fileName || null,
      payload.pdfBase64 || null,
      JSON.stringify(payload.assignments || []),
      JSON.stringify(payload.productSummary || []),
      JSON.stringify(payload.invoices || []),
      payload.invoiceMode || "consolidated",
      JSON.stringify(payload.branchSummary || null),
    ]);

    return mapQuoteSession(row);
  });
}

export async function clearQuoteSession(leadId) {
  await deleteQuoteSessionRow(pool, leadId);
}
