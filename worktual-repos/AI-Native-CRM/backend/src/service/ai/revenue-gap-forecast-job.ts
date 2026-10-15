/**
 * Revenue Gap Forecast sweep — one run per organization with invoice
 * activity, on a recheck interval. Fingerprint dedup skips unchanged LLM
 * work (revenue/at-risk totals unchanged since the last run).
 */

import { prisma } from "@/dao/db/prisma";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import { hashAgentInput, overdueBand } from "@/lib/agent-input-fingerprint";
import {
  markAgentInputFingerprint,
  shouldCallLlmForFingerprint,
} from "@/dao/ai/agent-input-fingerprint";

const AGENT = "revenue-gap-forecast";

async function orgInputHash(organizationId: string): Promise<string> {
  const orgId = BigInt(organizationId);
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [paidAgg, atRisk, settings] = await Promise.all([
    prisma.invoice.aggregate({
      where: { organizationId: orgId, status: "paid", paidAt: { gte: periodStart } },
      _sum: { total: true },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId: orgId,
        status: { in: ["sent", "overdue"] },
        dueAt: { lt: now },
      },
      select: { total: true, dueAt: true },
    }),
    prisma.orgFinanceSettings.findUnique({
      where: { organizationId: orgId },
      select: { revenueTargetMonthly: true, revenueTargetQuarterly: true },
    }),
  ]);

  const atRiskBands = atRisk
    .map((row) =>
      row.dueAt
        ? overdueBand(Math.floor((now.getTime() - row.dueAt.getTime()) / (24 * 60 * 60_000)))
        : "unknown",
    )
    .sort();

  return hashAgentInput({
    collectedRevenue: Number(paidAgg._sum.total ?? 0),
    atRiskCount: atRisk.length,
    atRiskBands,
    targetMonthly: settings?.revenueTargetMonthly
      ? Number(settings.revenueTargetMonthly)
      : null,
    targetQuarterly: settings?.revenueTargetQuarterly
      ? Number(settings.revenueTargetQuarterly)
      : null,
  });
}

export async function processRevenueGapForecastSweep(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{ processed: number; skippedUnchanged: number }> {
  const limit = Math.min(100, Math.max(1, options?.limit ?? 30));
  // Dashboard-facing forecast — keep it reasonably fresh.
  const recheckBefore = new Date(Date.now() - 6 * 60 * 60_000);

  const orgIdsWithActivity = options?.organizationId
    ? [BigInt(options.organizationId)]
    : (
        await prisma.invoice.groupBy({
          by: ["organizationId"],
        })
      ).map((row) => row.organizationId);

  if (orgIdsWithActivity.length === 0) return { processed: 0, skippedUnchanged: 0 };

  const stale = await prisma.orgFinanceSettings.findMany({
    where: {
      organizationId: { in: orgIdsWithActivity },
      OR: [
        { revenueForecastLastRunAt: null },
        { revenueForecastLastRunAt: { lt: recheckBefore } },
      ],
    },
    select: { organizationId: true },
  });
  const staleIds = new Set(stale.map((row) => String(row.organizationId)));
  // Orgs with invoice activity but no OrgFinanceSettings row yet are stale too.
  const settingsIds = new Set(
    (
      await prisma.orgFinanceSettings.findMany({
        where: { organizationId: { in: orgIdsWithActivity } },
        select: { organizationId: true },
      })
    ).map((row) => String(row.organizationId)),
  );
  for (const orgId of orgIdsWithActivity) {
    if (!settingsIds.has(String(orgId))) staleIds.add(String(orgId));
  }

  const candidates = [...staleIds].slice(0, limit);

  let processed = 0;
  let skippedUnchanged = 0;

  for (const organizationId of candidates) {
    const inputHash = await orgInputHash(organizationId);
    const needsLlm = await shouldCallLlmForFingerprint({
      organizationId,
      agent: AGENT,
      entityType: "organization",
      entityId: organizationId,
      inputHash,
    });

    if (!needsLlm) {
      skippedUnchanged += 1;
      await markAgentInputFingerprint({
        organizationId,
        agent: AGENT,
        entityType: "organization",
        entityId: organizationId,
        inputHash,
        llmRan: false,
      });
      continue;
    }

    await callAiServiceAgent(AGENT, { organizationId });
    await markAgentInputFingerprint({
      organizationId,
      agent: AGENT,
      entityType: "organization",
      entityId: organizationId,
      inputHash,
      llmRan: true,
    });
    processed += 1;
  }

  return { processed, skippedUnchanged };
}
