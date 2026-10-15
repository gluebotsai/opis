import { enqueueEmailJob } from "./queues.js";

/** Enqueue by id only — worker hydrates PDFs. Never put base64 in outbox/Redis. */
export async function queueQuotationApprovedEmail(quotationOrId: any) {
  const quotationId =
    typeof quotationOrId === "string" || typeof quotationOrId === "number"
      ? String(quotationOrId)
      : quotationOrId?.id || null;
  if (!quotationId) {
    throw new Error("quotationId is required to queue approved email.");
  }
  return enqueueEmailJob(
    "quotation_approved",
    { quotationId },
    { subject: "Quotation approved" },
  );
}

export async function queueQuotationOfflinePaymentEmail(quotationOrId: any) {
  const quotationId =
    typeof quotationOrId === "string" || typeof quotationOrId === "number"
      ? String(quotationOrId)
      : quotationOrId?.id || null;
  if (!quotationId) {
    throw new Error("quotationId is required to queue offline payment email.");
  }
  return enqueueEmailJob(
    "quotation_offline_payment",
    { quotationId },
    { subject: "Quotation approved — offline payment" },
  );
}

/** Enqueue by id only — worker hydrates PDFs. Never put base64 in outbox/Redis. */
export async function queueQuotationRejectedEmail(quotationOrId: any) {
  const quotationId =
    typeof quotationOrId === "string" || typeof quotationOrId === "number"
      ? String(quotationOrId)
      : quotationOrId?.id || null;
  if (!quotationId) {
    throw new Error("quotationId is required to queue rejected email.");
  }
  return enqueueEmailJob(
    "quotation_rejected",
    { quotationId },
    { subject: "Quotation rejected" },
  );
}

export async function queuePaymentReceivedEmail(quotation: any, options: any = {}) {
  return enqueueEmailJob(
    "payment_received",
    {
      quotationId: quotation?.id || options.quotationId || null,
      source: options.source || null,
      portalAccess: options.portalAccess
        ? {
            email: options.portalAccess.email || options.portalAccess.user?.email || null,
            temporaryPassword: options.portalAccess.temporaryPassword || null,
          }
        : null,
    },
    { subject: "Payment received" },
  );
}

export async function queuePaymentReportedEmail(quotation: any, options: any = {}) {
  return enqueueEmailJob(
    "payment_reported",
    {
      quotationId: quotation?.id || options.quotationId || null,
      source: options.source || null,
    },
    { subject: "Payment reported — verify bank" },
  );
}

export async function queueCustomerPaymentReportedEmail(quotation: any, options: any = {}) {
  return enqueueEmailJob(
    "customer_payment_reported",
    {
      quotationId: quotation?.id || options.quotationId || null,
      source: options.source || null,
    },
    { subject: "Payment received — verifying" },
  );
}

export async function queueCustomerPaymentLinkEmail(quotation: any) {
  return enqueueEmailJob(
    "customer_payment_link",
    { quotation },
    { subject: "Payment link" },
  );
}

/** Enqueue ticket-raised mail: From Sales Admin → To assigned Sales Executive. */
export async function queueSupportTicketCreatedEmails(ticket: any, initialMessage: any = null) {
  return enqueueEmailJob(
    "sales_support_ticket_created",
    { ticket, initialMessage },
    { subject: "Customer support ticket" },
  );
}

export async function queueCustomerProductRequestEmail(requestRecord: any) {
  return enqueueEmailJob("customer_product_request", { requestRecord });
}

export async function queueCustomerProductRequestCancelledEmail(requestRecord: any) {
  return enqueueEmailJob("customer_product_request_cancelled", { requestRecord });
}

export async function queueBranchCancellationRequestedEmail(requestRecord: any) {
  return enqueueEmailJob("branch_cancellation_requested", { requestRecord });
}

export async function queueBranchAddRequestedEmail(requestRecord: any) {
  return enqueueEmailJob("branch_add_requested", { requestRecord });
}

