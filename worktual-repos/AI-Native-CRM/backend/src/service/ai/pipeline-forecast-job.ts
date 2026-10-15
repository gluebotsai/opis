/**
 * Pipeline Forecast Auditor sweep — re-judges open deals whose forecast is
 * due, but skips the LLM when the deal input fingerprint is unchanged.
 */

import { prisma } from "@/dao/db/prisma";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import { OPEN_FORECAST_STAGES } from "@/service/ai/pipeline-forecast-context";
import {
  activityAgeBand,
  hashAgentInput,
} from "@/lib/agent-input-fingerprint";
import {
  markAgentInputFingerprint,
  shouldCallLlmForFingerprint,
} from "@/dao/ai/agent-input-fingerprint";

const DAY_MS = 24 * 60 * 60_000;
const AGENT = "audit-forecast";

async function forecastInputHash(
  dealId: string,
  organizationId: string,
): Promise<string | null> {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId: BigInt(organizationId) },
    select: {
      stage: true,
      amount: true,
      expectedCloseDate: true,
      updatedAt: true,
      quotes: {
        select: { status: true, total: true },
        orderBy: { updatedAt: "desc" },
        take: 8,
      },
    },
  });
  if (!deal) return null;

  const lastActivity = await prisma.dealActivity.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const activityCount = await prisma.dealActivity.count({ where: { dealId } });
  const daysSinceActivity = lastActivity
    ? Math.floor((Date.now() - lastActivity.createdAt.getTime()) / DAY_MS)
    : null;
  const daysToClose = deal.expectedCloseDate
    ? Math.floor(
        (deal.expectedCloseDate.getTime() - Date.now()) / DAY_MS,
      )
    : null;

  return hashAgentInput({
    stage: deal.stage,
    amount: deal.amount != null ? Number(deal.amount) : null,
    expectedCloseDate: deal.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    closeBand: activityAgeBand(
      daysToClose == null ? null : Math.max(0, daysToClose),
    ),
    updatedBand: activityAgeBand(
      Math.floor((Date.now() - deal.updatedAt.getTime()) / DAY_MS),
    ),
    activityCount,
    activityBand: activityAgeBand(daysSinceActivity),
    quotes: deal.quotes.map((q) => ({
      status: q.status,
      total: Number(q.total),
    })),
  });
}

export async function processPipelineForecastSweep(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{ processed: number; flagged: number; skippedUnchanged: number }> {
  const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
  const staleBefore = new Date(Date.now() - DAY_MS);

  // Prefer never-run / stale rows, plus deals touched since last forecast eval.
  const due = await prisma.deal.findMany({
    where: {
      ...(options?.organizationId
        ? { organizationId: BigInt(options.organizationId) }
        : {}),
      stage: { in: OPEN_FORECAST_STAGES },
      OR: [
        { forecastLastRunAt: null },
        { forecastLastRunAt: { lt: staleBefore } },
        {
          AND: [
            { forecastLastRunAt: { not: null } },
            { updatedAt: { gt: staleBefore } },
          ],
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, organizationId: true, updatedAt: true, forecastLastRunAt: true },
  });

  const candidates = due.filter(
    (d) =>
      !d.forecastLastRunAt ||
      d.forecastLastRunAt < staleBefore ||
      d.updatedAt > d.forecastLastRunAt,
  );

  let processed = 0;
  let flagged = 0;
  let skippedUnchanged = 0;

  for (const deal of candidates) {
    const organizationId = String(deal.organizationId);
    const inputHash = await forecastInputHash(deal.id, organizationId);
    if (!inputHash) continue;

    const needsLlm = await shouldCallLlmForFingerprint({
      organizationId,
      agent: AGENT,
      entityType: "deal",
      entityId: deal.id,
      inputHash,
    });

    if (!needsLlm) {
      skippedUnchanged += 1;
      await markAgentInputFingerprint({
        organizationId,
        agent: AGENT,
        entityType: "deal",
        entityId: deal.id,
        inputHash,
        llmRan: false,
      });
      continue;
    }

    const result = await callAiServiceAgent<{ decision?: { flagged?: boolean } }>(
      "audit-forecast",
      { dealId: deal.id, organizationId },
    );
    await markAgentInputFingerprint({
      organizationId,
      agent: AGENT,
      entityType: "deal",
      entityId: deal.id,
      inputHash,
      llmRan: true,
    });
    processed += 1;
    if (result?.decision?.flagged) flagged += 1;
  }

  return { processed, flagged, skippedUnchanged };
}
