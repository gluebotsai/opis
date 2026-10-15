/**
 * Role-scoped commercial document notifications (configured mail + in-app bell).
 */

import { prisma } from "@/dao/db/prisma";
import { listAdminUsers, listFinanceUsers } from "@/service/account/user-directory";
import { notifyUsersViaCrmBot } from "@/service/email/notify-crm-bot";
import { notifyAdminsAsync } from "@/dao/notifications/notify-admins";

export async function notifySalesCommercialDraft(input: {
  organizationId: string;
  ownerUserId: string | null;
  contactId: string | null;
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<void> {
  if (!input.ownerUserId) return;
  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: [input.ownerUserId],
    kind: input.kind,
    title: input.title,
    body: input.body,
    href: input.href,
    entityType: input.entityType,
    entityId: input.entityId,
    contactId: input.contactId,
    actorUserId: input.ownerUserId,
  }).catch((err) => console.error("notifySalesCommercialDraft failed", err));
}

export async function notifyFinanceInvoicePendingApproval(input: {
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  dealTitle: string | null;
  dealId: string | null;
  ownerUserId: string | null;
  contactId: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  const [finance, admins] = await Promise.all([
    listFinanceUsers(input.organizationId),
    listAdminUsers(input.organizationId),
  ]);
  const recipientIds = [
    ...new Set([...finance.map((u) => u.id), ...admins.map((u) => u.id)]),
  ];
  if (recipientIds.length === 0) return;

  const label = input.invoiceNumber
    ? `Invoice ${input.invoiceNumber}`
    : "New invoice";
  const dealBit = input.dealTitle ? ` (${input.dealTitle})` : "";

  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: recipientIds,
    kind: "invoice_pending_finance_approval",
    title: `Finance approval needed: ${label}`,
    body: `${label}${dealBit} was created from an accepted quote and needs Finance approval before it can be sent to the customer.`,
    href: `/finance/${input.invoiceId}`,
    entityType: "invoice",
    entityId: input.invoiceId,
    contactId: input.contactId,
    actorUserId: input.actorUserId,
    metadata: { dealId: input.dealId },
    documentLabel: label,
    dealTitle: input.dealTitle,
    nextStep:
      "Review pricing and terms, then approve or reject so Sales can send to the customer.",
  }).catch((err) =>
    console.error("notifyFinanceInvoicePendingApproval failed", err),
  );

  if (input.ownerUserId) {
    await notifyUsersViaCrmBot({
      organizationId: input.organizationId,
      recipientUserIds: [input.ownerUserId],
      kind: "invoice_submitted_for_finance",
      title: `${label} submitted for finance approval`,
      body: `${label}${dealBit} was generated from the accepted quote and submitted to Finance for approval. You will be notified when Finance approves or rejects it.`,
      href: `/finance/${input.invoiceId}`,
      entityType: "invoice",
      entityId: input.invoiceId,
      contactId: input.contactId,
      actorUserId: input.actorUserId,
      metadata: { dealId: input.dealId },
      documentLabel: label,
      dealTitle: input.dealTitle,
      nextStep: "Wait for Finance approval before sending the invoice to the customer.",
    }).catch((err) =>
      console.error("notifySalesInvoiceSubmitted failed", err),
    );
  }
}

