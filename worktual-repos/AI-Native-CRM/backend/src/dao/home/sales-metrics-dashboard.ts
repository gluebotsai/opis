/**
 * Phase 1 sales analytics — PDF "Sales Dashboard Metrics Reference" → CRM.
 *
 * ## PDF → CRM stage mapping
 * | PDF stage     | CRM `DealStage`                                      |
 * |---------------|------------------------------------------------------|
 * | Discovery     | `discover` (also surface `qualification` as Qualify) |
 * | Demo          | _(no CRM stage — omitted)_                           |
 * | Proposal      | `propose`                                            |
 * | POC           | _(no CRM stage — omitted)_                           |
 * | Negotiation   | `negotiate`                                          |
 * | Pricing       | _(no CRM stage — omitted)_                           |
 * | Won / Lost    | `closed_won` / `closed_lost`                         |
 *
 * ## Probability / weighted pipeline (Phase 1)
 * Deal has no native `probability` field yet. Weighted pipeline and
 * high-probability counts use stage default weights below. Phase 2 should
 * add `Deal.probability` and replace these defaults.
 *
 * ## Tab placement (managers)
 * - Overview hero (§27 KPI Cards): total_opportunities, total_pipeline,
 *   won_revenue, win_rate, sales_velocity
 * - Overview pulse: weighted_pipeline, active_opportunities, new_pipeline_month, …
 * - Pipeline strip: avg_deal_size, avg_probability, high_probability, avg_aging, lost_revenue
 * - Charts (§27 shapes): Overview = StageFunnel + winLoss donut + wonRevenueTrend
 *   area; Pipeline = aging heat strip + deal-size histogram + lost-reason lollipops;
 *   Team = owner ranked bars + leaderboard. (Region / product / industry deferred.)
 *
 * ## Deferred to Phase 2+
 * - Stage conversion rates / dwell / stuck deals (needs stage-entered history)
 * - Forecast accuracy vs prior forecast snapshots
 * - Meeting completed / no-show rates (needs meeting outcome field)
 * - Region / RSM hierarchy, product & industry / lead-source heatmaps
 * - Native Demo/POC/Pricing stages or configurable stage packs
 * - Org-configurable stage weights and deal-size band thresholds
 */

import type { DealStage } from "@prisma/client";
import { dashboardDealSets, dashboardKpiBounds } from "@/dao/home/dashboard-kpi-window";
import { prisma } from "@/dao/db/prisma";
import {
  formatDashboardMoney,
  resolveDashboardCurrency,
} from "@/lib/commercial-currency";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import { DEAL_STAGE_LABELS } from "@/service/sales/stages";
import { getUserLabelsByIds } from "@/service/account/user-directory";

/** Stage → win probability (0–1). Promote to org settings later. */
export const STAGE_PROBABILITY_WEIGHTS: Record<DealStage, number> = {
  qualification: 0.1,
  discover: 0.25,
  propose: 0.5,
  negotiate: 0.75,
  closed_won: 1,
  closed_lost: 0,
};

/** High-probability threshold (PDF ≥75% / KPI card ≥80% — use 0.75). */
const HIGH_PROBABILITY_THRESHOLD = 0.75;

/**
 * Deal-size bands (PDF §23 uses INR lakhs: &lt;5L, 5L–25L, &gt;25L).
 * Absolute amounts in major currency units; promote to org settings later.
 */
const DEAL_SIZE_SMALL_MAX = 500_000;
const DEAL_SIZE_MID_MAX = 2_500_000;

/** Fixed card ID groups for dashboard tabs (frontend should reuse these). */
export const SALES_METRIC_CARD_GROUPS = {
  /** PDF §27 KPI Cards — five across the top. */
  overviewHero: [
    "total_opportunities",
    "total_pipeline",
    "won_revenue",
    "win_rate",
    "sales_velocity",
  ],
  overviewPulse: [
    "weighted_pipeline",
    "active_opportunities",
    "new_pipeline_month",
  ],
  pipelineStrip: [
    "avg_deal_size",
    "avg_probability",
    "high_probability",
    "avg_aging",
    "lost_revenue",
  ],
  repHero: [
    "active_opportunities",
    "total_pipeline",
    "weighted_pipeline",
    "win_rate",
  ],
  repBook: [
    "won_revenue",
    "lost_revenue",
    "sales_velocity",
    "avg_deal_size",
  ],
} as const;

