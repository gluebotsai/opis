import type { DealStage } from "@prisma/client";
import { findContactIdsByContactType } from "@/dao/account/account-repository";
import {
  formatContactDisplayName,
  formatContactListLabel,
  hasActionableContactIdentity,
} from "@/lib/contact-name";
import { prisma } from "@/dao/db/prisma";
import { formatDashboardMoney, resolveDashboardCurrency } from "@/lib/commercial-currency";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import {
  getUserLabelsByIds,
  listAssignableUsers,
  type AssignableUser,
} from "@/service/account/user-directory";
import {
  getSalesMetricsDashboard,
  type SalesMetricsData,
} from "@/dao/home/sales-metrics-dashboard";
import {
  getSalesWeeklyScorecard,
  type SalesWeeklyScorecardData,
} from "@/dao/home/sales-weekly-scorecard-dashboard";
import { loadRevenueBoard, type RevenueBoard } from "@/dao/home/revenue-board";
import { dashboardKpiBounds } from "@/dao/home/dashboard-kpi-window";
import { DEAL_STAGE_LABELS } from "@/service/sales/stages";

export type LeaderboardMetric = "deals_closed" | "revenue" | "calls";
export type LeaderboardPeriod = "all_time" | "week" | "month" | "quarter";
export type MetricsPeriod =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "quarter";
export type TeamDealGroupBy = "stage" | "rep";

export type AdminOpsQuery = {
  leaderboardMetric?: LeaderboardMetric;
  leaderboardPeriod?: LeaderboardPeriod;
  metricsPeriod?: MetricsPeriod;
  untouchedHours?: number;
  teamGroupBy?: TeamDealGroupBy;
  region?: string | null;
  repId?: string | null;
  scorecardWeek?: string | null;
  scorecardTz?: string | null;
};

export type AdminOpsData = {
  assignableUsers: AssignableUser[];
  leaderboard: {
    metric: LeaderboardMetric;
    period: LeaderboardPeriod;
    rows: Array<{
      userId: string;
      name: string;
      value: number;
      valueLabel: string;
    }>;
  };
  untouchedLeads: {
    thresholdHours: number;
    items: Array<{
      id: string;
      displayName: string;
      email: string;
      ownerUserId: string | null;
      ownerName: string | null;
      updatedAt: string;
      ageHours: number;
    }>;
  };
  /** Lifecycle agent flagged for human review (ambiguous evidence / stall). */
  needsReview: {
    items: Array<{
      id: string;
      displayName: string;
      email: string;
      ownerUserId: string | null;
      ownerName: string | null;
      reason: string | null;
      flaggedAt: string | null;
    }>;
  };
  monthlyMetrics: {
    period: MetricsPeriod;
    title: string;
    compareLabel: string;
    cards: Array<{
      id: "leads_created" | "deals_created" | "revenue";
      label: string;
      value: string;
      changePct: number | null;
      href: string;
    }>;
  };
  /** Org snapshot cards shown after Deals created in the metrics row. */
  pipelineSnapshot: {
    openDeals: { value: string; hint: string; href: string };
    closedWon: { value: string; hint: string; href: string };
  };
  activityFeed: {
    loggedToday: number;
    repCount: number;
    items: Array<{
      id: string;
      type: string;
      subject: string;
      contactId: string;
      contactName: string;
      createdAt: string;
      actorName: string | null;
    }>;
  };
  teamDeals: {
    groupBy: TeamDealGroupBy;
    region: string | null;
    regions: string[];
    summary: {
      open: number;
      negotiation: number;
      closed: number;
    };
    groups: Array<{
      id: string;
      label: string;
      deals: Array<{
        id: string;
        title: string;
        stage: DealStage;
        stageLabel: string;
        amount: string | null;
        companyName: string;
        region: string | null;
        ownerUserId: string | null;
        ownerName: string | null;
      }>;
    }>;
  };
  focusedRep: {
    userId: string;
    name: string;
    openDeals: number;
    wonDeals: number;
    pipelineValue: string;
    callsInPeriod: number;
  } | null;
  /** PDF metrics reference — Phase 1 sales analytics. */
  salesMetrics: SalesMetricsData;
  /** Weekly quote / SQM scorecards + proposal pipeline. */
  weeklyScorecard: SalesWeeklyScorecardData;
  /** Paid-invoice revenue for the current and previous Kolkata quarters. */
  revenueBoard: RevenueBoard;
};

