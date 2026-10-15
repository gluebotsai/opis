/**
 * Expansion & Revenue Matcher sweep — LLM only when company expansion inputs change.
 */

import { prisma } from "@/dao/db/prisma";
import { callAiServiceAgent } from "@/service/ai/ai-service-client";
import {
  activityAgeBand,
  hashAgentInput,
} from "@/lib/agent-input-fingerprint";
import {
  markAgentInputFingerprint,
  shouldCallLlmForFingerprint,
} from "@/dao/ai/agent-input-fingerprint";

const DAY_MS = 24 * 60 * 60_000;
/** Outer recheck cadence — fingerprint decides whether LLM runs. */
const RECHECK_MS = DAY_MS;
const AGENT = "expansion-matcher";

const OPEN_STAGES = [
  "qualification",
  "discover",
  "propose",
  "negotiate",
] as const;

async function expansionInputHash(
  companyId: string,
  organizationId: string,
): Promise<string | null> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: BigInt(organizationId) },
    select: {
      industry: true,
      employeeCount: true,
    },
  });
  if (!company) return null;

  const orgId = BigInt(organizationId);
  const [closedWon, openDeals, products] = await Promise.all([
    prisma.deal.findMany({
      where: { companyId, organizationId: orgId, stage: "closed_won" },
      orderBy: { closedAt: "desc" },
      select: {
        amount: true,
        closedAt: true,
        quotes: { select: { lines: { select: { name: true } } }, take: 3 },
      },
      take: 20,
    }),
    prisma.deal.findMany({
      where: { companyId, organizationId: orgId, stage: { in: [...OPEN_STAGES] } },
      select: { stage: true },
    }),
    prisma.product.findMany({
      where: { organizationId: orgId, status: "active" },
      orderBy: { name: "asc" },
      take: 40,
      select: { name: true },
    }),
  ]);

  const lastClosed = closedWon[0]?.closedAt ?? null;
  const daysSinceWon = lastClosed
    ? Math.floor((Date.now() - lastClosed.getTime()) / DAY_MS)
    : null;
  const purchased = Array.from(
    new Set(
      closedWon.flatMap((d) =>
        d.quotes.flatMap((q) => q.lines.map((l) => l.name).filter(Boolean)),
      ),
    ),
  )
    .map(String)
    .sort()
    .slice(0, 40);

  return hashAgentInput({
    industry: company.industry ?? null,
    employeeCount: company.employeeCount ?? null,
    closedWonCount: closedWon.length,
    closedWonTotal: closedWon.reduce((s, d) => s + Number(d.amount ?? 0), 0),
    wonAgeBand: activityAgeBand(daysSinceWon),
    openStages: openDeals.map((d) => d.stage).sort(),
    purchased,
    catalog: products.map((p) => p.name),
  });
}

export async function processExpansionMatcherSweep(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{ processed: number; flagged: number; skippedUnchanged: number }> {
  const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
  const recheckBefore = new Date(Date.now() - RECHECK_MS);

  const due = await prisma.company.findMany({
    where: {
      ...(options?.organizationId
        ? { organizationId: BigInt(options.organizationId) }
        : {}),
      deals: { some: { stage: "closed_won" } },
      OR: [
        { expansionLastRunAt: null },
        { expansionLastRunAt: { lt: recheckBefore } },
        {
          AND: [
            { expansionLastRunAt: { not: null } },
            { updatedAt: { gt: recheckBefore } },
          ],
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      organizationId: true,
      updatedAt: true,
      expansionLastRunAt: true,
    },
  });

  const candidates = due.filter(
    (c) =>
      !c.expansionLastRunAt ||
      c.expansionLastRunAt < recheckBefore ||
      c.updatedAt > c.expansionLastRunAt,
  );

  let processed = 0;
  let flagged = 0;
  let skippedUnchanged = 0;

  for (const company of candidates) {
    const organizationId = String(company.organizationId);
    const inputHash = await expansionInputHash(company.id, organizationId);
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

    const result = await callAiServiceAgent<{ decision?: { signal?: string } }>(
      "expansion-matcher",
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
    if (result?.decision?.signal && result.decision.signal !== "none") {
      flagged += 1;
    }
  }

  return { processed, flagged, skippedUnchanged };
}