export type SalesMetricsPeriodBounds = {
  currentStart: Date;
  currentEnd: Date;
  prevStart: Date;
  prevEnd: Date;
  /** Display window, for example "Last 30 days". */
  periodLabel?: string;
};

export type SalesMetricCard = {
  id: string;
  label: string;
  value: string;
  hint: string;
  href?: string;
};

export type SalesChartSlice = {
  id: string;
  label: string;
  value: number;
};

export type SalesMetricsData = {
  /** ISO code from accounts.organizations.country. */
  currency: string;
  /** Caption for UI: stage mapping + probability note */
  methodologyNote: string;
  /** Window used for period cards, for example "Last 30 days". */
  periodLabel: string;
  cards: SalesMetricCard[];
  /** Deal counts by CRM stage (incl. closed_won). */
  funnel: SalesChartSlice[];
  /** Open + closed_won deal value by stage (PDF stage value). */
  funnelValue: SalesChartSlice[];
  winLoss: SalesChartSlice[];
  aging: SalesChartSlice[];
  pipelineByOwner: SalesChartSlice[];
  lostReasons: SalesChartSlice[];
  dealSizeBands: SalesChartSlice[];
  /** Last 6 calendar months of closed-won revenue (PDF §27 line chart). */
  wonRevenueTrend: SalesChartSlice[];
  topOpportunities: Array<{
    id: string;
    title: string;
    stage: string;
    stageLabel: string;
    amount: string | null;
    companyName: string;
    ownerName: string | null;
    agingDays: number;
    weightPct: number;
  }>;
};

export type SalesMetricsOptions = {
  organizationId?: string;
  /** When set, metrics are scoped to this deal owner (rep dashboard). */
  ownerUserId?: string;
};

/** Rep dashboards use the same last-30-days UTC window as the reports KPI. */
export function defaultMonthMetricsBounds(
  now = new Date(),
): SalesMetricsPeriodBounds {
  const bounds = dashboardKpiBounds("month", now);
  return {
    currentStart: bounds.currentStart,
    currentEnd: bounds.currentEnd,
    prevStart: bounds.prevStart,
    prevEnd: bounds.prevEnd,
    periodLabel: bounds.shortLabel,
  };
}

