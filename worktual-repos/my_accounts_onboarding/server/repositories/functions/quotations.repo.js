import { callDbFunction, callDbFunctionScalar, resolveQueryRunner } from "../../db/routines.js";

export async function transitionQuotationStatus(
  client,
  { quotationId, fromStatus, toStatus, financeNote = "", reviewedBy = null, clearReview = false },
) {
  const { rows } = await callDbFunction(resolveQueryRunner(client), "fn_transition_quotation_status", [
    quotationId,
    fromStatus,
    toStatus,
    financeNote,
    reviewedBy,
    clearReview,
  ]);
  return rows[0] || null;
}

export async function updateLeadStatusRow(client, leadId, status) {
  await callDbFunctionScalar(resolveQueryRunner(client), "fn_update_lead_status", [leadId, status]);
}