export async function notifySalesInvoiceFinanceDecision(input: {
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  dealId: string | null;
  dealTitle: string | null;
  ownerUserId: string | null;
  contactId: string | null;
  decision: "approved" | "rejected";
  reason?: string | null;
  actorUserId: string | null;
}): Promise<void> {
  if (!input.ownerUserId) return;
  const label = input.invoiceNumber
    ? `Invoice ${input.invoiceNumber}`
    : "Your invoice";
  const dealBit = input.dealTitle ? ` (${input.dealTitle})` : "";
  const title =
    input.decision === "approved"
      ? `Finance approved: ${label}`
      : `Finance rejected: ${label}`;
  const body =
    input.decision === "approved"
      ? `${label}${dealBit} is approved. Open Finance to send it to the customer when ready.`
      : `${label}${dealBit} was rejected by Finance.${
          input.reason?.trim() ? ` Reason: ${input.reason.trim()}` : ""
        } Revise and re-submit for approval.`;

  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: [input.ownerUserId],
    kind:
      input.decision === "approved"
        ? "invoice_finance_approved"
        : "invoice_finance_rejected",
    title,
    body,
    href: `/finance/${input.invoiceId}`,
    entityType: "invoice",
    entityId: input.invoiceId,
    contactId: input.contactId,
    actorUserId: input.actorUserId,
    metadata: { dealId: input.dealId, decision: input.decision },
    documentLabel: label,
    dealTitle: input.dealTitle,
  }).catch((err) =>
    console.error("notifySalesInvoiceFinanceDecision failed", err),
  );
}

export async function notifySalesCustomerDocumentDecision(input: {
  organizationId: string;
  ownerUserId: string | null;
  contactId: string | null;
  documentType: "proposal" | "quote";
  documentId: string;
  documentNumber: string | null;
  dealId: string | null;
  dealTitle: string | null;
  decision: "accepted" | "declined";
  actorUserId?: string | null;
}): Promise<void> {
  if (!input.ownerUserId) return;
  const label =
    input.documentType === "proposal"
      ? input.documentNumber
        ? `Proposal ${input.documentNumber}`
        : "Proposal"
      : input.documentNumber
        ? `Quote ${input.documentNumber}`
        : "Quote";
  const dealBit = input.dealTitle ? ` (${input.dealTitle})` : "";
  const title =
    input.decision === "accepted"
      ? `Customer accepted: ${label}`
      : `Customer declined: ${label}`;
  const body =
    input.decision === "accepted"
      ? `The customer accepted ${label}${dealBit} via email. Review next steps in CRM.`
      : `The customer declined ${label}${dealBit}. Follow up in CRM.`;

  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: [input.ownerUserId],
    kind:
      input.documentType === "proposal"
        ? input.decision === "accepted"
          ? "proposal_customer_accepted"
          : "proposal_customer_declined"
        : input.decision === "accepted"
          ? "quote_customer_accepted"
          : "quote_customer_declined",
    title,
    body,
    href:
      input.documentType === "proposal"
        ? `/sales/proposals/${input.documentId}`
        : `/sales/quotes/${input.documentId}`,
    entityType: input.documentType,
    entityId: input.documentId,
    contactId: input.contactId,
    actorUserId: input.actorUserId,
    metadata: { dealId: input.dealId, decision: input.decision },
    documentLabel: label,
    dealTitle: input.dealTitle,
  }).catch((err) =>
    console.error("notifySalesCustomerDocumentDecision failed", err),
  );
}

export async function notifySalesQuoteFromProposal(input: {
  organizationId: string;
  ownerUserId: string | null;
  contactId: string | null;
  quoteId: string;
  quoteNumber: string | null;
  proposalNumber: string | null;
  dealId: string | null;
  dealTitle: string | null;
}): Promise<void> {
  if (!input.ownerUserId) return;
  const quoteLabel = input.quoteNumber
    ? `Quote ${input.quoteNumber}`
    : "A quote draft";
  const propLabel = input.proposalNumber
    ? `proposal ${input.proposalNumber}`
    : "the accepted proposal";
  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: [input.ownerUserId],
    kind: "quote_draft_from_proposal",
    title: `${quoteLabel} ready after proposal acceptance`,
    body: `${quoteLabel} was created from ${propLabel}${
      input.dealTitle ? ` (${input.dealTitle})` : ""
    }. Review catalog pricing and send when ready — the customer was not emailed.`,
    href: `/sales/quotes/${input.quoteId}`,
    entityType: "quote",
    entityId: input.quoteId,
    contactId: input.contactId,
    actorUserId: input.ownerUserId,
    metadata: { dealId: input.dealId },
    documentLabel: input.quoteNumber ? `Quote ${input.quoteNumber}` : quoteLabel,
    dealTitle: input.dealTitle,
    nextStep: "Review catalog pricing and send the quote when ready.",
  }).catch((err) => console.error("notifySalesQuoteFromProposal failed", err));
}

