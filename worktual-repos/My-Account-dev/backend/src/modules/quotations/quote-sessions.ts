import { pool, withTransaction } from "../../db/pool.js";
import { rowToCamel, toIso } from "../../db/util.js";
import { ensureAssignmentBranchRows } from "../leads/lead-store.js";
import {
  deleteQuoteSession as deleteQuoteSessionRow,
  selectQuoteSession,
  upsertQuoteSession,
} from "../../repositories/raw/quoteSessions.repo.js";

function mapQuoteSession(row: any) {
  if (!row) {
    return null;
  }

  const session = rowToCamel(row);
  const leadSnapshot = (session as any).leadSnapshot || null;
  const handoff =
    leadSnapshot && typeof leadSnapshot === "object" ? (leadSnapshot as any).quoteHandoff || {} : {};
  const lead =
    leadSnapshot && typeof leadSnapshot === "object"
      ? (() => {
          const { quoteHandoff: _quoteHandoff, ...rest } = leadSnapshot;
          return rest;
        })()
      : leadSnapshot;

  return {
    leadId: (session as any).leadId || row.lead_id || null,
    lead,
    fileName: (session as any).fileName || "",
    pdfBase64: (session as any).pdfBase64 || "",
    assignments: (session as any).assignments || [],
    productSummary: (session as any).productSummary || [],
    invoices: (session as any).invoices || [],
    invoiceMode: (session as any).invoiceMode || "consolidated",
    branchSummary: (session as any).branchSummary || null,
    paymentTotals: handoff.paymentTotals || null,
    sourceProductRequestId: handoff.sourceProductRequestId || null,
    createdAt: toIso((session as any).createdAt),
    updatedAt: toIso((session as any).updatedAt),
  };
}

export async function getQuoteSession(leadId: any) {
  const row = await selectQuoteSession(pool, leadId);
  return mapQuoteSession(row);
}

export async function saveQuoteSession(leadId: any, payload: any) {
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

    await upsertQuoteSession(client, leadId, [
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

    // Avoid echoing multi-MB PDF payloads on the save response.
    return {
      leadId,
      fileName: payload.fileName || "",
      invoiceMode: payload.invoiceMode || "consolidated",
      saved: true,
    };
  });
}

export async function clearQuoteSession(leadId: any) {
  await deleteQuoteSessionRow(pool, leadId);
}
