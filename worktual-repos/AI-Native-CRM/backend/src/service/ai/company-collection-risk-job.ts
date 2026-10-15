/**
 * Company Collection Risk sweep — rechecks companies with invoice activity
 * on a recheck interval; fingerprint dedup skips unchanged LLM work.
 */

import { prisma } from "@/dao/db/prisma";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import { hashAgentInput, overdueBand } from "@/lib/agent-input-fingerprint";
import {
  markAgentInputFingerprint,
  shouldCallLlmForFingerprint,
} from "@/dao/ai/agent-input-fingerprint";

const DAY_MS = 24 * 60 * 60_000;
const AGENT = "company-collection-risk";

async function companyInputHash(
  companyId: string,
  organizationId: string,
): Promise<string | null> {
  const invoices = await prisma.invoice.findMany({
    where: { companyId, organizationId: BigInt(organizationId) },
    select: { status: true, total: true, dueAt: true, paidAt: true },
    take: 50,
    orderBy: { createdAt: "desc" },
  });
  if (invoices.length === 0) return null;

  const now = Date.now();
  const openBands = invoices
    .filter((row) => (row.status === "sent" || row.status === "overdue") && row.dueAt)
    .map((row) =>
      overdueBand(Math.floor((now - row.dueAt!.getTime()) / DAY_MS)),
    );
  const historyBands = invoices
    .filter((row) => row.status === "paid" && row.dueAt && row.paidAt)
    .map((row) =>
      overdueBand(
        Math.max(
          0,
          Math.round((row.paidAt!.getTime() - row.dueAt!.getTime()) / DAY_MS),
        ),
      ),
    );

  return hashAgentInput({
    totalInvoiceCount: invoices.length,
    openBands: openBands.sort(),
    historyBands: historyBands.sort(),
  });
}

export async function processCompanyCollectionRiskSweep(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{ processed: number; flagged: number; skippedUnchanged: number }> {
  const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
  // Company-level pattern moves slowly; a 24h recheck window is plenty.
  const recheckBefore = new Date(Date.now() - 24 * 60 * 60_000);

  const candidates = await prisma.company.findMany({
    where: {
      ...(options?.organizationId
        ? { organizationId: BigInt(options.organizationId) }
        : {}),
      invoices: { some: {} },
      OR: [
        { collectionRiskLastRunAt: null },
        { collectionRiskLastRunAt: { lt: recheckBefore } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true },
  });

  let processed = 0;
  let flagged = 0;
  let skippedUnchanged = 0;

  for (const company of candidates) {
    const organizationId = String(company.organizationId);
    const inputHash = await companyInputHash(company.id, organizationId);
    if (!inputHash) continue;

    const needsLlm = await shouldCallLlmForFingerprint({
      organizationId,
      agent: AGENT,
      entityType: "company",
      entityId: company.id,
      inputHash,
    });

    if (!needsLlm) {
      skippedUnchanged += 1;
      await markAgentInputFingerprint({
        organizationId,
        agent: AGENT,
        entityType: "company",
        entityId: company.id,
        inputHash,
        llmRan: false,
      });
      continue;
    }

    const result = await callAiServiceAgent<{ decision?: { riskLevel?: string } }>(
      "company-collection-risk",
      { companyId: company.id, organizationId },
    );
    await markAgentInputFingerprint({
      organizationId,
      agent: AGENT,
      entityType: "company",
      entityId: company.id,
      inputHash,
      llmRan: true,
    });
    processed += 1;
    if (result?.decision?.riskLevel && result.decision.riskLevel !== "none") {
      flagged += 1;
    }
  }

  return { processed, flagged, skippedUnchanged };
}
