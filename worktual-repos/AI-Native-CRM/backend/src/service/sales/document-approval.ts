/**
 * Hard send gate for proposal / quote / invoice (spec §10.5).
 * Send requires approvedByUserId + approvedAt — enforced in code, not prompts.
 */

export type DocumentApprovalFields = {
  approvedByUserId?: string | null;
  approvedAt?: Date | string | null;
  approvalStatus?: string | null;
};

export class DocumentApprovalRequiredError extends Error {
  constructor(documentType: string, detail?: string | null) {
    const label =
      documentType === "quote"
        ? "quote"
        : documentType === "proposal"
          ? "proposal"
          : "invoice";
    super(
      detail?.trim() ||
        `This ${label} must be approved before it can be sent.`,
    );
    this.name = "DocumentApprovalRequiredError";
  }
}

export function assertDocumentApprovedForSend(
  doc: DocumentApprovalFields,
  documentType: "proposal" | "quote" | "invoice",
): void {
  const by =
    typeof doc.approvedByUserId === "string" ? doc.approvedByUserId.trim() : "";
  const at = doc.approvedAt ? new Date(doc.approvedAt) : null;
  if (!by || !at || Number.isNaN(at.getTime())) {
    throw new DocumentApprovalRequiredError(documentType);
  }
}

export async function markDocumentApproved(input: {
  type: "proposal" | "quote" | "invoice";
  id: string;
  approvedByUserId: string;
}): Promise<void> {
  const { prisma } = await import("@/dao/db/prisma");
  const data = {
    approvedByUserId: input.approvedByUserId,
    approvedAt: new Date(),
    approvalStatus: "approved",
  };
  if (input.type === "proposal") {
    await prisma.proposal.update({ where: { id: input.id }, data });
  } else if (input.type === "quote") {
    await prisma.quote.update({ where: { id: input.id }, data });
  } else {
    await prisma.invoice.update({ where: { id: input.id }, data });
  }
}

export async function approveProposalCommand(
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { canEditDeals } = await import("@/service/auth/rbac");
    const { requireRole } = await import("@/service/auth/require-role");
    const { getServerUserId } = await import("@/service/account/session-cookie");
    const { getProposal } = await import("@/dao/sales/proposal-service");
    const { getDeal } = await import("@/dao/sales/deal-service");
    const { assertRecordAccess } = await import(
      "@/service/auth/ownership-scope"
    );

    await requireRole(canEditDeals, "You cannot approve proposals.");
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again to approve." };
    const existing = await getProposal(id);
    if (!existing) return { ok: false, error: "Proposal not found." };
    const deal = await getDeal(existing.dealId);
    await assertRecordAccess(deal?.ownerUserId ?? null);
    await markDocumentApproved({
      type: "proposal",
      id,
      approvedByUserId: userId,
    });
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to approve proposal.",
    };
  }
}

export async function approveQuoteCommand(
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { canEditQuotes, canEditFinance } = await import(
      "@/service/auth/rbac"
    );
    const { requireRole } = await import("@/service/auth/require-role");
    const { getServerUserId } = await import("@/service/account/session-cookie");
    const { getQuote } = await import("@/dao/sales/quote-service");
    const { assertRecordAccess } = await import(
      "@/service/auth/ownership-scope"
    );
    const {
      PENDING_FINANCE_APPROVAL,
      notifySalesOfDiscountDecision,
    } = await import("@/service/sales/quote-discount-approval");
    const { prisma } = await import("@/dao/db/prisma");

    const existing = await getQuote(id);
    if (!existing) return { ok: false, error: "Quote not found." };

    // A discount above the product's cap needs Finance (not just any sales
    // approver) to sign off before the quote can be sent.
    const needsFinanceApproval =
      existing.approvalStatus === PENDING_FINANCE_APPROVAL;
    await requireRole(
      needsFinanceApproval ? canEditFinance : canEditQuotes,
      needsFinanceApproval
        ? "Only Finance can approve this quote's discount."
        : "You cannot approve quotes.",
    );
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again to approve." };
    await assertRecordAccess(existing.deal?.ownerUserId ?? null);
    await markDocumentApproved({
      type: "quote",
      id,
      approvedByUserId: userId,
    });
    if (needsFinanceApproval) {
      await prisma.quote.update({
        where: { id },
        data: { approvalNote: null },
      });
      await notifySalesOfDiscountDecision({
        organizationId: String(existing.organizationId),
        quoteId: id,
        quoteNumber: existing.number,
        dealId: existing.dealId,
        dealTitle: existing.deal?.title ?? null,
        ownerUserId: existing.deal?.ownerUserId
          ? String(existing.deal.ownerUserId)
          : null,
        contactId: existing.deal?.contactId ?? null,
        decision: "approved",
        actorUserId: userId,
      }).catch((err) =>
        console.error("notifySalesOfDiscountDecision approve failed", id, err),
      );
    }
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to approve quote.",
    };
  }
}