/** After quote acceptance — owner/admin mailbox + finance invoice gate. */
export async function notifyAfterQuoteAccepted(input: {
  organizationId: string;
  quoteId: string;
  quoteNumber: string | null;
  dealId: string | null;
  dealTitle: string | null;
  contactId: string | null;
  ownerUserId: string | null;
  orderId: string | null;
  actorUserId?: string | null;
}): Promise<string | null> {
  notifyAdminsAsync({
    kind: "quote_accepted",
    organizationId: input.organizationId,
    actorUserId: input.actorUserId ?? null,
    dealId: input.dealId,
    dealTitle: input.dealTitle,
    contactId: input.contactId,
    ownerUserId: input.ownerUserId,
    quoteId: input.quoteId,
    quoteNumber: input.quoteNumber,
    href: input.dealId ? `/sales/${input.dealId}` : `/sales/quotes/${input.quoteId}`,
  });

  if (input.orderId) {
    notifyAdminsAsync({
      kind: "order_created",
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      orderId: input.orderId,
      dealId: input.dealId,
      dealTitle: input.dealTitle,
      contactId: input.contactId,
      ownerUserId: input.ownerUserId,
      href: input.dealId ? `/sales/${input.dealId}` : undefined,
      detail: input.quoteNumber
        ? `Order from accepted quote ${input.quoteNumber}.`
        : "Order from accepted quote.",
    });
  }

  if (!input.orderId) return null;

  try {
    const invoice = await prisma.invoice.findFirst({
      where: { orderId: input.orderId },
      orderBy: { createdAt: "desc" },
      select: { id: true, number: true, status: true },
    });
    if (!invoice) return null;
    await notifyFinanceInvoicePendingApproval({
      organizationId: input.organizationId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      dealTitle: input.dealTitle,
      dealId: input.dealId,
      ownerUserId: input.ownerUserId,
      contactId: input.contactId,
      actorUserId: input.actorUserId ?? null,
    });
    return invoice.id;
  } catch (err) {
    console.error("notifyAfterQuoteAccepted invoice notify failed", err);
    return null;
  }
}

export async function notifyUnassignedCommercialDraft(input: {
  organizationId: string;
  contactId: string;
  contactName: string;
  proposalId: string | null;
  quoteId: string | null;
  quotePending: boolean;
  dealId: string | null;
}): Promise<void> {
  const admins = await listAdminUsers(input.organizationId);
  if (admins.length === 0) return;
  const href = input.quoteId
    ? `/sales/quotes/${input.quoteId}`
    : input.proposalId
      ? `/sales/proposals/${input.proposalId}`
      : input.dealId
        ? `/sales/${input.dealId}`
        : `/contact/${input.contactId}`;
  const title = `Unassigned: commercial draft for ${input.contactName}`;
  const body = `A post-meeting proposal/quote draft was created but the contact has no owner. Assign an owner and review before sending.`;
  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: admins.map((a) => a.id),
    kind: input.quotePending
      ? "post_meeting_quote_incomplete"
      : "post_meeting_draft_ready",
    title,
    body,
    href,
    entityType: input.quoteId ? "quote" : "proposal",
    entityId: input.quoteId || input.proposalId,
    contactId: input.contactId,
    contactName: input.contactName,
    nextStep: "Assign an owner to the contact and review the draft before sending.",
  }).catch((err) =>
    console.error("notifyUnassignedCommercialDraft failed", err),
  );
}
