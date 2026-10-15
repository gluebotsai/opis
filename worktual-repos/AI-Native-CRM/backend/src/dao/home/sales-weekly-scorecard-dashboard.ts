/**
 * Phase 1 sales weekly scorecard — quotes sent, SQM proxy, proposal pipeline.
 * Universal for all B2B/B2B2C orgs; India team CSVs were the design reference.
 */

import type { SeniorityTier } from "@/dao/sales/assignment-settings";
import { listRepAssignmentProfiles } from "@/dao/sales/assignment-settings";
import { prisma } from "@/dao/db/prisma";
import {
  chooseDealAmountCurrency,
  formatDashboardMoney,
  resolveDashboardCurrency,
} from "@/lib/commercial-currency";
import {
  getWeekBounds,
  resolveTimeZone,
  SCORECARD_DEFAULT_TIMEZONE,
  type WeekBounds,
} from "@/lib/week-bounds";
import { listAssignableUsers } from "@/service/account/user-directory";
import { DEAL_STAGE_LABELS } from "@/service/sales/stages";
import type { DealStage } from "@prisma/client";

export const QUOTE_TARGET_PER_WEEK = 2;
export const SQM_TARGET_PER_WEEK = 5;

export type ScorecardRowStatus = "on_track" | "behind" | "ahead";

export type ScorecardRow = {
  userId: string;
  name: string;
  seniorityTier: string | null;
  target: number;
  achieved: number;
  gap: number;
  status: ScorecardRowStatus;
};

export type QuoteScorecardRow = ScorecardRow & { quoteIds: string[] };
export type SqmScorecardRow = ScorecardRow & { meetingIds: string[] };

export type SalesWeeklyScorecardData = {
  weekKey: string;
  weekLabel: string;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  region: string | null;
  regions: string[];
  quoteScorecard: {
    targetPerWeek: number;
    rows: QuoteScorecardRow[];
    orgTotal: { target: number; achieved: number };
  };
  sqmScorecard: {
    targetPerWeek: number;
    rows: SqmScorecardRow[];
    orgTotal: { target: number; achieved: number };
  };
  proposalPipeline: {
    rows: Array<{
      proposalId: string;
      proposalNumber: string;
      customerName: string;
      companyName: string;
      region: string | null;
      bdmUserId: string | null;
      bdmName: string | null;
      status: string;
      approvalStatus: string;
      dealStage: string;
      value: string | null;
      expectedClose: string | null;
      href: string;
    }>;
  };
  repsBehindCount: number;
  limitations: string[];
};

export type SalesWeeklyScorecardQuery = {
  region?: string | null;
  weekOffset?: number;
  timeZone?: string | null;
};

export function computeScorecardStatus(
  achieved: number,
  target: number,
  weekStart: Date,
  weekEnd: Date,
  now: Date = new Date(),
): ScorecardRowStatus {
  if (target <= 0) return achieved > 0 ? "ahead" : "on_track";
  const weekMs = weekEnd.getTime() - weekStart.getTime();
  const elapsedMs = Math.min(
    Math.max(now.getTime() - weekStart.getTime(), 0),
    weekMs,
  );
  const elapsedFraction = weekMs > 0 ? elapsedMs / weekMs : 1;
  const expectedPace = target * elapsedFraction;
  if (expectedPace <= 0) return achieved > 0 ? "ahead" : "on_track";
  if (achieved < expectedPace * 0.8) return "behind";
  if (achieved >= expectedPace * 1.2) return "ahead";
  return "on_track";
}

export function attributeQuoteUserId(
  createdByUserId: bigint | null | undefined,
  dealOwnerUserId: bigint | null | undefined,
): string | null {
  if (createdByUserId != null) return createdByUserId.toString();
  if (dealOwnerUserId != null) return dealOwnerUserId.toString();
  return null;
}

export function isQuoteTrackTier(tier: SeniorityTier | null | undefined): boolean {
  return tier == null || tier === "mid" || tier === "senior";
}

export function isSqmTrackTier(tier: SeniorityTier | null | undefined): boolean {
  return tier === "junior";
}