/** Finance rejects an over-cap discount; salesperson must revise before send. */
export async function rejectQuoteDiscountCommand(
  id: string,
  reason: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { canEditFinance } = await import("@/service/auth/rbac");
    const { requireRole } = await import("@/service/auth/require-role");
    const { getServerUserId } = await import("@/service/account/session-cookie");
    const { getQuote } = await import("@/dao/sales/quote-service");
    const { assertRecordAccess } = await import(
      "@/service/auth/ownership-scope"
    );
    const {
      PENDING_FINANCE_APPROVAL,
      FINANCE_REJECTED,
      notifySalesOfDiscountDecision,
    } = await import("@/service/sales/quote-discount-approval");
    const { prisma } = await import("@/dao/db/prisma");

    const note = reason.trim();
    if (!note) {
      return { ok: false, error: "A rejection reason is required." };
    }

    await requireRole(
      canEditFinance,
      "Only Finance can reject this quote's discount.",
    );
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again to reject." };

    const existing = await getQuote(id);
    if (!existing) return { ok: false, error: "Quote not found." };
    if (existing.approvalStatus !== PENDING_FINANCE_APPROVAL) {
      return {
        ok: false,
        error: "This quote is not waiting for Finance discount approval.",
      };
    }
    await assertRecordAccess(existing.deal?.ownerUserId ?? null);

    await prisma.quote.update({
      where: { id },
      data: {
        approvalStatus: FINANCE_REJECTED,
        approvedByUserId: null,
        approvedAt: null,
        approvalNote: note.slice(0, 2000),
      },
    });

    await notifySalesOfDiscountDecision({
      organizationId: String(existing.organizationId),
      quoteId: id,
      quoteNumber: existing.number,
      dealId: existing.dealId,
      dealTitle: existing.deal?.title ?? null,
      ownerUserId: existing.deal?.ownerUserId
        ? String(existing.deal.ownerUserId)
        : null,
      contactId: existing.deal?.contactId ?? null,
      decision: "rejected",
      reason: note,
      actorUserId: userId,
    }).catch((err) =>
      console.error("notifySalesOfDiscountDecision reject failed", id, err),
    );

    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to reject quote discount.",
    };
  }
}