export async function queueBranchCancellationResolvedEmail(requestRecord: any, decision: any) {
  return enqueueEmailJob("branch_cancellation_resolved", { requestRecord, decision });
}

/** Enqueue by go-live id only — worker hydrates credentials from DB. */
export async function queueUatCredentialsEmail(goLiveOrId: any) {
  const goLiveId =
    typeof goLiveOrId === "string" || typeof goLiveOrId === "number"
      ? String(goLiveOrId)
      : goLiveOrId?.id || null;
  if (!goLiveId) {
    throw new Error("goLiveId is required to queue UAT credentials email.");
  }
  return enqueueEmailJob(
    "uat_credentials",
    { goLiveId },
    { subject: "UAT credentials" },
  );
}

/** Sales alert after customer accepts UAT / purchase — hydrates from quotation id. */
export async function queuePortalCommissionAccruedEmail(entryId: any) {
  if (!entryId) {
    return null;
  }
  return enqueueEmailJob(
    "portal_commission_accrued",
    { entryId: String(entryId) },
    { subject: "Commission earned" },
  );
}

export async function queuePortalCommissionPaidEmail(entryId: any) {
  if (!entryId) {
    return null;
  }
  return enqueueEmailJob(
    "portal_commission_paid",
    { entryId: String(entryId) },
    { subject: "Commission paid" },
  );
}

export async function queuePortalLeadCreatedEmail(leadId: any, options: any = {}) {
  if (!leadId) {
    return null;
  }
  return enqueueEmailJob(
    "portal_lead_created",
    { leadId: String(leadId), event: options.event || "created" },
    { subject: "Referral update" },
  );
}

/** Enqueue lead-assignment mail: From Sales Admin → To assigned Sales Executive. */
export async function queueSalesLeadAssignedEmail(
  leadId: any,
  { toUserId, assignedByUserId = null, reason = "" }: any = {},
) {
  if (!leadId || !toUserId) {
    return null;
  }
  return enqueueEmailJob(
    "sales_lead_assigned",
    {
      leadId: String(leadId),
      toUserId: String(toUserId),
      assignedByUserId: assignedByUserId ? String(assignedByUserId) : null,
      reason: String(reason || "").trim(),
    },
    { subject: "Lead assigned" },
  );
}

export async function queuePortalQuotationSubmittedEmail(quotationId: any) {
  if (!quotationId) {
    return null;
  }
  return enqueueEmailJob(
    "portal_quotation_submitted",
    { quotationId: String(quotationId) },
    { subject: "Invoice sent to finance" },
  );
}

export async function queuePortalQuotationApprovedEmail(quotationId: any) {
  if (!quotationId) {
    return null;
  }
  return enqueueEmailJob(
    "portal_quotation_approved",
    { quotationId: String(quotationId) },
    { subject: "Invoice approved" },
  );
}

export async function queuePortalQuotationRejectedEmail(quotationId: any) {
  if (!quotationId) {
    return null;
  }
  return enqueueEmailJob(
    "portal_quotation_rejected",
    { quotationId: String(quotationId) },
    { subject: "Invoice rejected" },
  );
}

export async function queuePortalCustomerPaidEmail(quotationId: any) {
  if (!quotationId) {
    return null;
  }
  return enqueueEmailJob(
    "portal_customer_paid",
    { quotationId: String(quotationId) },
    { subject: "Customer paid" },
  );
}

export async function queueGoLiveAcceptedSalesEmail(quotationOrId: any, goLiveIds: any = []) {
  const quotationId =
    typeof quotationOrId === "string" || typeof quotationOrId === "number"
      ? String(quotationOrId)
      : quotationOrId?.id || null;
  if (!quotationId) {
    throw new Error("quotationId is required to queue go-live accepted sales email.");
  }
  return enqueueEmailJob(
    "go_live_accepted",
    {
      quotationId,
      goLiveIds: Array.isArray(goLiveIds) ? goLiveIds.map(String).filter(Boolean) : [],
    },
    { subject: "Customer accepted UAT" },
  );
}