function money(n: number, currency: string): string {
  return formatDashboardMoney(n, currency);
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function periodStart(period: LeaderboardPeriod, now = new Date()): Date {
  if (period === "all_time") {
    return new Date(0);
  }
  const start = new Date(now);
  if (period === "week") {
    start.setDate(start.getDate() - 7);
  } else if (period === "quarter") {
    start.setMonth(start.getMonth() - 3);
  } else {
    start.setMonth(start.getMonth() - 1);
  }
  return start;
}

function metricsBounds(period: MetricsPeriod, now = new Date()) {
  return dashboardKpiBounds(period, now);
}

function closedWonInWindow(orgId: string, start: Date, end: Date) {
  return {
    organizationId: orgId,
    stage: "closed_won" as const,
    OR: [
      { closedAt: { gte: start, lt: end } },
      { closedAt: null, createdAt: { gte: start, lt: end } },
    ],
  };
}

function parseMetric(raw: string | undefined): LeaderboardMetric {
  if (raw === "revenue" || raw === "calls" || raw === "deals_closed") return raw;
  return "deals_closed";
}

function parsePeriod(raw: string | undefined): LeaderboardPeriod {
  if (
    raw === "all_time" ||
    raw === "week" ||
    raw === "quarter" ||
    raw === "month"
  ) {
    return raw;
  }
  return "all_time";
}

function parseMetricsPeriod(raw: string | undefined): MetricsPeriod {
  if (
    raw === "today" ||
    raw === "yesterday" ||
    raw === "week" ||
    raw === "month" ||
    raw === "quarter"
  ) {
    return raw;
  }
  return "month";
}

function parseGroupBy(raw: string | undefined): TeamDealGroupBy {
  return raw === "rep" ? "rep" : "stage";
}

function clampHours(raw: number | undefined): number {
  if (!raw || !Number.isFinite(raw)) return 24;
  return Math.min(720, Math.max(1, Math.round(raw)));
}

function parseScorecardWeek(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(52, Math.max(-52, n));
}

export async function getAdminOpsDashboard(
  query: AdminOpsQuery = {},
): Promise<AdminOpsData> {
  const orgId = await getCurrentOrganizationId();
  const metric = parseMetric(query.leaderboardMetric);
  const period = parsePeriod(query.leaderboardPeriod);
  const metricsPeriod = parseMetricsPeriod(query.metricsPeriod);
  const untouchedHours = clampHours(query.untouchedHours);
  const teamGroupBy = parseGroupBy(query.teamGroupBy);
  const region = query.region?.trim() || null;
  const repId = query.repId?.trim() || null;
  const scorecardWeek = parseScorecardWeek(query.scorecardWeek);
  const scorecardTz = query.scorecardTz?.trim() || null;
  const since = periodStart(period);
  const bounds = metricsBounds(metricsPeriod);
  const currency = await resolveDashboardCurrency(orgId);

  const assignableUsers = await listAssignableUsers(orgId);
  const assignableIds = assignableUsers.map((u) => u.id);
  const nameById = new Map(assignableUsers.map((u) => [u.id, u.name]));

  const [
    leaderboardRows,
    untouched,
    needsReview,
    monthly,
    activity,
    team,
    focusedRep,
    pipelineSnapshot,
    salesMetrics,
    weeklyScorecard,
    revenueBoard,
  ] = await Promise.all([
    loadLeaderboard(orgId, metric, since, nameById, assignableIds, currency),
    loadUntouchedLeads(orgId, untouchedHours, nameById),
    loadNeedsReviewLeads(orgId, nameById),
    loadPeriodMetrics(orgId, metricsPeriod, bounds, currency),
    loadActivityFeed(orgId, nameById),
    loadTeamDeals(orgId, teamGroupBy, region, nameById),
    repId
      ? loadFocusedRep(orgId, repId, since, nameById, currency)
      : Promise.resolve(null),
    loadPipelineSnapshot(orgId),
    getSalesMetricsDashboard(
      {
        currentStart: bounds.currentStart,
        currentEnd: bounds.currentEnd,
        prevStart: bounds.prevStart,
        prevEnd: bounds.prevEnd,
        periodLabel: bounds.shortLabel,
      },
      orgId,
    ),
    getSalesWeeklyScorecard(orgId, {
      region,
      weekOffset: scorecardWeek,
      timeZone: scorecardTz,
    }),
    loadRevenueBoard(orgId, currency, nameById),
  ]);

  return {
    assignableUsers,
    leaderboard: {
      metric,
      period,
      rows: leaderboardRows,
    },
    untouchedLeads: untouched,
    needsReview,
    monthlyMetrics: monthly,
    pipelineSnapshot,
    activityFeed: activity,
    teamDeals: team,
    focusedRep,
    salesMetrics,
    weeklyScorecard,
    revenueBoard,
  };
}

async function loadLeaderboard(
  orgId: string,
  metric: LeaderboardMetric,
  since: Date,
  nameById: Map<string, string>,
  assignableIds: string[],
  currency: string,
) {
  const scores = new Map<string, number>();

  if (metric === "calls") {
    const [contactCalls, dealCalls] = await Promise.all([
      prisma.contactActivity.groupBy({
        by: ["createdByUserId"],
        where: {
          organizationId: orgId,
          type: "call",
          createdAt: { gte: since },
          createdByUserId: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.dealActivity.groupBy({
        by: ["createdByUserId"],
        where: {
          type: "call",
          createdAt: { gte: since },
          createdByUserId: { not: null },
          deal: { organizationId: orgId },
        },
        _count: { _all: true },
      }),
    ]);
    for (const row of [...contactCalls, ...dealCalls]) {
      const id = row.createdByUserId;
      if (!id) continue;
      scores.set(id, (scores.get(id) ?? 0) + row._count._all);
    }
  } else {
    const won = await prisma.deal.groupBy({
      by: ["ownerUserId"],
      where: {
        organizationId: orgId,
        stage: "closed_won",
        closedAt: { gte: since },
        ownerUserId: { not: null },
      },
      _count: { _all: true },
      _sum: { amount: true },
    });
    for (const row of won) {
      const id = row.ownerUserId;
      if (!id) continue;
      const value =
        metric === "revenue"
          ? Number(row._sum.amount ?? 0)
          : row._count._all;
      scores.set(id, value);
    }
  }

  const ids = new Set([...scores.keys(), ...assignableIds]);
  const rows = [...ids]
    .filter((userId) => nameById.has(userId))
    .map((userId) => {
      const value = scores.get(userId) ?? 0;
      return {
        userId,
        name: nameById.get(userId)!,
        value,
        valueLabel:
          metric === "revenue" ? money(value, currency) : String(Math.round(value)),
      };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, 12);

  return rows;
}

async function countLeadsCreatedInPeriod(
  orgId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const leadIds = await findContactIdsByContactType("lead", {
    organizationId: orgId,
  });
  if (leadIds.length === 0) return 0;
  return prisma.contactProfile.count({
    where: {
      organizationId: orgId,
      accountContactId: { in: leadIds },
      createdAt: { gte: start, lt: end },
    },
  });
}

async function loadUntouchedLeads(
  orgId: string,
  thresholdHours: number,
  nameById: Map<string, string>,
) {
  const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);
  const leadIds = await findContactIdsByContactType("lead", {
    organizationId: orgId,
  });
  if (leadIds.length === 0) {
    return { thresholdHours, items: [] };
  }

  const profiles = await prisma.contactProfile.findMany({
    where: {
      organizationId: orgId,
      accountContactId: { in: leadIds },
      leadStatus: { notIn: ["converted", "disqualified"] },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: 40,
    select: {
      accountContactId: true,
      ownerUserId: true,
      updatedAt: true,
    },
  });

  const ids = profiles.map((p) => p.accountContactId);
  const { getPeopleByIds } = await import("@/dao/account/account-repository");
  const people = await getPeopleByIds(ids);
  const byId = new Map(people.map((p) => [p.id, p]));

  const now = Date.now();
  return {
    thresholdHours,
    items: profiles
      .map((p) => {
        const person = byId.get(p.accountContactId);
        if (!person) return null;
        if (
          !hasActionableContactIdentity(
            person.firstName,
            person.lastName,
            person.email,
            person.phone,
          )
        ) {
          return null;
        }
        return {
          id: p.accountContactId,
          displayName: formatContactListLabel(
            person.firstName,
            person.lastName,
            person.email,
            person.phone,
          ),
          email: person.email,
          ownerUserId: p.ownerUserId,
          ownerName: p.ownerUserId
            ? nameById.get(p.ownerUserId) ?? null
            : null,
          updatedAt: p.updatedAt.toISOString(),
          ageHours: Math.max(
            0,
            Math.round((now - p.updatedAt.getTime()) / (60 * 60 * 1000)),
          ),
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      displayName: string;
      email: string;
      ownerUserId: string | null;
      ownerName: string | null;
      updatedAt: string;
      ageHours: number;
    }>,
  };
}

async function loadNeedsReviewLeads(
  orgId: string,
  nameById: Map<string, string>,
): Promise<AdminOpsData["needsReview"]> {
  try {
    const profiles = await prisma.contactProfile.findMany({
      where: {
        organizationId: orgId,
        flaggedForReview: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        accountContactId: true,
        ownerUserId: true,
        flagReason: true,
        lifecycleLastRunAt: true,
        updatedAt: true,
      },
    });

    const ids = profiles.map((p) => p.accountContactId);
    const { getPeopleByIds } = await import("@/dao/account/account-repository");
    const people = await getPeopleByIds(ids);
    const byId = new Map(people.map((p) => [p.id, p]));

    return {
      items: profiles
        .map((p) => {
          const person = byId.get(p.accountContactId);
          if (!person) return null;
          if (
            !hasActionableContactIdentity(
              person.firstName,
              person.lastName,
              person.email,
              person.phone,
            )
          ) {
            return null;
          }
          return {
            id: p.accountContactId,
            displayName: formatContactListLabel(
              person.firstName,
              person.lastName,
              person.email,
              person.phone,
            ),
            email: person.email,
            ownerUserId: p.ownerUserId,
            ownerName: p.ownerUserId
              ? nameById.get(p.ownerUserId) ?? null
              : null,
            reason: p.flagReason,
            flaggedAt:
              (p.lifecycleLastRunAt ?? p.updatedAt)?.toISOString() ?? null,
          };
        })
        .filter(Boolean) as AdminOpsData["needsReview"]["items"],
    };
  } catch {
    return { items: [] };
  }
}

async function loadPipelineSnapshot(
  orgId: string,
): Promise<AdminOpsData["pipelineSnapshot"]> {
  const stageGroups = await prisma.deal.groupBy({
    by: ["stage"],
    where: { organizationId: orgId },
    _count: { _all: true },
  });
  const openDeals = stageGroups
    .filter((g) => g.stage !== "closed_won" && g.stage !== "closed_lost")
    .reduce((s, g) => s + g._count._all, 0);
  const closedWon =
    stageGroups.find((g) => g.stage === "closed_won")?._count._all ?? 0;

  return {
    openDeals: {
      value: String(openDeals),
      hint: "Organization",
      href: "/sales",
    },
    closedWon: {
      value: String(closedWon),
      hint: "All-time closed won",
      href: "/sales",
    },
  };
}

async function loadPeriodMetrics(
  orgId: string,
  period: MetricsPeriod,
  bounds: ReturnType<typeof metricsBounds>,
  currency: string,
): Promise<AdminOpsData["monthlyMetrics"]> {
  const { currentStart, currentEnd, prevStart, prevEnd, title, compareLabel } =
    bounds;
  const [leadsThis, leadsLast, dealsThis, dealsLast, revThis, revLast] =
    await Promise.all([
      countLeadsCreatedInPeriod(orgId, currentStart, currentEnd),
      countLeadsCreatedInPeriod(orgId, prevStart, prevEnd),
      prisma.deal.count({
        where: {
          organizationId: orgId,
          createdAt: { gte: currentStart, lt: currentEnd },
        },
      }),
      prisma.deal.count({
        where: {
          organizationId: orgId,
          createdAt: { gte: prevStart, lt: prevEnd },
        },
      }),
      prisma.deal.aggregate({
        where: closedWonInWindow(orgId, currentStart, currentEnd),
        _sum: { amount: true },
      }),
      prisma.deal.aggregate({
        where: closedWonInWindow(orgId, prevStart, prevEnd),
        _sum: { amount: true },
      }),
    ]);

  const leadsCreated = leadsThis;
  const leadsPrev = leadsLast;
  const dealsCreated = dealsThis;
  const dealsPrev = dealsLast;
  const revenue = Number(revThis._sum.amount ?? 0);
  const revenuePrev = Number(revLast._sum.amount ?? 0);

  return {
    period,
    title,
    compareLabel,
    cards: [
      {
        id: "leads_created",
        label: "Leads created",
        value: String(leadsCreated),
        changePct: pctChange(leadsCreated, leadsPrev),
        href: "/contact?stage=lead",
      },
      {
        id: "deals_created",
        label: "Deals created",
        value: String(dealsCreated),
        changePct: pctChange(dealsCreated, dealsPrev),
        href: "/sales",
      },
      {
        id: "revenue",
        label: "Revenue",
        value: money(revenue, currency),
        changePct: pctChange(revenue, revenuePrev),
        href: "/dashboard?tab=overview",
      },
    ],
  };
}

async function loadActivityFeed(
  orgId: string,
  nameById: Map<string, string>,
) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const activities = await prisma.contactActivity.findMany({
    where: {
      organizationId: orgId,
      dueAt: null,
      createdAt: { gte: startOfDay },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      subject: true,
      contactId: true,
      createdAt: true,
      createdByUserId: true,
    },
  });

  const contactIds = [...new Set(activities.map((a) => a.contactId))];
  const contactNames = new Map<string, string>();
  if (contactIds.length > 0) {
    const { getPeopleByIds } = await import("@/dao/account/account-repository");
    const people = await getPeopleByIds(contactIds);
    for (const person of people) {
      contactNames.set(
        person.id,
        formatContactDisplayName(person.firstName, person.lastName),
      );
    }
  }

  const actorIds = [
    ...new Set(
      activities
        .map((a) => a.createdByUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const extraLabels = await getUserLabelsByIds(
    actorIds.filter((id) => !nameById.has(id)),
  );

  return {
    loggedToday: activities.length,
    repCount: actorIds.length,
    items: activities.slice(0, 8).map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      contactId: a.contactId,
      contactName: contactNames.get(a.contactId) ?? "Contact",
      createdAt: a.createdAt.toISOString(),
      actorName: a.createdByUserId
        ? nameById.get(a.createdByUserId) ??
          extraLabels.get(a.createdByUserId)?.split(" (")[0] ??
          null
        : null,
    })),
  };
}

async function loadTeamDeals(
  orgId: string,
  groupBy: TeamDealGroupBy,
  region: string | null,
  nameById: Map<string, string>,
) {
  const deals = await prisma.deal.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: {
      company: { select: { name: true } },
      location: { select: { city: true, name: true } },
    },
  });

  const regions = [
    ...new Set(
      deals
        .map((d) => d.location.city?.trim())
        .filter((c): c is string => Boolean(c)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const filtered = region
    ? deals.filter(
        (d) => (d.location.city?.trim() || "") === region,
      )
    : deals;

  const open = filtered.filter(
    (d) => d.stage !== "closed_won" && d.stage !== "closed_lost",
  ).length;
  const negotiation = filtered.filter((d) => d.stage === "negotiate").length;
  const closed = filtered.filter(
    (d) => d.stage === "closed_won" || d.stage === "closed_lost",
  ).length;

  const mapped = filtered.map((d) => ({
    id: d.id,
    title: d.title,
    stage: d.stage,
    stageLabel: DEAL_STAGE_LABELS[d.stage] ?? d.stage,
    amount: d.amount?.toString() ?? null,
    companyName: d.company.name,
    region: d.location.city?.trim() || null,
    ownerUserId: d.ownerUserId,
    ownerName: d.ownerUserId
      ? nameById.get(d.ownerUserId) ?? null
      : null,
  }));

  const groups: AdminOpsData["teamDeals"]["groups"] = [];
  if (groupBy === "rep") {
    const byRep = new Map<string, typeof mapped>();
    for (const deal of mapped) {
      const key = deal.ownerUserId ?? "__unassigned";
      const list = byRep.get(key) ?? [];
      list.push(deal);
      byRep.set(key, list);
    }
    for (const [key, list] of byRep) {
      if (key !== "__unassigned" && !nameById.has(key)) continue;
      groups.push({
        id: key,
        label: key === "__unassigned" ? "Unassigned" : nameById.get(key)!,
        deals: list.slice(0, 8),
      });
    }
    groups.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    const stageOrder: DealStage[] = [
      "qualification",
      "discover",
      "propose",
      "negotiate",
      "closed_won",
      "closed_lost",
    ];
    for (const stage of stageOrder) {
      const list = mapped.filter((d) => d.stage === stage);
      if (list.length === 0) continue;
      groups.push({
        id: stage,
        label: DEAL_STAGE_LABELS[stage] ?? stage,
        deals: list.slice(0, 8),
      });
    }
  }

  return {
    groupBy,
    region,
    regions,
    summary: { open, negotiation, closed },
    groups,
  };
}

async function loadFocusedRep(
  orgId: string,
  userId: string,
  since: Date,
  nameById: Map<string, string>,
  currency: string,
) {
  const [stageGroups, calls] = await Promise.all([
    prisma.deal.groupBy({
      by: ["stage"],
      where: { organizationId: orgId, ownerUserId: userId },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.contactActivity.count({
      where: {
        organizationId: orgId,
        type: "call",
        createdByUserId: userId,
        createdAt: { gte: since },
      },
    }),
  ]);

  const openDeals = stageGroups
    .filter((g) => g.stage !== "closed_won" && g.stage !== "closed_lost")
    .reduce((s, g) => s + g._count._all, 0);
  const wonDeals =
    stageGroups.find((g) => g.stage === "closed_won")?._count._all ?? 0;
  const pipelineValue = stageGroups
    .filter((g) => g.stage !== "closed_won" && g.stage !== "closed_lost")
    .reduce((s, g) => s + Number(g._sum.amount ?? 0), 0);

  return {
    userId,
    name: nameById.get(userId) ?? "Rep",
    openDeals,
    wonDeals,
    pipelineValue: money(pipelineValue, currency),
    callsInPeriod: calls,
  };
}