export async function approveInvoiceCommand(
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { canEditFinance } = await import("@/service/auth/rbac");
    const { requireRole } = await import("@/service/auth/require-role");
    const { getServerUserId } = await import("@/service/account/session-cookie");
    const {
      getInvoice,
      autoMarkZeroInvoicePaid,
    } = await import("@/dao/finance/invoice-service");
    const { assertRecordAccess } = await import(
      "@/service/auth/ownership-scope"
    );
    const {
      isZeroAmountTotal,
    } = await import("@/config/finance-defaults");
    const { getEffectiveFinanceDefaults } = await import(
      "@/dao/finance/org-finance-settings"
    );
    const { prisma } = await import("@/dao/db/prisma");

    await requireRole(canEditFinance, "You cannot approve invoices.");
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again to approve." };
    const existing = await getInvoice(id);
    if (!existing) return { ok: false, error: "Invoice not found." };
    if (
      existing.approvalStatus !== "pending_approval" &&
      existing.approvalStatus !== "drafting" &&
      existing.approvalStatus !== "finance_rejected"
    ) {
      return {
        ok: false,
        error: "This invoice is not eligible for Finance approval.",
      };
    }
    const ownerUserId =
      existing.deal?.ownerUserId ??
      existing.order?.deal?.ownerUserId ??
      existing.createdByUserId ??
      null;
    await assertRecordAccess(ownerUserId);
    await markDocumentApproved({
      type: "invoice",
      id,
      approvedByUserId: userId,
    });
    await prisma.invoice.update({
      where: { id },
      data: { approvalNote: null },
    });

    const billingKind = String(
      (existing as { billingKind?: string }).billingKind ?? "standard",
    );
    const financeDefaults = await getEffectiveFinanceDefaults(
      existing.organizationId,
    );
    if (
      financeDefaults.zeroAmountAutoPaid &&
      billingKind !== "adjustment" &&
      isZeroAmountTotal(existing.total)
    ) {
      await autoMarkZeroInvoicePaid(id, userId);
      const contactId =
        existing.deal?.contactId ?? existing.order?.deal?.contactId ?? null;
      if (contactId) {
        const { triggerLeadLifecycle } = await import(
          "@/service/ai/lead-lifecycle-trigger"
        );
        triggerLeadLifecycle({
          contactId,
          organizationId: String(existing.organizationId),
          triggerReason: "invoice_paid",
        });
      }
    }

    const { notifySalesInvoiceFinanceDecision } = await import(
      "@/service/email/commercial-notify"
    );
    await notifySalesInvoiceFinanceDecision({
      organizationId: String(existing.organizationId),
      invoiceId: id,
      invoiceNumber: existing.number,
      dealId: existing.dealId ?? existing.order?.dealId ?? null,
      dealTitle:
        existing.deal?.title ?? existing.order?.deal?.title ?? null,
      ownerUserId: ownerUserId ? String(ownerUserId) : null,
      contactId:
        existing.deal?.contactId ?? existing.order?.deal?.contactId ?? null,
      decision: "approved",
      actorUserId: userId,
    }).catch((err) =>
      console.error("notifySalesInvoiceFinanceDecision approve failed", id, err),
    );
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to approve invoice.",
    };
  }
}

/** Finance rejects an invoice pending approval; salesperson must revise before send. */
export async function rejectInvoiceCommand(
  id: string,
  reason: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { canEditFinance } = await import("@/service/auth/rbac");
    const { requireRole } = await import("@/service/auth/require-role");
    const { getServerUserId } = await import("@/service/account/session-cookie");
    const { getInvoice } = await import("@/dao/finance/invoice-service");
    const { assertRecordAccess } = await import(
      "@/service/auth/ownership-scope"
    );
    const { FINANCE_REJECTED } = await import(
      "@/service/sales/quote-discount-approval"
    );
    const { notifySalesInvoiceFinanceDecision } = await import(
      "@/service/email/commercial-notify"
    );
    const { prisma } = await import("@/dao/db/prisma");

    const note = reason.trim();
    if (!note) {
      return { ok: false, error: "A rejection reason is required." };
    }

    await requireRole(canEditFinance, "Only Finance can reject this invoice.");
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again to reject." };

    const existing = await getInvoice(id);
    if (!existing) return { ok: false, error: "Invoice not found." };
    if (existing.approvalStatus !== "pending_approval") {
      return {
        ok: false,
        error: "This invoice is not waiting for Finance approval.",
      };
    }

    const ownerUserId =
      existing.deal?.ownerUserId ??
      existing.order?.deal?.ownerUserId ??
      existing.createdByUserId ??
      null;
    await assertRecordAccess(ownerUserId);

    await prisma.invoice.update({
      where: { id },
      data: {
        approvalStatus: FINANCE_REJECTED,
        approvedByUserId: null,
        approvedAt: null,
        approvalNote: note.slice(0, 2000),
      },
    });

    await notifySalesInvoiceFinanceDecision({
      organizationId: String(existing.organizationId),
      invoiceId: id,
      invoiceNumber: existing.number,
      dealId: existing.dealId ?? existing.order?.dealId ?? null,
      dealTitle:
        existing.deal?.title ?? existing.order?.deal?.title ?? null,
      ownerUserId: ownerUserId ? String(ownerUserId) : null,
      contactId:
        existing.deal?.contactId ?? existing.order?.deal?.contactId ?? null,
      decision: "rejected",
      reason: note,
      actorUserId: userId,
    }).catch((err) =>
      console.error("notifySalesInvoiceFinanceDecision reject failed", id, err),
    );

    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to reject invoice.",
    };
  }
}

