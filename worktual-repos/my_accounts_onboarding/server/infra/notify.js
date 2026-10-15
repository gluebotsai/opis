import { enqueueEmailJob } from "./queues.js";

export async function queueQuotationApprovedEmail(quotation) {
  return enqueueEmailJob("quotation_approved", { quotation }, { subject: "Quotation approved" });
}

export async function queueQuotationRejectedEmail(quotation) {
  return enqueueEmailJob(
    "quotation_rejected",
    { quotation, decision: "rejected" },
    { subject: "Quotation rejected" },
  );
}

export async function queuePaymentReceivedEmail(quotation, options = {}) {
  return enqueueEmailJob(
    "payment_received",
    { quotation, ...options },
    { subject: "Payment received" },
  );
}

export async function queueCustomerPaymentLinkEmail(quotation) {
  return enqueueEmailJob(
    "customer_payment_link",
    { quotation },
    { subject: "Payment link" },
  );
}

export async function queueSupportTicketCreatedEmails(ticket, initialMessage = null) {
  await enqueueEmailJob("support_ticket_created", { ticket, initialMessage });
  await enqueueEmailJob("sales_support_ticket_created", { ticket, initialMessage });
}

export async function queueCustomerProductRequestEmail(requestRecord) {
  return enqueueEmailJob("customer_product_request", { requestRecord });
}

export async function queueCustomerProductRequestCancelledEmail(requestRecord) {
  return enqueueEmailJob("customer_product_request_cancelled", { requestRecord });
}

export async function queueBranchCancellationRequestedEmail(requestRecord) {
  return enqueueEmailJob("branch_cancellation_requested", { requestRecord });
}

export async function queueBranchCancellationResolvedEmail(requestRecord, decision) {
  return enqueueEmailJob("branch_cancellation_resolved", { requestRecord, decision });
}
