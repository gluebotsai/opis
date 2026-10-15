/**
 * Invoice Escalation sweep — flip overdue, then LLM-judge only when the
 * invoice input fingerprint changed (status/days-overdue band/total/history).
 */

import { prisma } from "@/dao/db/prisma";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import { processOverdueInvoices } from "@/dao/finance/overdue-invoices";
import {
  hashAgentInput,
  overdueBand,
} from "@/lib/agent-input-fingerprint";
import {
  markAgentInputFingerprint,
  shouldCallLlmForFingerprint,
} from "@/dao/ai/agent-input-fingerprint";

const DAY_MS = 24 * 60 * 60_000;
const AGENT = "invoice-escalation";

async function invoiceInputHash(
  invoiceId: string,
  organizationId: string,
): Promise<string | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: BigInt(organizationId) },
    select: {
      status: true,
      total: true,
      currency: true,
      dueAt: true,
      paymentTerms: true,
      companyId: true,
      deal: { select: { stage: true } },
    },
  });
  if (!invoice) return null;

  const daysOverdue = invoice.dueAt
    ? Math.floor((Date.now() - invoice.dueAt.getTime()) / DAY_MS)
    : null;

  let priorLateBands: string[] = [];
  if (invoice.companyId) {
    const priorPaid = await prisma.invoice.findMany({
      where: {
        companyId: invoice.companyId,
        status: "paid",
        id: { not: invoiceId },
        dueAt: { not: null },
        paidAt: { not: null },
      },
      orderBy: { paidAt: "desc" },
      take: 5,
      select: { dueAt: true, paidAt: true },
    });
    priorLateBands = priorPaid.map((row) => {
      if (!row.dueAt || !row.paidAt) return "unknown";
      const late = Math.floor(
        (row.paidAt.getTime() - row.dueAt.getTime()) / DAY_MS,
      );
      return overdueBand(Math.max(0, late));
    });
  }

  return hashAgentInput({
    status: invoice.status,
    total: Number(invoice.total),
    currency: invoice.currency,
    dueDate: invoice.dueAt?.toISOString().slice(0, 10) ?? null,
    overdueBand: overdueBand(daysOverdue),
    paymentTerms: invoice.paymentTerms ?? null,
    dealStage: invoice.deal?.stage ?? null,
    priorLateBands,
  });
}

export async function processInvoiceEscalationSweep(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{
  flippedOverdue: number;
  processed: number;
  escalated: number;
  skippedUnchanged: number;
}> {
  const overdueResult = await processOverdueInvoices();

  const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
  // Recheck overdue invoices every 6h; fingerprint skips unchanged LLM work.
  // Shorter than 24h so overdue-day bands can still trigger without a row update.
  const recheckBefore = new Date(Date.now() - 6 * 60 * 60_000);

  const due = await prisma.invoice.findMany({
    where: {
      ...(options?.organizationId
        ? { organizationId: BigInt(options.organizationId) }
        : {}),
      status: { in: ["sent", "overdue"] },
      dueAt: { lt: new Date() },
      OR: [
        { escalationLastRunAt: null },
        { escalationLastRunAt: { lt: recheckBefore } },
      ],
    },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true },
  });

  let processed = 0;
  let escalated = 0;
  let skippedUnchanged = 0;

  for (const invoice of due) {
    const organizationId = String(invoice.organizationId);
    const inputHash = await invoiceInputHash(invoice.id, organizationId);
    if (!inputHash) continue;

    const needsLlm = await shouldCallLlmForFingerprint({
      organizationId,
      agent: AGENT,
      entityType: "invoice",
      entityId: invoice.id,
      inputHash,
    });

    if (!needsLlm) {
      skippedUnchanged += 1;
      await markAgentInputFingerprint({
        organizationId,
        agent: AGENT,
        entityType: "invoice",
        entityId: invoice.id,
        inputHash,
        llmRan: false,
      });
      continue;
    }

    const result = await callAiServiceAgent<{ decision?: { severity?: string } }>(
      "invoice-escalation",
      { invoiceId: invoice.id, organizationId },
    );
    await markAgentInputFingerprint({
      organizationId,
      agent: AGENT,
      entityType: "invoice",
      entityId: invoice.id,
      inputHash,
      llmRan: true,
    });
    processed += 1;
    if (result?.decision?.severity && result.decision.severity !== "none") {
      escalated += 1;
    }
  }

  return {
    flippedOverdue: overdueResult.marked,
    processed,
    escalated,
    skippedUnchanged,
  };
}
