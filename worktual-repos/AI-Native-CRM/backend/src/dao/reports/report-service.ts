import { prisma } from "@/dao/db/prisma";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { getUserLabelsByIds } from "@/service/account/user-directory";
import { resolveRecordOwnerScope } from "@/service/auth/ownership-scope";
import { canViewAllRecords } from "@/service/auth/rbac";
import { getCurrentUserRole } from "@/service/auth/require-role";
import { getServerUserId } from "@/service/account/session-cookie";

export type FunnelSnapshotPayload = {
  leadsByStatus: Record<string, number>;
  dealsByStage: Record<string, number>;
  wonCount: number;
  lostCount: number;
  lostReasons: Record<string, number>;
  quoteCounts: Record<string, number>;
  invoiceCounts: Record<string, number>;
  generatedAt: string;
};

/**
 * Build and store a funnel/win-loss snapshot for reporting without live OLTP scans on dashboards.
 */
export async function generateFunnelSnapshot(organizationId?: string | null) {
  const orgId = await resolveRequestOrganizationId(organizationId);

  const [deals, quotes, invoices] = await Promise.all([
    prisma.deal.findMany({
      where: { organizationId: orgId },
      select: { stage: true, lostReason: true },
      take: 50_000,
    }),
    prisma.quote.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: { organizationId: orgId },
      _count: { _all: true },
    }),
  ]);

  const dealsByStage: Record<string, number> = {};
  const lostReasons: Record<string, number> = {};
  let wonCount = 0;
  let lostCount = 0;
  for (const d of deals) {
    dealsByStage[d.stage] = (dealsByStage[d.stage] ?? 0) + 1;
    if (d.stage === "closed_won") wonCount += 1;
    if (d.stage === "closed_lost") {
      lostCount += 1;
      const key = d.lostReason?.trim() || "unspecified";
      lostReasons[key] = (lostReasons[key] ?? 0) + 1;
    }
  }

  const quoteCounts: Record<string, number> = {};
  for (const row of quotes) quoteCounts[row.status] = row._count._all;
  const invoiceCounts: Record<string, number> = {};
  for (const row of invoices) invoiceCounts[row.status] = row._count._all;

  const payload: FunnelSnapshotPayload = {
    leadsByStatus: {},
    dealsByStage,
    wonCount,
    lostCount,
    lostReasons,
    quoteCounts,
    invoiceCounts,
    generatedAt: new Date().toISOString(),
  };

  const snapshot = await prisma.reportSnapshot.create({
    data: {
      organizationId: orgId,
      kind: "funnel",
      payload,
    },
  });

  return snapshot;
}

export async function getLatestFunnelSnapshot(organizationId?: string | null) {
  const orgId = await resolveRequestOrganizationId(organizationId);
  return prisma.reportSnapshot.findFirst({
    where: { organizationId: orgId, kind: "funnel" },
    orderBy: { generatedAt: "desc" },
  });
}

/** Live own-only funnel for sales_rep / viewer / marketing (no org snapshot leak). */
export async function generateOwnScopedFunnel(
  ownerUserId: string,
  organizationId?: string | null,
): Promise<FunnelSnapshotPayload> {
  const orgId = await resolveRequestOrganizationId(organizationId);

  const [deals, quotes, invoices] = await Promise.all([
    prisma.deal.findMany({
      where: { organizationId: orgId, ownerUserId },
      select: { stage: true, lostReason: true },
      take: 50_000,
    }),
    prisma.quote.groupBy({
      by: ["status"],
      where: { organizationId: orgId, deal: { ownerUserId } },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: {
        organizationId: orgId,
        OR: [
          { deal: { ownerUserId } },
          { order: { deal: { ownerUserId } } },
          {
            AND: [
              { dealId: null },
              { orderId: null },
              { createdByUserId: ownerUserId },
            ],
          },
        ],
      },
      _count: { _all: true },
    }),
  ]);

  const dealsByStage: Record<string, number> = {};
  const lostReasons: Record<string, number> = {};
  let wonCount = 0;
  let lostCount = 0;
  for (const d of deals) {
    dealsByStage[d.stage] = (dealsByStage[d.stage] ?? 0) + 1;
    if (d.stage === "closed_won") wonCount += 1;
    if (d.stage === "closed_lost") {
      lostCount += 1;
      const key = d.lostReason?.trim() || "unspecified";
      lostReasons[key] = (lostReasons[key] ?? 0) + 1;
    }
  }

  const quoteCounts: Record<string, number> = {};
  for (const row of quotes) quoteCounts[row.status] = row._count._all;
  const invoiceCounts: Record<string, number> = {};
  for (const row of invoices) invoiceCounts[row.status] = row._count._all;

  return {
    leadsByStatus: {},
    dealsByStage,
    wonCount,
    lostCount,
    lostReasons,
    quoteCounts,
    invoiceCounts,
    generatedAt: new Date().toISOString(),
  };
}

