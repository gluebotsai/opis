import { callDbFunctionScalar, resolveQueryRunner } from "../../db/routines.js";

export async function createSupportTicketWithMessage(client: any, params: any) {
  return callDbFunctionScalar(resolveQueryRunner(client), "fn_create_support_ticket_with_message", [
    params.ticketNumber,
    params.organizationId,
    params.customerUserId,
    params.subscriptionId,
    params.productId,
    params.subscriptionKey,
    params.productLabel,
    params.category,
    params.priority,
    params.subject,
    params.description,
    params.unableToUse,
    params.startedAfterChange,
    params.tenantId,
    params.companyName,
    params.contactEmail,
    params.authorLabel,
  ]);
}
