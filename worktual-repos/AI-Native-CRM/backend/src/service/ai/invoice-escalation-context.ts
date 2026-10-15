/**
 * Context + persistence for the Invoice Escalation Agent.
 *
 * Judges the collections risk of one overdue B2B invoice (severity band +
 * reasoning) and drafts an internal note + a customer-safe reminder for a
 * human to review and send.
 *
 * HITL rule (hard constraint): this agent only ever writes the four
 * `escalation*` overlay fields on `Invoice` (plus notifications) — it never
 * marks an invoice paid/void, never changes `dueAt`/`total`, and never sends
 * `escalationDraft` itself. That stays a human copy/send action.
 */

import type { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { notifyOwnerOrAdmins, notifyUsers } from "@/dao/notifications/notify-users";
import { listFinanceUsers } from "@/service/account/user-directory";

const DAY_MS = 24 * 60 * 60_000;

export const ESCALATION_SEVERITIES = ["watch", "escalate", "urgent"] as const;
export type EscalationSeverity = (typeof ESCALATION_SEVERITIES)[number];

export function isEscalationSeverity(v: unknown): v is EscalationSeverity {
  return typeof v === "string" && (ESCALATION_SEVERITIES as readonly string[]).includes(v);
}

export type InvoiceEscalationContext = {
  organizationId: string;
  invoiceId: string;
  number: string;
  status: InvoiceStatus;
  total: number;
  currency: string;
  companyId: string | null;
  companyName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  dealStage: string | null;
  ownerUserId: string | null;
  issueDate: string | null;
  dueAt: string | null;
  daysOverdue: number | null;
  paymentTerms: string | null;
  /** Prior paid invoices for the same company — did they pay on time historically? */
  priorPaymentHistory: Array<{
    daysLate: number;
    total: number;
  }>;
  escalationSeverity: EscalationSeverity | null;
  escalationReason: string | null;
  escalationLastRunAt: string | null;
};

export async function buildInvoiceEscalationContext(
  invoiceId: string,
  organizationId: string,
): Promise<InvoiceEscalationContext | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      currency: true,
      companyId: true,
      dealId: true,
      issueDate: true,
      dueAt: true,
      paymentTerms: true,
      escalationSeverity: true,
      escalationReason: true,
      escalationLastRunAt: true,
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true, stage: true, ownerUserId: true } },
    },
  });
  if (!invoice) return null;

  const daysOverdue = invoice.dueAt
    ? Math.floor((Date.now() - invoice.dueAt.getTime()) / DAY_MS)
    : null;

  const priorPaid = invoice.companyId
    ? await prisma.invoice.findMany({
        where: {
          companyId: invoice.companyId,
          status: "paid",
          id: { not: invoice.id },
          dueAt: { not: null },
          paidAt: { not: null },
        },
        orderBy: { paidAt: "desc" },
        take: 5,
        select: { total: true, dueAt: true, paidAt: true },
      })
    : [];

  const priorPaymentHistory = priorPaid
    .filter((row) => row.dueAt && row.paidAt)
    .map((row) => ({
      daysLate: Math.round(
        (row.paidAt!.getTime() - row.dueAt!.getTime()) / DAY_MS,
      ),
      total: Number(row.total),
    }));

  return {
    organizationId,
    invoiceId: invoice.id,
    number: invoice.number,
    status: invoice.status,
    total: Number(invoice.total),
    currency: invoice.currency,
    companyId: invoice.companyId,
    companyName: invoice.company?.name ?? null,
    dealId: invoice.dealId ?? invoice.deal?.id ?? null,
    dealTitle: invoice.deal?.title ?? null,
    dealStage: invoice.deal?.stage ?? null,
    ownerUserId: invoice.deal?.ownerUserId ? String(invoice.deal.ownerUserId) : null,
    issueDate: invoice.issueDate?.toISOString() ?? null,
    dueAt: invoice.dueAt?.toISOString() ?? null,
    daysOverdue,
    paymentTerms: invoice.paymentTerms,
    priorPaymentHistory,
    escalationSeverity: isEscalationSeverity(invoice.escalationSeverity)
      ? invoice.escalationSeverity
      : null,
    escalationReason: invoice.escalationReason,
    escalationLastRunAt: invoice.escalationLastRunAt?.toISOString() ?? null,
  };
}

export type InvoiceEscalationDecision = {
  severity: EscalationSeverity;
  reason: string;
  internalNote: string | null;
  customerDraft: string;
};

export async function persistInvoiceEscalationDecision(
  invoiceId: string,
  organizationId: string,
  decision: InvoiceEscalationDecision,
): Promise<{ applied: boolean }> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: {
      id: true,
      number: true,
      total: true,
      currency: true,
      deal: { select: { title: true, ownerUserId: true } },
    },
  });
  if (!invoice) return { applied: false };

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      escalationSeverity: decision.severity,
      escalationReason: decision.reason.slice(0, 500),
      escalationDraft: decision.customerDraft.slice(0, 2000),
      escalationLastRunAt: new Date(),
    },
  });

  const dealTitle = invoice.deal?.title ? ` (${invoice.deal.title})` : "";
  await notifyOwnerOrAdmins({
    organizationId,
    ownerUserId: invoice.deal?.ownerUserId ? String(invoice.deal.ownerUserId) : null,
    kind: "invoice_escalation",
    title: `Invoice ${invoice.number}${dealTitle} needs collections follow-up`,
    body: (decision.internalNote || decision.reason).slice(0, 240),
    href: `/finance/${invoiceId}`,
    entityType: "invoice",
    entityId: invoiceId,
    metadata: {
      severity: decision.severity,
      seedTools: [
        {
          name: "navigate",
          args: {
            href: `/finance/${invoiceId}`,
            seedPrompt: "Review this invoice's collections risk and reminder draft",
          },
        },
      ],
      risk: "low",
    },
  }).catch(() => null);

  if (decision.severity === "urgent") {
    const financeUsers = await listFinanceUsers(organizationId);
    if (financeUsers.length > 0) {
      await notifyUsers({
        organizationId,
        recipientUserIds: financeUsers.map((u) => u.id),
        kind: "invoice_escalation",
        title: `Urgent: invoice ${invoice.number}${dealTitle} is severely overdue`,
        body: decision.reason.slice(0, 240),
        href: `/finance/${invoiceId}`,
        entityType: "invoice",
        entityId: invoiceId,
        metadata: { severity: decision.severity },
      }).catch(() => null);
    }
  }

  return { applied: true };
}
