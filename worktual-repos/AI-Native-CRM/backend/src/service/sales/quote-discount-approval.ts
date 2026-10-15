/**
 * Per-product discount cap enforcement for quotes (spec: discounts beyond a
 * product's configured max discount % must be approved by Finance before the
 * quote can be sent — see backend/src/service/sales/document-approval.ts for
 * the hard send gate this feeds into).
 *
 * Called from human create/update and from complete post-meeting AI drafts.
 * With actorUserId null, under-cap drafts stay unstamped; over-cap still
 * enters the Finance queue.
 */

import { prisma } from "@/dao/db/prisma";
import { listAdminUsers, listFinanceUsers } from "@/service/account/user-directory";
import { notifyUsersViaCrmBot } from "@/service/email/notify-crm-bot";

export const PENDING_FINANCE_APPROVAL = "pending_finance_approval";
export const FINANCE_REJECTED = "finance_rejected";

export type QuoteDiscountApprovalResult = {
  requiresFinanceApproval: boolean;
  limitPct: number | null;
  changedToFinancePending: boolean;
};

/**
 * The most restrictive `maxDiscountPercent` among the products referenced by
 * these quote lines, or null when none of them have a cap set (read-only —
 * used for display; does not persist anything).
 */
export async function computeQuoteDiscountLimit(
  lines: Array<{ productId: string | null }>,
): Promise<number | null> {
  const productIds = [
    ...new Set(
      lines.map((l) => l.productId).filter((id): id is string => Boolean(id)),
    ),
  ];
  if (productIds.length === 0) return null;
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { maxDiscountPercent: true },
  });
  const caps = products
    .map((p) => (p.maxDiscountPercent == null ? null : Number(p.maxDiscountPercent)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  return caps.length > 0 ? Math.min(...caps) : null;
}

/**
 * Recomputes and persists the quote's approval state from its current
 * discount % and line-item products, then (on a fresh transition into
 * pending) notifies Finance. Safe to call after every human create/update.
 */
export async function evaluateQuoteDiscountApproval(input: {
  quoteId: string;
  organizationId: string;
  discountPct: number;
  previousApprovalStatus: string | null;
  lines: Array<{ productId: string | null }>;
  actorUserId: string | null;
  dealTitle?: string | null;
  quoteNumber?: string | null;
  href?: string | null;
}): Promise<QuoteDiscountApprovalResult> {
  const limitPct = await computeQuoteDiscountLimit(input.lines);
  const requiresFinanceApproval = limitPct != null && input.discountPct > limitPct;
  const changedToFinancePending =
    requiresFinanceApproval &&
    input.previousApprovalStatus !== PENDING_FINANCE_APPROVAL;

  if (requiresFinanceApproval) {
    await prisma.quote.update({
      where: { id: input.quoteId },
      data: {
        approvalStatus: PENDING_FINANCE_APPROVAL,
        approvedByUserId: null,
        approvedAt: null,
        approvalNote: null,
      },
    });
  } else if (input.actorUserId) {
    await prisma.quote.update({
      where: { id: input.quoteId },
      data: {
        approvalStatus: "approved",
        approvedByUserId: input.actorUserId,
        approvedAt: new Date(),
        approvalNote: null,
      },
    });
  }

  if (changedToFinancePending) {
    await notifyFinanceOfDiscountApproval({
      organizationId: input.organizationId,
      quoteId: input.quoteId,
      quoteNumber: input.quoteNumber ?? null,
      dealTitle: input.dealTitle ?? null,
      discountPct: input.discountPct,
      limitPct,
      actorUserId: input.actorUserId,
      href: input.href ?? `/sales/quotes/${input.quoteId}`,
    });
  }

  return { requiresFinanceApproval, limitPct, changedToFinancePending };
}

/** Notify the deal owner that Finance approved or rejected a discount. */
export async function notifySalesOfDiscountDecision(input: {
  organizationId: string;
  quoteId: string;
  quoteNumber: string | null;
  dealId: string;
  dealTitle: string | null;
  ownerUserId: string | null;
  contactId: string | null;
  decision: "approved" | "rejected";
  reason?: string | null;
  actorUserId: string | null;
}): Promise<void> {
  if (!input.ownerUserId) return;
  const label = input.quoteNumber ? `Quote ${input.quoteNumber}` : "Your quote";
  const dealBit = input.dealTitle ? ` (${input.dealTitle})` : "";
  const title =
    input.decision === "approved"
      ? `Discount approved: ${label}`
      : `Discount rejected: ${label}`;
  const body =
    input.decision === "approved"
      ? `${label}${dealBit} is ready to send. Finance approved the discount — open the quote and send it yourself when ready.`
      : `${label}${dealBit} was rejected by Finance.${
          input.reason?.trim() ? ` Reason: ${input.reason.trim()}` : ""
        } Revise the discount and save to re-submit.`;

  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: [input.ownerUserId],
    kind:
      input.decision === "approved"
        ? "quote_discount_approved"
        : "quote_discount_rejected",
    title,
    body,
    href: `/sales/quotes/${input.quoteId}`,
    entityType: "quote",
    entityId: input.quoteId,
    contactId: input.contactId,
    actorUserId: input.actorUserId,
    metadata: {
      dealId: input.dealId,
      decision: input.decision,
      reason: input.reason ?? null,
    },
  });
}

async function notifyFinanceOfDiscountApproval(input: {
  organizationId: string;
  quoteId: string;
  quoteNumber: string | null;
  dealTitle: string | null;
  discountPct: number;
  limitPct: number | null;
  actorUserId: string | null;
  href: string;
}): Promise<void> {
  try {
    const [finance, admins] = await Promise.all([
      listFinanceUsers(input.organizationId),
      listAdminUsers(input.organizationId),
    ]);
    const recipientIds = [
      ...new Set([...finance.map((u) => u.id), ...admins.map((u) => u.id)]),
    ];
    if (recipientIds.length === 0) return;

    const label = input.quoteNumber ? `Quote ${input.quoteNumber}` : "A quote";
    const limitLabel = input.limitPct != null ? `${input.limitPct}%` : "the limit";

    await notifyUsersViaCrmBot({
      organizationId: input.organizationId,
      recipientUserIds: recipientIds,
      kind: "quote_discount_approval_required",
      title: "Discount approval needed",
      body: `${label}${input.dealTitle ? ` (${input.dealTitle})` : ""} has a ${input.discountPct}% discount, above the ${limitLabel} product cap. Send is blocked until Finance approves or rejects.`,
      href: input.href,
      entityType: "quote",
      entityId: input.quoteId,
      actorUserId: input.actorUserId,
    });
  } catch (err) {
    console.error("notifyFinanceOfDiscountApproval failed", input.quoteId, err);
  }
}
