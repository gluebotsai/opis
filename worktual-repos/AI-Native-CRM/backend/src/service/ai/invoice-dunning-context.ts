/**
 * Context + persistence for the Invoice Dunning Agent.
 *
 * Staged Reminder -> Warning -> Service-Pause-Notice cadence for one overdue
 * invoice, advancing at most one stage per run (enforced in the Python
 * agent, not just the prompt).
 *
 * HITL rule (hard constraint, matches invoice_escalation_agent): this agent
 * only ever writes the three `dunning*` overlay fields on `Invoice` (plus a
 * notification) — it never marks an invoice paid/void, never changes
 * dueAt/total, and never sends `dunningDraft` itself.
 */

import type { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { notifyOwnerOrAdmins, notifyUsers } from "@/dao/notifications/notify-users";
import { listFinanceUsers } from "@/service/account/user-directory";

const DAY_MS = 24 * 60 * 60_000;

export const DUNNING_STAGES = ["none", "reminder", "warning", "pause_notice"] as const;
export type DunningStage = (typeof DUNNING_STAGES)[number];

export function isDunningStage(v: unknown): v is DunningStage {
  return typeof v === "string" && (DUNNING_STAGES as readonly string[]).includes(v);
}

export type InvoiceDunningContext = {
  organizationId: string;
  invoiceId: string;
  number: string;
  status: InvoiceStatus;
  total: number;
  currency: string;
  daysOverdue: number | null;
  dunningStage: DunningStage;
  dunningStageSentAt: string | null;
  collectionRiskLevel: string | null;
  ownerUserId: string | null;
};

export async function buildInvoiceDunningContext(
  invoiceId: string,
  organizationId: string,
): Promise<InvoiceDunningContext | null> {
  const orgId = BigInt(organizationId);
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      currency: true,
      dueAt: true,
      dunningStage: true,
      dunningStageSentAt: true,
      deal: { select: { ownerUserId: true } },
      company: { select: { collectionRiskLevel: true } },
    },
  });
  if (!invoice) return null;

  const daysOverdue = invoice.dueAt
    ? Math.floor((Date.now() - invoice.dueAt.getTime()) / DAY_MS)
    : null;

  return {
    organizationId,
    invoiceId: invoice.id,
    number: invoice.number,
    status: invoice.status,
    total: Number(invoice.total),
    currency: invoice.currency,
    daysOverdue,
    dunningStage: isDunningStage(invoice.dunningStage) ? invoice.dunningStage : "none",
    dunningStageSentAt: invoice.dunningStageSentAt?.toISOString() ?? null,
    collectionRiskLevel: invoice.company?.collectionRiskLevel ?? null,
    ownerUserId: invoice.deal?.ownerUserId ? String(invoice.deal.ownerUserId) : null,
  };
}

export type InvoiceDunningDecision = {
  nextStage: DunningStage;
  reason: string;
  message: string;
};

export async function persistInvoiceDunningDecision(
  invoiceId: string,
  organizationId: string,
  decision: InvoiceDunningDecision,
): Promise<{ applied: boolean }> {
  const orgId = BigInt(organizationId);
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    select: {
      id: true,
      number: true,
      dunningStage: true,
      deal: { select: { title: true, ownerUserId: true } },
    },
  });
  if (!invoice) return { applied: false };

  const currentStage = isDunningStage(invoice.dunningStage)
    ? invoice.dunningStage
    : "none";
  const advanced = decision.nextStage !== currentStage;

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      dunningStage: decision.nextStage,
      ...(advanced
        ? {
            dunningStageSentAt: new Date(),
            dunningDraft: decision.message.slice(0, 2000),
          }
        : {}),
    },
  });

  if (advanced) {
    const dealTitle = invoice.deal?.title ? ` (${invoice.deal.title})` : "";
    await notifyOwnerOrAdmins({
      organizationId,
      ownerUserId: invoice.deal?.ownerUserId ? String(invoice.deal.ownerUserId) : null,
      kind: "invoice_dunning",
      title: `Invoice ${invoice.number}${dealTitle} moved to dunning stage "${decision.nextStage}"`,
      body: decision.reason.slice(0, 240),
      href: `/finance/${invoiceId}`,
      entityType: "invoice",
      entityId: invoiceId,
      metadata: {
        stage: decision.nextStage,
        seedTools: [
          {
            name: "navigate",
            args: {
              href: `/finance/${invoiceId}`,
              seedPrompt: "Review this invoice's dunning draft before sending",
            },
          },
        ],
        risk: "low",
      },
    }).catch(() => null);

    if (decision.nextStage === "pause_notice") {
      const financeUsers = await listFinanceUsers(organizationId);
      if (financeUsers.length > 0) {
        await notifyUsers({
          organizationId,
          recipientUserIds: financeUsers.map((u) => u.id),
          kind: "invoice_dunning",
          title: `Invoice ${invoice.number}${dealTitle} reached service-pause-notice stage`,
          body: decision.reason.slice(0, 240),
          href: `/finance/${invoiceId}`,
          entityType: "invoice",
          entityId: invoiceId,
          metadata: { stage: decision.nextStage },
        }).catch(() => null);
      }
    }
  }

  return { applied: true };
}