export function matchesRegion(
  dealCity: string | null | undefined,
  region: string | null | undefined,
): boolean {
  if (!region?.trim()) return true;
  return (dealCity?.trim() || "") === region.trim();
}

function money(n: number, currency: string): string {
  return formatDashboardMoney(n, currency);
}

function parseWeekOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.min(52, Math.max(-52, Math.round(raw)));
}

async function loadRegions(orgId: string): Promise<string[]> {
  const rows = await prisma.deal.findMany({
    where: { organizationId: orgId },
    select: { location: { select: { city: true } } },
    take: 500,
  });
  return [
    ...new Set(
      rows
        .map((r) => r.location.city?.trim())
        .filter((c): c is string => Boolean(c)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

async function contactIdsForRegion(
  orgId: string,
  region: string,
): Promise<string[]> {
  const deals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      location: { city: region },
      contactId: { not: null },
    },
    select: { contactId: true },
    take: 500,
  });
  return [
    ...new Set(
      deals
        .map((d) => d.contactId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

function buildQuoteRows(
  reps: Array<{ id: string; name: string; tier: SeniorityTier | null }>,
  quoteCounts: Map<string, { count: number; ids: string[] }>,
  bounds: WeekBounds,
  now: Date,
): QuoteScorecardRow[] {
  return reps
    .filter((r) => isQuoteTrackTier(r.tier))
    .map((rep) => {
      const data = quoteCounts.get(rep.id) ?? { count: 0, ids: [] };
      const target = QUOTE_TARGET_PER_WEEK;
      const achieved = data.count;
      return {
        userId: rep.id,
        name: rep.name,
        seniorityTier: rep.tier,
        target,
        achieved,
        gap: Math.max(0, target - achieved),
        status: computeScorecardStatus(
          achieved,
          target,
          bounds.weekStart,
          bounds.weekEnd,
          now,
        ),
        quoteIds: data.ids,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildSqmRows(
  reps: Array<{ id: string; name: string; tier: SeniorityTier | null }>,
  sqmCounts: Map<string, { count: number; ids: string[] }>,
  bounds: WeekBounds,
  now: Date,
): SqmScorecardRow[] {
  return reps
    .filter((r) => isSqmTrackTier(r.tier))
    .map((rep) => {
      const data = sqmCounts.get(rep.id) ?? { count: 0, ids: [] };
      const target = SQM_TARGET_PER_WEEK;
      const achieved = data.count;
      return {
        userId: rep.id,
        name: rep.name,
        seniorityTier: rep.tier,
        target,
        achieved,
        gap: Math.max(0, target - achieved),
        status: computeScorecardStatus(
          achieved,
          target,
          bounds.weekStart,
          bounds.weekEnd,
          now,
        ),
        meetingIds: data.ids,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSalesWeeklyScorecard(
  orgId: string,
  query: SalesWeeklyScorecardQuery = {},
): Promise<SalesWeeklyScorecardData> {
  const region = query.region?.trim() || null;
  const weekOffset = parseWeekOffset(query.weekOffset);
  const timeZone = resolveTimeZone(
    query.timeZone ?? SCORECARD_DEFAULT_TIMEZONE,
  );
  const now = new Date();
  const bounds = getWeekBounds(timeZone, now, weekOffset);
  const tenantCurrency = await resolveDashboardCurrency(orgId);

  const [assignableUsers, repProfiles, regions, regionContactIds] =
    await Promise.all([
      listAssignableUsers(orgId),
      listRepAssignmentProfiles(orgId),
      loadRegions(orgId),
      region ? contactIdsForRegion(orgId, region) : Promise.resolve([]),
    ]);

  const salesReps = assignableUsers.filter((u) => u.role === "sales_rep");
  const nameById = new Map(assignableUsers.map((u) => [u.id, u.name]));
  const repRows = salesReps.map((u) => ({
    id: u.id,
    name: u.name,
    tier: repProfiles.get(u.id)?.seniorityTier ?? null,
  }));

  const quotes = await prisma.quote.findMany({
    where: {
      organizationId: orgId,
      sentAt: { gte: bounds.weekStart, lt: bounds.weekEnd },
      status: { in: ["sent", "accepted"] },
    },
    select: {
      id: true,
      createdByUserId: true,
      deal: {
        select: {
          ownerUserId: true,
          location: { select: { city: true } },
        },
      },
    },
  });

  const quoteCounts = new Map<string, { count: number; ids: string[] }>();
  for (const quote of quotes) {
    if (!matchesRegion(quote.deal.location.city, region)) continue;
    const userId = attributeQuoteUserId(
      quote.createdByUserId,
      quote.deal.ownerUserId,
    );
    if (!userId) continue;
    const entry = quoteCounts.get(userId) ?? { count: 0, ids: [] };
    entry.count += 1;
    entry.ids.push(quote.id);
    quoteCounts.set(userId, entry);
  }

  const meetings = await prisma.contactActivity.findMany({
    where: {
      organizationId: orgId,
      type: "meeting",
      folder: { not: "trash" },
      OR: [
        {
          completedAt: {
            gte: bounds.weekStart,
            lt: bounds.weekEnd,
          },
        },
        {
          transcriptText: { not: null },
          dueAt: { gte: bounds.weekStart, lt: bounds.weekEnd },
        },
      ],
      ...(region && regionContactIds.length > 0
        ? { contactId: { in: regionContactIds } }
        : region
          ? { contactId: { in: ["__none__"] } }
          : {}),
    },
    select: {
      id: true,
      createdByUserId: true,
      contactId: true,
    },
  });

  const meetingIds = meetings.map((m) => m.id);
  const analyses =
    meetingIds.length > 0
      ? await prisma.meetingAnalysis.findMany({
          where: { activityId: { in: meetingIds }, outcome: "no_show" },
          select: { activityId: true },
        })
      : [];
  const noShowIds = new Set(analyses.map((a) => a.activityId));

  const sqmCounts = new Map<string, { count: number; ids: string[] }>();
  for (const meeting of meetings) {
    if (noShowIds.has(meeting.id)) continue;
    const userId = meeting.createdByUserId?.toString();
    if (!userId) continue;
    const entry = sqmCounts.get(userId) ?? { count: 0, ids: [] };
    entry.count += 1;
    entry.ids.push(meeting.id);
    sqmCounts.set(userId, entry);
  }

  const quoteScorecardRows = buildQuoteRows(
    repRows,
    quoteCounts,
    bounds,
    now,
  );
  const sqmScorecardRows = buildSqmRows(repRows, sqmCounts, bounds, now);

  const proposals = await prisma.proposal.findMany({
    where: {
      organizationId: orgId,
      status: { not: "declined" },
      ...(region
        ? { deal: { location: { city: region } } }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      deal: {
        select: {
          id: true,
          stage: true,
          amount: true,
          expectedCloseDate: true,
          ownerUserId: true,
          company: { select: { name: true } },
          location: { select: { city: true } },
          quotes: {
            where: { status: { in: ["sent", "accepted"] } },
            orderBy: { sentAt: "desc" },
            take: 1,
            select: { total: true, currency: true },
          },
        },
      },
    },
  });

  const proposalPipelineRows = proposals.map((p) => {
    const deal = p.deal;
    const latestQuote = deal.quotes[0];
    const quoteCurrency =
      chooseDealAmountCurrency({
        quoteCurrency: latestQuote?.currency ?? null,
        tenantCurrency,
      }) ?? tenantCurrency;
    const value = latestQuote
      ? money(Number(latestQuote.total), quoteCurrency)
      : deal.amount != null
        ? money(Number(deal.amount), tenantCurrency)
        : null;
    const ownerId = deal.ownerUserId?.toString() ?? null;
    return {
      proposalId: p.id,
      proposalNumber: p.number,
      customerName: p.customerName?.trim() || deal.company.name,
      companyName: deal.company.name,
      region: deal.location.city?.trim() || null,
      bdmUserId: ownerId,
      bdmName: ownerId ? nameById.get(ownerId) ?? null : null,
      status: p.status,
      approvalStatus: p.approvalStatus,
      dealStage:
        DEAL_STAGE_LABELS[deal.stage as DealStage] ?? deal.stage,
      value,
      expectedClose: deal.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
      href: `/sales/proposals/${p.id}`,
    };
  });

  const repsBehindCount = [
    ...quoteScorecardRows,
    ...sqmScorecardRows,
  ].filter((r) => r.status === "behind").length;

  return {
    weekKey: bounds.weekKey,
    weekLabel: bounds.weekLabel,
    timeZone: bounds.timeZone,
    weekStart: bounds.weekStart.toISOString(),
    weekEnd: bounds.weekEnd.toISOString(),
    region,
    regions,
    quoteScorecard: {
      targetPerWeek: QUOTE_TARGET_PER_WEEK,
      rows: quoteScorecardRows,
      orgTotal: {
        target: quoteScorecardRows.reduce((s, r) => s + r.target, 0),
        achieved: quoteScorecardRows.reduce((s, r) => s + r.achieved, 0),
      },
    },
    sqmScorecard: {
      targetPerWeek: SQM_TARGET_PER_WEEK,
      rows: sqmScorecardRows,
      orgTotal: {
        target: sqmScorecardRows.reduce((s, r) => s + r.target, 0),
        achieved: sqmScorecardRows.reduce((s, r) => s + r.achieved, 0),
      },
    },
    proposalPipeline: { rows: proposalPipelineRows },
    repsBehindCount,
    limitations: [
      "SQM counts completed meetings with transcript (or completedAt) this week; explicit SQ Y/N outcomes come in Phase 2.",
      "MRR vs one-time implementation split and Pending Pricing/Presales statuses are not yet in CRM.",
      "Weekly targets (2 quotes / 5 SQM) are product defaults until Configuration supports overrides.",
      "SDR vs BDM tracks use seniority tier on Configuration → Sales assignment (junior = SQM, mid/senior = quotes).",
    ],
  };
}

export type RepWeeklyScorecardData = {
  weekLabel: string;
  timeZone: string;
  track: "quotes" | "sqm" | null;
  target: number;
  achieved: number;
  gap: number;
  status: ScorecardRowStatus;
};

export async function getRepWeeklyScorecard(
  orgId: string,
  userId: string,
  query: SalesWeeklyScorecardQuery = {},
): Promise<RepWeeklyScorecardData | null> {
  const full = await getSalesWeeklyScorecard(orgId, query);
  const profiles = await listRepAssignmentProfiles(orgId);
  const tier = profiles.get(userId)?.seniorityTier ?? null;

  if (isSqmTrackTier(tier)) {
    const row = full.sqmScorecard.rows.find((r) => r.userId === userId);
    if (!row) {
      return {
        weekLabel: full.weekLabel,
        timeZone: full.timeZone,
        track: "sqm",
        target: SQM_TARGET_PER_WEEK,
        achieved: 0,
        gap: SQM_TARGET_PER_WEEK,
        status: computeScorecardStatus(
          0,
          SQM_TARGET_PER_WEEK,
          new Date(full.weekStart),
          new Date(full.weekEnd),
        ),
      };
    }
    return {
      weekLabel: full.weekLabel,
      timeZone: full.timeZone,
      track: "sqm",
      target: row.target,
      achieved: row.achieved,
      gap: row.gap,
      status: row.status,
    };
  }

  if (isQuoteTrackTier(tier)) {
    const row = full.quoteScorecard.rows.find((r) => r.userId === userId);
    if (!row) {
      return {
        weekLabel: full.weekLabel,
        timeZone: full.timeZone,
        track: "quotes",
        target: QUOTE_TARGET_PER_WEEK,
        achieved: 0,
        gap: QUOTE_TARGET_PER_WEEK,
        status: computeScorecardStatus(
          0,
          QUOTE_TARGET_PER_WEEK,
          new Date(full.weekStart),
          new Date(full.weekEnd),
        ),
      };
    }
    return {
      weekLabel: full.weekLabel,
      timeZone: full.timeZone,
      track: "quotes",
      target: row.target,
      achieved: row.achieved,
      gap: row.gap,
      status: row.status,
    };
  }

  return null;
}