/** Finance withdraws approval before the invoice is sent to the customer. */
export async function withdrawInvoiceApprovalCommand(
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { canEditFinance } = await import("@/service/auth/rbac");
    const { requireRole } = await import("@/service/auth/require-role");
    const { getServerUserId } = await import("@/service/account/session-cookie");
    const { getInvoice } = await import("@/dao/finance/invoice-service");
    const { assertRecordAccess } = await import(
      "@/service/auth/ownership-scope"
    );
    const { prisma } = await import("@/dao/db/prisma");

    await requireRole(canEditFinance, "You cannot withdraw invoice approval.");
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };

    const existing = await getInvoice(id);
    if (!existing) return { ok: false, error: "Invoice not found." };
    if (existing.approvalStatus !== "approved") {
      return { ok: false, error: "Only approved invoices can be withdrawn." };
    }
    if (existing.status !== "draft") {
      return {
        ok: false,
        error: "Withdraw approval is only allowed before the invoice is sent.",
      };
    }

    const ownerUserId =
      existing.deal?.ownerUserId ??
      existing.order?.deal?.ownerUserId ??
      existing.createdByUserId ??
      null;
    await assertRecordAccess(ownerUserId);

    const { cancelInvoicePaymentLink } = await import(
      "@/service/finance/payment-gateways/index"
    );
    await cancelInvoicePaymentLink(id);

    await prisma.invoice.update({
      where: { id },
      data: {
        approvalStatus: "pending_approval",
        approvedByUserId: null,
        approvedAt: null,
        submittedForApprovalAt: new Date(),
      },
    });

    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to withdraw invoice approval.",
    };
  }
}

/** Sales or Finance re-submits a finance-rejected invoice to the queue. */
export async function resubmitInvoiceForApprovalCommand(
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { canEditFinance, canEditDeals } = await import("@/service/auth/rbac");
    const { requireRole } = await import("@/service/auth/require-role");
    const { getServerUserId } = await import("@/service/account/session-cookie");
    const { getInvoice } = await import("@/dao/finance/invoice-service");
    const { assertRecordAccess } = await import(
      "@/service/auth/ownership-scope"
    );
    const { FINANCE_REJECTED } = await import(
      "@/service/sales/quote-discount-approval"
    );
    const { notifyFinanceInvoicePendingApproval } = await import(
      "@/service/email/commercial-notify"
    );
    const { prisma } = await import("@/dao/db/prisma");

    await requireRole(
      (role) => canEditFinance(role) || canEditDeals(role),
      "You cannot re-submit this invoice.",
    );
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };

    const existing = await getInvoice(id);
    if (!existing) return { ok: false, error: "Invoice not found." };
    if (existing.approvalStatus !== FINANCE_REJECTED) {
      return {
        ok: false,
        error: "Only finance-rejected invoices can be re-submitted.",
      };
    }

    const ownerUserId =
      existing.deal?.ownerUserId ??
      existing.order?.deal?.ownerUserId ??
      existing.createdByUserId ??
      null;
    await assertRecordAccess(ownerUserId);

    const now = new Date();
    await prisma.invoice.update({
      where: { id },
      data: {
        approvalStatus: "pending_approval",
        approvalNote: null,
        approvedByUserId: null,
        approvedAt: null,
        resubmittedAt: now,
        submittedForApprovalAt: now,
      },
    });

    await notifyFinanceInvoicePendingApproval({
      organizationId: String(existing.organizationId),
      invoiceId: id,
      invoiceNumber: existing.number,
      dealTitle:
        existing.deal?.title ?? existing.order?.deal?.title ?? null,
      dealId: existing.dealId ?? existing.order?.dealId ?? null,
      ownerUserId: ownerUserId ? String(ownerUserId) : null,
      contactId:
        existing.deal?.contactId ?? existing.order?.deal?.contactId ?? null,
      actorUserId: userId,
    }).catch((err) =>
      console.error("notifyFinanceInvoicePendingApproval resubmit failed", err),
    );

    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to re-submit invoice for approval.",
    };
  }
}