function metricWindow(bounds: SalesMetricsPeriodBounds): string {
  const label = bounds.periodLabel?.trim() || "Last 30 days";
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function money(n: number, currency: string): string {
  return formatDashboardMoney(n, currency);
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function amountOf(deal: { amount: { toString(): string } | null }): number {
  if (deal.amount == null) return 0;
  const n = Number(deal.amount);
  return Number.isFinite(n) ? n : 0;
}

/** Last `months` calendar months of closed-won SUM(amount), oldest → newest. */
function buildWonRevenueTrend(
  wonDeals: Array<{
    amount: { toString(): string } | null;
    closedAt: Date | null;
    createdAt: Date;
  }>,
  now: Date,
  months = 6,
): SalesChartSlice[] {
  const slices: SalesChartSlice[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const y = start.getFullYear();
    const m = start.getMonth() + 1;
    const id = `${y}-${String(m).padStart(2, "0")}`;
    const label = start.toLocaleString(undefined, { month: "short" });
    const value = Math.round(
      wonDeals
        .filter((d) => {
          const t = d.closedAt ?? d.createdAt;
          return t >= start && t < end;
        })
        .reduce((s, d) => s + amountOf(d), 0),
    );
    slices.push({ id, label, value });
  }
  return slices;
}

export async function getSalesMetricsDashboard(
  bounds: SalesMetricsPeriodBounds,
  organizationIdOrOptions?: string | SalesMetricsOptions,
): Promise<SalesMetricsData> {
  const options: SalesMetricsOptions =
    typeof organizationIdOrOptions === "string" ||
    organizationIdOrOptions === undefined
      ? { organizationId: organizationIdOrOptions }
      : organizationIdOrOptions;

  const orgId =
    options.organizationId ?? (await getCurrentOrganizationId());
  const currency = await resolveDashboardCurrency(orgId);
  const asOf = new Date();

  const deals = await prisma.deal.findMany({
    where: {
      organizationId: orgId,
      ...(options.ownerUserId
        ? { ownerUserId: options.ownerUserId }
        : {}),
    },
    select: {
      id: true,
      title: true,
      stage: true,
      amount: true,
      lostReason: true,
      ownerUserId: true,
      createdAt: true,
      closedAt: true,
      expectedCloseDate: true,
      company: { select: { name: true } },
    },
  });

  const ownerIds = [
    ...new Set(
      deals.map((d) => d.ownerUserId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const ownerLabels = await getUserLabelsByIds(ownerIds);

  const won = deals.filter((d) => d.stage === "closed_won");
  const lost = deals.filter((d) => d.stage === "closed_lost");
  const sets = dashboardDealSets(deals, bounds);
  const createdInPeriod = sets.created;
  const openCreated = sets.openCreated;
  const wonInPeriod = sets.wonClosed;
  const lostInPeriod = sets.lostClosed;
  const openByCloseTs = sets.openByCloseTs;

  const totalOpportunities = createdInPeriod.length;
  const activeOpportunities = openCreated.length;
  const totalPipeline = openCreated.reduce((s, d) => s + amountOf(d), 0);
  const weightedPipeline = openCreated.reduce((s, d) => {
    const w = STAGE_PROBABILITY_WEIGHTS[d.stage] ?? 0;
    return s + amountOf(d) * w;
  }, 0);
  const wonRevenueAll = won.reduce((s, d) => s + amountOf(d), 0);
  const lostRevenueAll = lost.reduce((s, d) => s + amountOf(d), 0);
  const wonRevenuePeriod = wonInPeriod.reduce((s, d) => s + amountOf(d), 0);
  const lostRevenuePeriod = lostInPeriod.reduce((s, d) => s + amountOf(d), 0);

  const closedDecided = wonInPeriod.length + lostInPeriod.length;
  const winRate =
    closedDecided > 0 ? (wonInPeriod.length / closedDecided) * 100 : 0;

  const avgDealSize =
    activeOpportunities > 0 ? totalPipeline / activeOpportunities : 0;

  const agingDays = openCreated.map((d) => daysBetween(d.createdAt, asOf));
  const avgAging =
    agingDays.length > 0
      ? agingDays.reduce((a, b) => a + b, 0) / agingDays.length
      : 0;

  const highProbCount = openCreated.filter(
    (d) => (STAGE_PROBABILITY_WEIGHTS[d.stage] ?? 0) >= HIGH_PROBABILITY_THRESHOLD,
  ).length;

  const monthStart = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const newPipelineThisMonth = deals
    .filter((d) => d.createdAt >= monthStart && d.createdAt < asOf)
    .reduce((s, d) => s + amountOf(d), 0);

  // Sales velocity (PDF): (Opps × WinRate × AvgDeal) ÷ AvgSalesCycle
  const cycleSamples = wonInPeriod
    .map((d) => {
      const end = d.closedAt ?? d.createdAt;
      return daysBetween(d.createdAt, end);
    })
    .filter((n) => n > 0);
  const avgCycleDays =
    cycleSamples.length > 0
      ? cycleSamples.reduce((a, b) => a + b, 0) / cycleSamples.length
      : 0;
  const velocityActive = openByCloseTs.length;
  const velocityPipeline = openByCloseTs.reduce((s, d) => s + amountOf(d), 0);
  const velocityAvgDeal =
    velocityActive > 0 ? velocityPipeline / velocityActive : 0;
  const velocityWinRate = winRate / 100;
  const salesVelocity =
    avgCycleDays > 0 && velocityActive > 0
      ? (velocityActive * velocityWinRate * velocityAvgDeal) / avgCycleDays
      : 0;

  const avgProbability =
    openCreated.length > 0
      ? (openCreated.reduce(
          (s, d) => s + (STAGE_PROBABILITY_WEIGHTS[d.stage] ?? 0),
          0,
        ) /
          openCreated.length) *
        100
      : 0;

  const window = metricWindow(bounds);
  const cards: SalesMetricCard[] = [
    {
      id: "total_opportunities",
      label: "Total opportunities",
      value: String(totalOpportunities),
      hint: `Created · ${window}`,
      href: "/sales",
    },
    {
      id: "active_opportunities",
      label: options.ownerUserId ? "My open deals" : "Active opportunities",
      value: String(activeOpportunities),
      hint: `Still open · ${window}`,
      href: "/sales",
    },
    {
      id: "total_pipeline",
      label: options.ownerUserId ? "My pipeline" : "Total pipeline",
      value: money(totalPipeline, currency),
      hint: `Open value · ${window}`,
      href: "/sales",
    },
    {
      id: "weighted_pipeline",
      label: options.ownerUserId ? "My weighted pipeline" : "Weighted pipeline",
      value: money(weightedPipeline, currency),
      hint: `Stage-weighted value · ${window}`,
      href: "/sales",
    },
    {
      id: "won_revenue",
      label: "Won revenue",
      value: money(wonRevenuePeriod, currency),
      hint: `Closed won · ${window}`,
      href: "/sales",
    },
    {
      id: "lost_revenue",
      label: "Lost revenue",
      value: money(lostRevenuePeriod, currency),
      hint: `Closed lost · ${window}`,
      href: "/sales",
    },
    {
      id: "win_rate",
      label: "Win rate",
      value: `${winRate.toFixed(1)}%`,
      hint: `Closed deals won · ${window}`,
      href: "/sales",
    },
    {
      id: "avg_deal_size",
      label: "Average deal size",
      value: money(avgDealSize, currency),
      hint: `Open deals · ${window}`,
      href: "/sales",
    },
    {
      id: "avg_probability",
      label: "Average probability",
      value: `${avgProbability.toFixed(0)}%`,
      hint: `Open deals · ${window}`,
      href: "/sales",
    },
    {
      id: "avg_aging",
      label: "Average aging",
      value: `${Math.round(avgAging)} days`,
      hint: `Days open · ${window}`,
      href: "/sales",
    },
    {
      id: "high_probability",
      label: "High probability deals",
      value: String(highProbCount),
      hint: `Stage weight 75%+ · ${window}`,
      href: "/sales",
    },
    {
      id: "new_pipeline_month",
      label: "New pipeline this month",
      value: money(newPipelineThisMonth, currency),
      hint: "Created this month",
      href: "/sales",
    },
    {
      id: "sales_velocity",
      label: "Sales velocity",
      value:
        salesVelocity > 0
          ? `${money(salesVelocity, currency)}/day`
          : `${money(0, currency)}/day`,
      hint: "Expected revenue per day",
      href: "/sales",
    },
    {
      id: "won_revenue_all_time",
      label: "Won revenue (all-time)",
      value: money(wonRevenueAll, currency),
      hint: "All closed won",
      href: "/sales",
    },
    {
      id: "lost_revenue_all_time",
      label: "Lost revenue (all-time)",
      value: money(lostRevenueAll, currency),
      hint: "All closed lost",
      href: "/sales",
    },
  ];

  const funnelStages: DealStage[] = [
    "qualification",
    "discover",
    "propose",
    "negotiate",
    "closed_won",
  ];
  const funnel: SalesChartSlice[] = funnelStages.map((stage) => ({
    id: stage,
    label: DEAL_STAGE_LABELS[stage],
    value: createdInPeriod.filter((d) => d.stage === stage).length,
  }));
  const funnelValue: SalesChartSlice[] = funnelStages.map((stage) => ({
    id: stage,
    label: DEAL_STAGE_LABELS[stage],
    value: Math.round(
      createdInPeriod
        .filter((d) => d.stage === stage)
        .reduce((s, d) => s + amountOf(d), 0),
    ),
  }));

  const winLoss: SalesChartSlice[] = [
    { id: "won", label: "Won", value: wonInPeriod.length },
    { id: "lost", label: "Lost", value: lostInPeriod.length },
  ];

  const agingBuckets = [
    { id: "0_30", label: "0–30", min: 0, max: 30 },
    { id: "31_60", label: "31–60", min: 31, max: 60 },
    { id: "61_90", label: "61–90", min: 61, max: 90 },
    { id: "90_plus", label: "90+", min: 91, max: Number.POSITIVE_INFINITY },
  ];
  const aging: SalesChartSlice[] = agingBuckets.map((b) => ({
    id: b.id,
    label: b.label,
    value: agingDays.filter((d) => d >= b.min && d <= b.max).length,
  }));

  const pipelineByOwnerMap = new Map<string, number>();
  for (const d of openCreated) {
    const key = d.ownerUserId ?? "__unassigned__";
    pipelineByOwnerMap.set(key, (pipelineByOwnerMap.get(key) ?? 0) + amountOf(d));
  }
  const pipelineByOwner: SalesChartSlice[] = [...pipelineByOwnerMap.entries()]
    .filter(([id]) => id === "__unassigned__" || ownerLabels.has(id))
    .map(([id, value]) => ({
      id,
      label:
        id === "__unassigned__" ? "Unassigned" : ownerLabels.get(id)!,
      value: Math.round(value),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const lostReasonMap = new Map<string, number>();
  for (const d of lostInPeriod) {
    const reason = d.lostReason?.trim() || "Unspecified";
    lostReasonMap.set(reason, (lostReasonMap.get(reason) ?? 0) + 1);
  }
  const lostReasons: SalesChartSlice[] = [...lostReasonMap.entries()]
    .map(([label, value]) => ({
      id: label.toLowerCase().replace(/\s+/g, "_"),
      label,
      value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const dealSizeBands: SalesChartSlice[] = [
    {
      id: "small",
      label: "Small",
      value: openCreated.filter((d) => amountOf(d) < DEAL_SIZE_SMALL_MAX).length,
    },
    {
      id: "mid",
      label: "Mid",
      value: openCreated.filter((d) => {
        const a = amountOf(d);
        return a >= DEAL_SIZE_SMALL_MAX && a <= DEAL_SIZE_MID_MAX;
      }).length,
    },
    {
      id: "large",
      label: "Large",
      value: openCreated.filter((d) => amountOf(d) > DEAL_SIZE_MID_MAX).length,
    },
  ];

  const topOpportunities = [...openCreated]
    .sort((a, b) => amountOf(b) - amountOf(a))
    .slice(0, 10)
    .map((d) => {
      const w = STAGE_PROBABILITY_WEIGHTS[d.stage] ?? 0;
      return {
        id: d.id,
        title: d.title,
        stage: d.stage,
        stageLabel: DEAL_STAGE_LABELS[d.stage],
        amount: d.amount != null ? money(amountOf(d), currency) : null,
        companyName: d.company.name,
        ownerName: d.ownerUserId
          ? (ownerLabels.get(d.ownerUserId) ?? null)
          : null,
        agingDays: daysBetween(d.createdAt, asOf),
        weightPct: Math.round(w * 100),
      };
    });

  const wonRevenueTrend = buildWonRevenueTrend(won, asOf, 6);

  return {
    currency,
    periodLabel: bounds.periodLabel?.trim() || "Last 30 days",
    methodologyNote:
      "Weighted pipeline uses the default probability for each stage.",
    cards,
    funnel,
    funnelValue,
    winLoss,
    aging,
    pipelineByOwner,
    lostReasons,
    dealSizeBands,
    wonRevenueTrend,
    topOpportunities,
  };
}
