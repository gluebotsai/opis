/**
 * Invoice Dunning sweep — overdue invoices not yet at the final stage,
 * gated by a minimum gap since the last stage message (so the cadence
 * doesn't re-fire the same stage daily). Fingerprint dedup on top skips
 * unchanged LLM work.
 */

import { prisma } from "@/dao/db/prisma";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import { hashAgentInput, overdueBand } from "@/lib/agent-input-fingerprint";
import {
  markAgentInputFingerprint,
  shouldCallLlmForFingerprint,
} from "@/dao/ai/agent-input-fingerprint";

const DAY_MS = 24 * 60 * 60_000;
const AGENT = "invoice-dunning";
// Minimum gap between dunning-stage messages so the cadence can't re-fire
// the same stage every sweep.
const MIN_STAGE_GAP_MS = 3 * DAY_MS;

async function invoiceInputHash(
  invoiceId: string,
  organizationId: string,
): Promise<string | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: BigInt(organizationId) },
    select: { status: true, dueAt: true, dunningStage: true },
  });
  if (!invoice) return null;
  const daysOverdue = invoice.dueAt
    ? Math.floor((Date.now() - invoice.dueAt.getTime()) / DAY_MS)
    : null;
  return hashAgentInput({
    status: invoice.status,
    overdueBand: overdueBand(daysOverdue),
    dunningStage: invoice.dunningStage,
  });
}

export async function processInvoiceDunningSweep(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{ processed: number; advanced: number; skippedUnchanged: number }> {
  const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
  const stageGapCutoff = new Date(Date.now() - MIN_STAGE_GAP_MS);

  const due = await prisma.invoice.findMany({
    where: {
      ...(options?.organizationId
        ? { organizationId: BigInt(options.organizationId) }
        : {}),
      status: { in: ["sent", "overdue"] },
      dueAt: { lt: new Date() },
      dunningStage: { not: "pause_notice" },
      OR: [
        { dunningStageSentAt: null },
        { dunningStageSentAt: { lt: stageGapCutoff } },
      ],
    },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true },
  });

  let processed = 0;
  let advanced = 0;
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

    const result = await callAiServiceAgent<{ decision?: { nextStage?: string } }>(
      AGENT,
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
    if (result?.decision?.nextStage && result.decision.nextStage !== "none") {
      advanced += 1;
    }
  }

  return { processed, advanced, skippedUnchanged };
}
