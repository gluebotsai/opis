import { callDbFunction, callDbFunctionScalar, resolveQueryRunner } from "../../db/routines.js";

function runnerOrClient(client) {
  return resolveQueryRunner(client);
}

export async function loadDuplicatePurchaseContext(
  runner,
  leadId,
  excludeQuotationId = null,
  pendingStatuses = ["Pending", "Approved"],
) {
  const payload = await callDbFunctionScalar(
    runnerOrClient(runner),
    "fn_duplicate_purchase_context",
    [leadId, excludeQuotationId, pendingStatuses],
  );

  return {
    activeProducts: payload?.activeProducts || [],
    pendingLines: payload?.pendingLines || [],
  };
}
