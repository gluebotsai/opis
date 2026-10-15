import { callDbFunction, callDbFunctionScalar, resolveQueryRunner } from "../../db/routines.js";

function runnerOrClient(client: any) {
  return resolveQueryRunner(client);
}

export async function loadDuplicatePurchaseContext(
  runner: any,
  leadId: any,
  excludeQuotationId: any = null,
  pendingStatuses: any = ["Pending", "Approved"],
) {
  const payload = await callDbFunctionScalar(
    runnerOrClient(runner),
    "fn_duplicate_purchase_context",
    [leadId, excludeQuotationId, pendingStatuses],
  );

  return {
    activeProducts: (payload as any)?.activeProducts || [],
    pendingLines: (payload as any)?.pendingLines || [],
  };
}