export type CoachingInsightSummary = {
  id: string;
  activityId: string;
  contactId: string | null;
  overallImpression: string;
  discoveryQuality: string | null;
  objectionHandling: string | null;
  methodologyNote: string | null;
  talkBalanceNote: string | null;
  strengths: string[];
  growthAreas: string[];
  highlightedMoment: string | null;
  coachingNote: string;
  analyzedAt: string;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Sales & Pre-sales Coach Agent — rep-private feed of full per-interaction
 * coaching (own data only, `repUserId` is always the requesting user).
 * Never call this on another user's behalf; use `getCoachingTrendsForOrg`
 * for manager/admin views instead.
 */
export async function getMyCoachingInsights(
  repUserId: string,
  organizationId?: string | null,
  limit = 5,
): Promise<CoachingInsightSummary[]> {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const rows = await prisma.coachingInsight.findMany({
    where: { organizationId: orgId, repUserId: BigInt(repUserId) },
    orderBy: { analyzedAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    activityId: row.activityId,
    contactId: row.contactId,
    overallImpression: row.overallImpression,
    discoveryQuality: row.discoveryQuality,
    objectionHandling: row.objectionHandling,
    methodologyNote: row.methodologyNote,
    talkBalanceNote: row.talkBalanceNote,
    strengths: toStringArray(row.strengths),
    growthAreas: toStringArray(row.growthAreas),
    highlightedMoment: row.highlightedMoment,
    coachingNote: row.coachingNote ?? "",
    analyzedAt: row.analyzedAt.toISOString(),
  }));
}

export type CoachingTrendRow = {
  repUserId: string;
  repName: string;
  strong: number;
  solid: number;
  needsWork: number;
  total: number;
};

/**
 * Manager/admin aggregate view — counts of `overallImpression` per rep only.
 * Deliberately never selects `coachingNote` / `highlightedMoment` / any raw
 * per-interaction text; this is a content-level restriction on top of RBAC
 * (per the agent's HITL rule: raw coaching output stays rep-private even
 * from managers/admins who otherwise have full record access). They instead
 * receive a performance summary notification (impression + growth areas).
 */
export async function getCoachingTrendsForOrg(
  organizationId?: string | null,
  days = 90,
): Promise<CoachingTrendRow[]> {
  const orgId = await resolveRequestOrganizationId(organizationId);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.coachingInsight.groupBy({
    by: ["repUserId", "overallImpression"],
    where: { organizationId: orgId, analyzedAt: { gte: since } },
    _count: { _all: true },
  });
  if (rows.length === 0) return [];

  const repIds = [...new Set(rows.map((r) => String(r.repUserId)))];
  const labels = await getUserLabelsByIds(repIds);

  const map = new Map<string, CoachingTrendRow>();
  for (const row of rows) {
    const repUserId = String(row.repUserId);
    const entry =
      map.get(repUserId) ??
      ({
        repUserId,
        repName: labels.get(repUserId) ?? "Unknown rep",
        strong: 0,
        solid: 0,
        needsWork: 0,
        total: 0,
      } satisfies CoachingTrendRow);
    const n = row._count._all;
    if (row.overallImpression === "strong") entry.strong += n;
    else if (row.overallImpression === "solid") entry.solid += n;
    else if (row.overallImpression === "needs_work") entry.needsWork += n;
    entry.total += n;
    map.set(repUserId, entry);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export type DashboardFunnelSnapshot = {
  generatedAt: string | null;
  wonCount: number;
  lostCount: number;
  dealsByStage: Record<string, number>;
  lostReasons: Record<string, number>;
  quoteCounts: Record<string, number>;
  invoiceCounts: Record<string, number>;
};

export type DashboardAnalyticsData = {
  canSeeOrgSnapshot: boolean;
  funnelSnapshot: DashboardFunnelSnapshot | null;
  myCoaching: CoachingInsightSummary[];
  teamCoachingTrends: CoachingTrendRow[] | null;
};

function recordCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(raw);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function toFunnelSnapshot(
  payload: FunnelSnapshotPayload | Record<string, unknown> | null,
  generatedAt: string | null,
): DashboardFunnelSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  return {
    generatedAt,
    wonCount: Number(p.wonCount ?? 0),
    lostCount: Number(p.lostCount ?? 0),
    dealsByStage: recordCounts(p.dealsByStage),
    lostReasons: recordCounts(p.lostReasons),
    quoteCounts: recordCounts(p.quoteCounts),
    invoiceCounts: recordCounts(p.invoiceCounts),
  };
}

/** Shared analytics payload for home dashboard and reports API. */
export async function loadDashboardAnalytics(): Promise<DashboardAnalyticsData> {
  const [scope, role, currentUserId] = await Promise.all([
    resolveRecordOwnerScope(),
    getCurrentUserRole(),
    getServerUserId(),
  ]);
  const canSeeOrgSnapshot = canViewAllRecords(role);

  const [myCoaching, teamCoachingTrends] = await Promise.all([
    currentUserId ? getMyCoachingInsights(currentUserId) : Promise.resolve([]),
    canSeeOrgSnapshot ? getCoachingTrendsForOrg() : Promise.resolve(null),
  ]);

  if (canSeeOrgSnapshot) {
    const snapshot = await getLatestFunnelSnapshot();
    const payload =
      snapshot?.payload && typeof snapshot.payload === "object"
        ? (snapshot.payload as Record<string, unknown>)
        : null;
    return {
      canSeeOrgSnapshot: true,
      funnelSnapshot: toFunnelSnapshot(
        payload,
        snapshot?.generatedAt?.toISOString() ?? null,
      ),
      myCoaching,
      teamCoachingTrends,
    };
  }

  const ownPayload =
    scope.ownerUserId != null
      ? await generateOwnScopedFunnel(scope.ownerUserId)
      : null;

  return {
    canSeeOrgSnapshot: false,
    funnelSnapshot: ownPayload
      ? toFunnelSnapshot(ownPayload, ownPayload.generatedAt)
      : null,
    myCoaching,
    teamCoachingTrends: null,
  };
}
