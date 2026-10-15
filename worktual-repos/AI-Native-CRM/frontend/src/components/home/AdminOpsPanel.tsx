import { Link } from "react-router-dom";
import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  Handshake,
  Target,
  TrendingUp,
  Users,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import {
  KPI_ICON_TONES,
  REPORT_SURFACE_CLASS,
  ReportChartCard,
  ReportKpiCard,
  ReportsHeader,
} from "@/components/home/ReportDashboardLayout";
import {
  WorktualDashboardPanel,
  WorktualHeaderCopy,
  WorktualKpiGrid,
  WorktualLineTabs,
  WorktualTableShell,
  worktualTableClass,
  worktualTableHeadClass,
  worktualTableRowClass,
  WORKTUAL_CHART_CARD,
  type WorktualWorkspaceHeaderState,
} from "@/components/home/worktual-dashboard-shell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import { ActivityTypeBadge } from "@/lib/activity-type-style";
import { formatMoney, formatMoneyFull } from "@/lib/deal-stages";
import {
  AgingHeatStrip,
  DealSizeHistogram,
  LollipopBars,
  OutcomeDonut,
  StageFunnel,
  WonRevenueLine,
} from "@/components/home/sales-charts";
import type {
  AdminOpsData,
  ChartSlice,
  DashboardAnalyticsData,
  SalesWeeklyScorecardData,
  ScorecardRowStatus,
} from "@/services/home";
import { reassignDeal } from "@/services/home";
import { SECTION_H2_CLASS, TONE_DANGER, TONE_NEUTRAL, TONE_SUCCESS, TONE_WARNING } from "@/lib/ui-tones";
import { DashboardAnalyticsPanel } from "@/components/home/DashboardAnalyticsPanel";
import {
  CompanyRevenueSection,
  RepRevenueSection,
} from "@/components/home/RevenueBoardPanels";
import { DropdownSelect } from "@/components/ui/DropdownSelect";

type DashTab = "overview" | "pipeline" | "team" | "scorecard";

const LEADERBOARD_METRIC_OPTIONS = [
  { value: "deals_closed", label: "Deals closed" },
  { value: "revenue", label: "Won revenue" },
  { value: "calls", label: "Calls made" },
];

const LEADERBOARD_PERIOD_OPTIONS = [
  { value: "all_time", label: "All time" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
];

const UNTOUCHED_THRESHOLD_OPTIONS = [
  { value: "6", label: "6h" },
  { value: "12", label: "12h" },
  { value: "24", label: "24h" },
  { value: "48", label: "48h" },
  { value: "72", label: "72h" },
  { value: "168", label: "7d" },
];

const TEAM_DEALS_GROUP_OPTIONS = [
  { value: "stage", label: "By stage" },
  { value: "rep", label: "By rep" },
];

const TAB_ITEMS: Array<{ id: DashTab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Target },
  { id: "pipeline", label: "Pipeline", icon: BarChart3 },
  { id: "team", label: "Team", icon: Users },
  { id: "scorecard", label: "Scorecard", icon: ClipboardList },
];

const SCORECARD_TZ_OPTIONS = [
  { value: "UTC", label: "UTC" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
  { value: "America/New_York", label: "America/New York (ET)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
];

/** PDF §27 KPI Cards — five across the top. */
const OVERVIEW_HERO = [
  "total_opportunities",
  "total_pipeline",
  "won_revenue",
  "win_rate",
  "sales_velocity",
] as const;
const OVERVIEW_PULSE = [
  "weighted_pipeline",
  "active_opportunities",
  "new_pipeline_month",
] as const;
const PIPELINE_STRIP = [
  "avg_deal_size",
  "avg_probability",
  "high_probability",
  "avg_aging",
  "lost_revenue",
] as const;

export function AdminOpsPanel({
  data,
  analytics,
  pending,
  onParam,
  onRefresh,
  onRefreshAnalytics,
  analyticsRefreshing,
  analyticsMessage,
  analyticsError,
  onHeaderActionsChange,
}: {
  data: AdminOpsData;
  analytics: DashboardAnalyticsData;
  pending?: boolean;
  onParam: (key: string, value: string | null) => void;
  onRefresh: () => void;
  onRefreshAnalytics?: () => void;
  analyticsRefreshing?: boolean;
  analyticsMessage?: string | null;
  analyticsError?: string | null;
  onHeaderActionsChange?: (header: WorktualWorkspaceHeaderState | null) => void;
}) {
  const busy = Boolean(pending);
  const [tab, setTab] = useState<DashTab>("overview");

  const workspaceHeader = useMemo((): WorktualWorkspaceHeaderState => {
    const actions =
      tab === "overview" ? (
        <ReportsHeader
          period={data.monthlyMetrics.period}
          busy={busy}
          onPeriodChange={(value) => onParam("metricsPeriod", value)}
          onViewAnalytics={onRefreshAnalytics}
          analyticsRefreshing={analyticsRefreshing}
        />
      ) : undefined;

    return {
      leading: (
        <WorktualHeaderCopy
          title="Reports"
          subtitle={MODULE_WORKSPACE_DESCRIPTION.reports}
        />
      ),
      actions,
    };
  }, [
    tab,
    data.monthlyMetrics.period,
    busy,
    onParam,
    onRefreshAnalytics,
    analyticsRefreshing,
  ]);

  useEffect(() => {
    onHeaderActionsChange?.(workspaceHeader);
    return () => onHeaderActionsChange?.(null);
  }, [onHeaderActionsChange, workspaceHeader]);

  return (
    <div className="@container space-y-4">
      {data.focusedRep ? (
        <FocusedRepBanner
          rep={data.focusedRep}
          onBack={() => onParam("repId", null)}
        />
      ) : null}

      <WorktualDashboardPanel
        busy={busy}
        tabs={
          <WorktualLineTabs
            tabs={TAB_ITEMS}
            active={tab}
            onChange={setTab}
            ariaLabel="Dashboard sections"
          />
        }
      >
        {tab === "overview" ? (
          <OverviewTab
            data={data}
            onRefreshAnalytics={onRefreshAnalytics}
            analyticsMessage={analyticsMessage}
            analyticsError={analyticsError}
          />
        ) : null}
        {tab === "pipeline" ? (
          <PipelineTab data={data.salesMetrics} />
        ) : null}
        {tab === "team" ? (
          <TeamTab
            data={data}
            analytics={analytics}
            pending={busy}
            onParam={onParam}
            onRefresh={onRefresh}
          />
        ) : null}
        {tab === "scorecard" ? (
          <ScorecardTab
            scorecard={data.weeklyScorecard}
            pending={busy}
            onParam={onParam}
          />
        ) : null}
      </WorktualDashboardPanel>
    </div>
  );
}

function scorecardStatusTone(status: ScorecardRowStatus): string {
  if (status === "ahead") return TONE_SUCCESS;
  if (status === "behind") return TONE_DANGER;
  return TONE_WARNING;
}

function scorecardStatusLabel(status: ScorecardRowStatus): string {
  if (status === "ahead") return "Ahead";
  if (status === "behind") return "Behind";
  return "On track";
}

function ScorecardTab({
  scorecard,
  pending,
  onParam,
}: {
  scorecard: SalesWeeklyScorecardData;
  pending: boolean;
  onParam: (key: string, value: string | null) => void;
}) {
  const weekOffset =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("scorecardWeek") ?? "0"
      : "0";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">{scorecard.weekLabel}</p>
        <div className="flex flex-wrap gap-2">
          <DropdownSelect
            value={weekOffset === "-1" ? "-1" : "0"}
            options={[
              { value: "0", label: "This week" },
              { value: "-1", label: "Previous week" },
            ]}
            disabled={pending}
            size="sm"
            onChange={(value) => onParam("scorecardWeek", value === "0" ? null : value)}
            aria-label="Scorecard week"
          />
          <DropdownSelect
            value={scorecard.region ?? ""}
            options={[
              { value: "", label: "All regions" },
              ...scorecard.regions.map((region) => ({
                value: region,
                label: region,
              })),
            ]}
            disabled={pending}
            size="sm"
            onChange={(value) => onParam("region", value || null)}
            aria-label="Filter scorecard by region"
          />
          <DropdownSelect
            value={scorecard.timeZone}
            options={SCORECARD_TZ_OPTIONS}
            disabled={pending}
            size="sm"
            onChange={(value) =>
              onParam("scorecardTz", value === "UTC" ? null : value)
            }
            aria-label="Scorecard timezone"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ReportKpiCard
            label="Quotes sent"
            value={`${scorecard.quoteScorecard.orgTotal.achieved} / ${scorecard.quoteScorecard.orgTotal.target}`}
            hint={`Target ${scorecard.quoteScorecard.targetPerWeek} per BDM/week`}
            icon={Target}
            iconClassName={KPI_ICON_TONES[0]}
          />
          <ReportKpiCard
            label="SQM conducted"
            value={`${scorecard.sqmScorecard.orgTotal.achieved} / ${scorecard.sqmScorecard.orgTotal.target}`}
            hint={`Target ${scorecard.sqmScorecard.targetPerWeek} per SDR/week`}
            icon={Users}
            iconClassName={KPI_ICON_TONES[1]}
          />
          <ReportKpiCard
            label="Open proposals"
            value={String(scorecard.proposalPipeline.rows.length)}
            hint="Still open"
            icon={ClipboardList}
            iconClassName={KPI_ICON_TONES[2]}
          />
          <ReportKpiCard
            label="Reps behind"
            value={String(scorecard.repsBehindCount)}
            hint="Below weekly pace"
            icon={AlertTriangle}
            iconClassName={
              scorecard.repsBehindCount > 0
                ? KPI_ICON_TONES[4]
                : KPI_ICON_TONES[1]
            }
          />
      </div>

      <ScorecardTable
        title="Weekly quote scorecard"
        subtitle="Quotes sent this week"
        columns={["Rep", "Tier", "Target", "Achieved", "Gap"]}
        emptyMessage="No BDM-track reps configured. Set seniority tiers in Configuration → Sales assignment."
        rows={scorecard.quoteScorecard.rows.map((row) => ({
          key: row.userId,
          cells: [
            row.name,
            row.seniorityTier?.replace(/_/g, " ") ?? "—",
            String(row.target),
            String(row.achieved),
            String(row.gap),
          ],
          status: row.status,
        }))}
      />

      <ScorecardTable
        title="Weekly SQM scorecard"
        subtitle="Meetings completed this week"
        columns={["Rep", "Target", "Achieved", "Gap"]}
        emptyMessage="No SDR-track (junior tier) reps in this org."
        rows={scorecard.sqmScorecard.rows.map((row) => ({
          key: row.userId,
          cells: [
            row.name,
            String(row.target),
            String(row.achieved),
            String(row.gap),
          ],
          status: row.status,
        }))}
      />

      <WorktualTableShell
        title="Proposal pipeline"
        subtitle="Open proposals"
      >
        {scorecard.proposalPipeline.rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No open proposals.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={worktualTableClass()}>
              <thead>
                <tr className={worktualTableHeadClass()}>
                  <th className="px-3 py-2">Region</th>
                  <th className="px-3 py-2">BDM</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Expected close</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {scorecard.proposalPipeline.rows.map((row) => (
                  <tr key={row.proposalId} className={worktualTableRowClass()}>
                    <td className="px-3 py-2.5 text-text-secondary">
                      {row.region ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">{row.bdmName ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className="block font-medium text-text-primary">
                        {row.customerName}
                      </span>
                      <span className="block text-xs text-text-caption">
                        {row.proposalNumber}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="capitalize">{row.status}</span>
                      {row.approvalStatus !== "drafting" ? (
                        <span className="block text-xs text-text-caption">
                          {row.approvalStatus}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">{row.value ?? "—"}</td>
                    <td className="px-3 py-2.5">{row.expectedClose ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        to={row.href}
                        className="inline-flex items-center gap-1 text-sm font-medium text-text-link hover:underline"
                      >
                        View
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WorktualTableShell>

      {scorecard.limitations.length > 0 ? (
        <p className="text-xs text-neutral-500">
          {scorecard.limitations.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

function ScorecardTable({
  title,
  subtitle,
  columns,
  rows,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  columns: string[];
  emptyMessage: string;
  rows: Array<{
    key: string;
    cells: string[];
    status: ScorecardRowStatus;
  }>;
}) {
  return (
    <WorktualTableShell title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">{emptyMessage}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={worktualTableClass()}>
            <thead>
              <tr className={worktualTableHeadClass()}>
                {columns.map((col) => (
                  <th key={col} className="px-3 py-2">
                    {col}
                  </th>
                ))}
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={worktualTableRowClass()}>
                  {row.cells.map((cell, i) => (
                    <td key={i} className="px-3 py-2.5">
                      {cell}
                    </td>
                  ))}
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${scorecardStatusTone(row.status)}`}
                    >
                      {scorecardStatusLabel(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WorktualTableShell>
  );
}

function metricPeriod(label: string | undefined): string {
  const text = label?.trim() || "Last 30 days";
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function OverviewTab({
  data,
  onRefreshAnalytics,
  analyticsMessage,
  analyticsError,
}: {
  data: AdminOpsData;
  onRefreshAnalytics?: () => void;
  analyticsMessage?: string | null;
  analyticsError?: string | null;
}) {
  const sales = data.salesMetrics;
  const period = metricPeriod(sales?.periodLabel);
  const byId = new Map((sales?.cards ?? []).map((c) => [c.id, c]));
  const attentionCount = data.untouchedLeads.items.length;
  const reviewCount = data.needsReview?.items.length ?? 0;
  const reviewItems = data.needsReview?.items ?? [];
  const wonRevenueTotal =
    sales?.wonRevenueTrend?.reduce((sum, slice) => sum + slice.value, 0) ?? 0;
  const wonRevenueHeadline = formatMoney(
    String(wonRevenueTotal),
    sales?.currency || "USD",
  );

  const overviewKpis: Array<{
    id: string;
    label: string;
    value: string;
    hint: string;
    href?: string;
    icon: LucideIcon;
    changePct?: number | null;
  }> = [
    {
      id: "total_pipeline",
      label: "Total pipeline",
      value: byId.get("total_pipeline")?.value ?? "—",
      hint: byId.get("total_pipeline")?.hint ?? `Open value · ${period}`,
      href: byId.get("total_pipeline")?.href ?? "/sales",
      icon: Handshake,
    },
    {
      id: "won_revenue",
      label: "Won revenue",
      value: byId.get("won_revenue")?.value ?? "—",
      hint: byId.get("won_revenue")?.hint ?? `Closed won · ${period}`,
      href: byId.get("won_revenue")?.href ?? "/sales",
      icon: TrendingUp,
    },
    {
      id: "win_rate",
      label: "Win rate",
      value: byId.get("win_rate")?.value ?? "—",
      hint: byId.get("win_rate")?.hint ?? `Closed deals won · ${period}`,
      href: byId.get("win_rate")?.href ?? "/sales",
      icon: Target,
    },
    {
      id: "open_deals",
      label: "Open deals",
      value: byId.get("active_opportunities")?.value ?? "—",
      hint:
        byId.get("active_opportunities")?.hint ?? `Still open · ${period}`,
      href: byId.get("active_opportunities")?.href ?? "/sales",
      icon: BarChart3,
    },
    {
      id: "weighted_pipeline",
      label: "Weighted pipeline",
      value: byId.get("weighted_pipeline")?.value ?? "—",
      hint:
        byId.get("weighted_pipeline")?.hint ??
        `Stage-weighted value · ${period}`,
      href: byId.get("weighted_pipeline")?.href ?? "/sales",
      icon: Activity,
    },
    {
      id: "sales_velocity",
      label: "Sales velocity",
      value: byId.get("sales_velocity")?.value ?? "—",
      hint: byId.get("sales_velocity")?.hint ?? "Expected revenue per day",
      href: byId.get("sales_velocity")?.href ?? "/sales",
      icon: Users,
    },
  ];

  const activityCards = data.monthlyMetrics.cards.filter(
    (card) => card.id !== "revenue",
  );

  return (
    <div className="space-y-6">
      <WorktualKpiGrid layout="rows-3-3-2">
        {overviewKpis.map((card, index) => (
          <ReportKpiCard
            key={card.id}
            label={card.label}
            value={card.value}
            hint={card.hint}
            href={card.href}
            icon={card.icon}
            iconClassName={KPI_ICON_TONES[index % KPI_ICON_TONES.length]}
          />
        ))}
        {activityCards.map((card, index) => (
          <ReportKpiCard
            key={card.id}
            label={card.label}
            value={card.value}
            href={card.href}
            icon={[Activity, Handshake, TrendingUp][index] ?? Activity}
            iconClassName={KPI_ICON_TONES[(index + 6) % KPI_ICON_TONES.length]}
            hint={
              card.id === "leads_created"
                ? `New leads · ${period}`
                : `New deals · ${period}`
            }
            changePct={card.changePct}
            compareLabel={data.monthlyMetrics.compareLabel}
          />
        ))}
      </WorktualKpiGrid>

      {data.revenueBoard ? (
        <CompanyRevenueSection board={data.revenueBoard} />
      ) : null}

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ReportChartCard
            title="Won revenue trend"
            subtitle="Last 6 months"
            headline={wonRevenueHeadline}
          >
            <WonRevenueLine
              slices={sales?.wonRevenueTrend ?? []}
              height={220}
              variant="reports"
              formatValue={(n) =>
                formatMoney(String(n), sales?.currency || "USD")
              }
            />
          </ReportChartCard>
          <ReportChartCard
            title="Won vs lost"
            subtitle={`Closed · ${period}`}
          headline={
            sales?.winLoss?.find((s) => s.id === "won")?.value != null
              ? String(sales.winLoss.find((s) => s.id === "won")!.value)
              : undefined
          }
        >
          <OutcomeDonut slices={sales?.winLoss ?? []} />
        </ReportChartCard>
        </div>
      </div>

      <ReportChartCard
        title="Pipeline by stage"
        subtitle={`Created · ${period}`}
      >
        <StageFunnel slices={sales?.funnel ?? []} />
      </ReportChartCard>

      <div className="grid grid-cols-1 gap-4 @[64rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ReportChartCard
          title="Top opportunities"
          subtitle={`Largest open deals · ${period}`}
        >
          <TopOpportunitiesList rows={sales?.topOpportunities ?? []} />
        </ReportChartCard>
        <section className={`flex min-h-0 min-w-0 flex-col ${WORKTUAL_CHART_CARD}`}>
          <SectionHead
            title="Needs attention"
            subtitle={
              reviewCount + attentionCount > 0
                ? `${reviewCount} need review · ${attentionCount} untouched`
                : "All leads look healthy"
            }
            action={
              <Link
                to="/contact?stage=lead"
                className="inline-flex items-center gap-1 text-sm font-medium text-text-secondary hover:text-text-primary"
              >
                Leads
                <ArrowUpRight className="size-3.5" />
              </Link>
            }
          />
          {reviewCount + attentionCount === 0 ? (
            <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-lg bg-subtle/70 px-4 py-6 text-center">
              <span
                className={`inline-flex size-10 items-center justify-center rounded-md ${TONE_SUCCESS}`}
              >
                <Target className="size-5" strokeWidth={1.75} />
              </span>
              <p className="mt-3 text-sm font-medium text-text-primary">
                Nothing urgent
              </p>
              <p className="mt-1 text-xs text-text-caption">
                No flagged reviews or leads past your age threshold.
              </p>
            </div>
          ) : (
            <ul className="scrollbar-always mt-4 max-h-[18.75rem] space-y-3 overflow-y-scroll pr-3 [scrollbar-gutter:stable]">
              {reviewItems.map((lead) => (
                <li key={`review-${lead.id}`}>
                  <Link
                    to={`/contact/${lead.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border-[0.6px] border-[#bfbfbf] px-3 py-2.5 transition-colors hover:bg-subtle/80"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-primary">
                        {lead.displayName}
                      </span>
                      <span className="block truncate text-xs text-text-caption">
                        {lead.reason?.slice(0, 80) ||
                          lead.ownerName ||
                          "Needs review"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${TONE_NEUTRAL}`}
                    >
                      Review
                    </span>
                  </Link>
                </li>
              ))}
              {data.untouchedLeads.items.map((lead) => (
                <li key={lead.id}>
                  <Link
                    to={`/contact/${lead.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border-[0.6px] border-[#bfbfbf] px-3 py-2.5 transition-colors hover:bg-subtle/80"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-primary">
                        {lead.displayName}
                      </span>
                      <span className="block truncate text-xs text-text-caption">
                        {lead.ownerName ?? "Unassigned"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${TONE_WARNING}`}
                    >
                      {lead.ageHours}h
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {(analyticsMessage || analyticsError) && onRefreshAnalytics ? (
        <p
          className={`text-sm ${analyticsError ? "text-red-600" : "text-neutral-500"}`}
        >
          {analyticsError ?? analyticsMessage}
        </p>
      ) : null}
    </div>
  );
}

function PipelineTab({
  data,
}: {
  data: AdminOpsData["salesMetrics"] | null | undefined;
}) {
  if (!data) {
    return (
      <EmptyPanel message="Sales analytics aren’t available for this workspace yet." />
    );
  }

  const period = metricPeriod(data.periodLabel);
  const byId = new Map(data.cards.map((c) => [c.id, c]));
  const strip = PIPELINE_STRIP.map((id) => byId.get(id)).filter(Boolean) as typeof data.cards;
  const shownIds = new Set<string>([
    ...OVERVIEW_HERO,
    ...OVERVIEW_PULSE,
    ...PIPELINE_STRIP,
  ]);
  const extras = data.cards.filter((c) => !shownIds.has(c.id));

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-caption">{data.methodologyNote}</p>

      <div className="grid items-stretch gap-3 grid-cols-1 @sm:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5">
        {strip.map((card) => (
          <div
            key={card.id}
            className="flex h-full flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3.5"
          >
            <p className="text-xs font-medium text-text-caption">{card.label}</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight text-text-primary">
              {card.value}
            </p>
            <p className="mt-1 line-clamp-1 text-xs text-text-caption">
              {card.hint}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="w-full min-w-0 lg:flex-1">
        <Panel title="Aging" subtitle={`Days open · ${period}`}>
          <AgingHeatStrip slices={data.aging} />
        </Panel>
        </div>
        <div className="w-full min-w-0 lg:flex-1">
        <Panel title="Deal size" subtitle={`Open deals · ${period}`}>
          <DealSizeHistogram slices={data.dealSizeBands} />
        </Panel>
        </div>
      </div>

      <Panel title="Lost reasons" subtitle={`Closed lost · ${period}`}>
        <LollipopBars slices={data.lostReasons} tone="danger" />
      </Panel>

      {extras.length > 0 ? (
        <details className="group rounded-xl border-[0.6px] border-[#bfbfbf] bg-white open:pb-4">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-text-secondary marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2 group-open:text-text-primary">
              More metrics
              <span className="text-xs font-normal text-text-caption">
                ({extras.length})
              </span>
            </span>
          </summary>
          <div className="grid grid-cols-1 gap-3 px-5 @sm:grid-cols-2 @2xl:grid-cols-4">
            {extras.map((card) => (
              <div
                key={card.id}
                className="rounded-lg bg-subtle/60 px-4 py-3"
              >
                <p className="text-xs text-text-caption">{card.label}</p>
                <p className="mt-1 text-lg font-semibold text-text-primary">
                  {card.value}
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function TeamTab({
  data,
  analytics,
  pending,
  onParam,
  onRefresh,
}: {
  data: AdminOpsData;
  analytics: DashboardAnalyticsData;
  pending: boolean;
  onParam: (key: string, value: string | null) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-4">
      <TeamPerformanceCard
        pipelineByOwner={data.salesMetrics?.pipelineByOwner ?? []}
        periodLabel={data.salesMetrics?.periodLabel}
        currency={data.salesMetrics?.currency || "USD"}
        focusedRep={data.focusedRep}
        onRep={(id) => onParam("repId", id)}
        onClearRep={() => onParam("repId", null)}
      />

      {data.revenueBoard ? (
        <RepRevenueSection board={data.revenueBoard} />
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="w-full min-w-0 lg:flex-1">
        <LeaderboardCard
          data={data.leaderboard}
          pending={pending}
          onMetric={(m) => onParam("lbMetric", m)}
          onPeriod={(p) => onParam("lbPeriod", p)}
          onRep={(id) => onParam("repId", id)}
        />
        </div>
        <div className="w-full min-w-0 lg:flex-1">
        <ActivityFeedCard feed={data.activityFeed} />
        </div>
      </div>

      <UntouchedLeadsCard
        data={data.untouchedLeads}
        pending={pending}
        onThreshold={(h) => onParam("untouchedHours", String(h))}
      />

      <TeamDealsCard
        data={data.teamDeals}
        currency={data.salesMetrics?.currency || "USD"}
        assignableUsers={data.assignableUsers}
        pending={pending}
        onGroupBy={(g) => onParam("teamGroup", g)}
        onRegion={(r) => onParam("region", r)}
        onDone={onRefresh}
      />

      <ManagerActionsCard data={data} />

      <DashboardAnalyticsPanel
        analytics={analytics}
        showFunnelCharts={false}
        showMyCoaching={false}
        showTeamCoaching
        showSnapshotMeta={false}
      />
    </div>
  );
}

function SectionHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className={SECTION_H2_CLASS}>{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-text-caption">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <SectionHead title={title} subtitle={subtitle} action={action} />
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-white px-6 py-16 text-center">
      <p className="text-sm text-text-caption">{message}</p>
    </div>
  );
}

function ManagerActionsCard({ data }: { data: AdminOpsData }) {
  const dealsCreated =
    data.monthlyMetrics.cards.find((c) => c.id === "deals_created")?.value ??
    "0";
  const actions = [
    {
      id: "untouched",
      label: "Untouched leads",
      value: data.untouchedLeads.items.length,
      hint: `Older than ${data.untouchedLeads.thresholdHours}h`,
      href: "/contact?stage=lead",
      warn: data.untouchedLeads.items.length > 0,
    },
    {
      id: "negotiation",
      label: "In negotiation",
      value: data.teamDeals.summary.negotiation,
      hint: "Open deals near close",
      href: "/sales",
      warn: data.teamDeals.summary.negotiation > 0,
    },
    {
      id: "activity",
      label: "Activities today",
      value: data.activityFeed.loggedToday,
      hint:
        data.activityFeed.repCount > 0
          ? `${data.activityFeed.repCount} reps active`
          : "Logged by the team",
      href: "/activities",
      warn: false,
    },
    {
      id: "new_opps",
      label: "New opportunities",
      value: dealsCreated,
      hint: data.monthlyMetrics.title,
      href: "/sales",
      warn: false,
    },
  ];

  return (
    <section className={`${REPORT_SURFACE_CLASS} p-4`}>
      <SectionHead
        title="Manager actions"
        subtitle="Today"
      />
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {actions.map((item) => (
          <li key={item.id}>
            <Link
              to={item.href}
              className="flex items-center justify-between gap-3 rounded-xl border-[0.6px] border-[#bfbfbf] px-3 py-2.5 transition-colors hover:bg-subtle/80"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">
                  {item.label}
                </span>
                <span className="block text-xs text-text-caption">
                  {item.hint}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold tabular-nums ${
                  item.warn ? TONE_WARNING : "bg-subtle text-text-primary"
                }`}
              >
                {item.value}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TeamPerformanceCard({
  pipelineByOwner,
  periodLabel,
  currency,
  focusedRep,
  onRep,
  onClearRep,
}: {
  pipelineByOwner: ChartSlice[];
  periodLabel?: string;
  currency: string;
  focusedRep: AdminOpsData["focusedRep"];
  onRep: (id: string) => void;
  onClearRep: () => void;
}) {
  const detailRef = useRef<HTMLDivElement>(null);
  const rows = pipelineByOwner.filter(
    (s) => s.id !== "__unassigned__" && s.label.trim().toLowerCase() !== "unknown",
  );
  const selectedId = focusedRep?.userId ?? null;

  useEffect(() => {
    if (!selectedId) return;
    detailRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <SectionHead
        title="Team performance"
        subtitle={`Open pipeline by rep · ${metricPeriod(periodLabel)}`}
      />
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">No pipeline owners yet.</p>
      ) : (
        <div className="mt-4 space-y-4">
          <ul className="flex flex-wrap gap-2">
            {rows.map((row) =>
              row.id.startsWith("__") ? (
                <li
                  key={row.id}
                  className="rounded-lg bg-subtle px-2.5 py-1 text-xs text-text-caption"
                >
                  {row.label}
                </li>
              ) : (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onRep(row.id)}
                    aria-pressed={row.id === selectedId}
                    className={`rounded-xl border-[0.6px] px-2.5 py-1 text-xs font-medium ${
                      row.id === selectedId
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-[#bfbfbf] bg-white text-text-secondary hover:border-neutral-400 hover:text-text-primary"
                    }`}
                  >
                    {row.label}
                  </button>
                </li>
              ),
            )}
          </ul>
          {focusedRep ? (
            <div
              ref={detailRef}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-[0.6px] border-[#bfbfbf] bg-subtle/50 px-3 py-3"
            >
              <div>
                <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
                  Individual view
                </p>
                <p className="mt-0.5 text-sm font-semibold text-text-primary">
                  {focusedRep.name}
                </p>
                <p className="mt-1 text-sm text-text-primary">
                  {focusedRep.openDeals} open · {focusedRep.wonDeals} won ·{" "}
                  {focusedRep.pipelineValue} pipeline · {focusedRep.callsInPeriod}{" "}
                  calls
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/sales"
                  className="inline-flex h-8 items-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                >
                  Pipeline
                </Link>
                <button
                  type="button"
                  onClick={onClearRep}
                  className="inline-flex h-8 items-center rounded-lg bg-black px-3 text-xs font-medium text-white hover:bg-neutral-800"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : null}
          <LollipopBars
            slices={rows}
            selectedId={selectedId}
            onSelect={onRep}
            formatValue={(n) => formatMoney(String(n), currency)}
          />
        </div>
      )}
    </section>
  );
}

function TopOpportunitiesList({
  rows,
}: {
  rows: NonNullable<AdminOpsData["salesMetrics"]>["topOpportunities"];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-caption">No open deals yet.</p>;
  }

  return (
    <ul className="scrollbar-always max-h-[18.75rem] space-y-3 overflow-y-scroll pr-3 [scrollbar-gutter:stable]">
      {rows.slice(0, 8).map((row) => (
        <li key={row.id}>
          <Link
            to={`/sales/${row.id}`}
            className="flex items-center justify-between gap-3 rounded-xl border-[0.6px] border-[#bfbfbf] px-3 py-2.5 transition-colors hover:bg-subtle/80"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium capitalize text-text-primary">
                {row.title}
              </span>
              <span className="block truncate text-xs text-text-caption">
                {row.companyName}
                {row.ownerName ? ` · ${row.ownerName}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right">
              {row.amount ? (
                <span className="block text-sm tabular-nums font-semibold text-text-primary">
                  {row.amount}
                </span>
              ) : null}
              <span className="block text-xs text-text-caption">
                {row.stageLabel} · {row.agingDays}d
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FocusedRepBanner({
  rep,
  onBack,
}: {
  rep: NonNullable<AdminOpsData["focusedRep"]>;
  onBack: () => void;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={`inline-flex size-[38px] items-center justify-center rounded-xl ${KPI_ICON_TONES[0]}`}
          >
            <Users className="size-[18px]" strokeWidth={2.25} />
          </span>
          <div>
            <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
              Individual view
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-text-primary">
              {rep.name}
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              {rep.openDeals} open · {rep.wonDeals} won · {rep.pipelineValue}{" "}
              pipeline · {rep.callsInPeriod} calls
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/sales"
            className="inline-flex h-[38px] items-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Pipeline
          </Link>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-black px-3 text-sm font-medium text-white hover:bg-neutral-800"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} />
            Back to team
          </button>
        </div>
      </div>
    </section>
  );
}

function LeaderboardCard({
  data,
  pending,
  onMetric,
  onPeriod,
  onRep,
}: {
  data: AdminOpsData["leaderboard"];
  pending: boolean;
  onMetric: (m: string) => void;
  onPeriod: (p: string) => void;
  onRep: (id: string) => void;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHead title="Leaderboard" subtitle="Ranked reps" />
        <div className="flex flex-wrap gap-2">
          <DropdownSelect
            value={data.metric}
            options={LEADERBOARD_METRIC_OPTIONS}
            disabled={pending}
            size="sm"
            onChange={onMetric}
            aria-label="Leaderboard metric"
          />
          <DropdownSelect
            value={data.period}
            options={LEADERBOARD_PERIOD_OPTIONS}
            disabled={pending}
            size="sm"
            onChange={onPeriod}
            aria-label="Leaderboard period"
          />
        </div>
      </div>
      {data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">No ranking data yet.</p>
      ) : (
        <ol className="mt-4 space-y-1">
          {data.rows.map((row, i) => (
            <li key={row.userId}>
              <button
                type="button"
                onClick={() => onRep(row.userId)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors hover:bg-subtle"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                      i === 0
                        ? "bg-neutral-900 text-white"
                        : "bg-subtle text-text-secondary"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate font-medium text-text-primary">
                    {row.name}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-text-primary">
                  {row.valueLabel}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ActivityFeedCard({ feed }: { feed: AdminOpsData["activityFeed"] }) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <SectionHead
        title="Today’s activity"
        subtitle={`${feed.loggedToday} logged${feed.repCount > 0 ? ` · ${feed.repCount} reps` : ""}`}
        action={
          <Link
            to="/activities"
            className="text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            All
          </Link>
        }
      />
      {feed.items.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">
          No activities logged today yet.
        </p>
      ) : (
        <ul className="mt-4 max-h-80 space-y-1 overflow-y-auto">
          {feed.items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg px-2.5 py-2.5 transition-colors hover:bg-subtle"
            >
              <div className="flex flex-wrap items-center gap-2">
                <ActivityTypeBadge type={item.type} />
                {item.actorName ? (
                  <span className="text-xs text-text-caption">
                    {item.actorName}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm font-medium text-text-primary">
                {item.subject}
              </p>
              <Link
                to={`/contact/${item.contactId}`}
                className="text-sm text-text-secondary hover:text-text-primary hover:underline"
              >
                {item.contactName}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UntouchedLeadsCard({
  data,
  pending,
  onThreshold,
}: {
  data: AdminOpsData["untouchedLeads"];
  pending: boolean;
  onThreshold: (hours: number) => void;
}) {
  const hasItems = data.items.length > 0;

  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 inline-flex size-9 items-center justify-center rounded-md ${
              hasItems ? TONE_WARNING : TONE_SUCCESS
            }`}
          >
            <AlertTriangle className="size-4" strokeWidth={1.85} />
          </span>
          <div>
            <h2 className={SECTION_H2_CLASS}>
              Untouched leads
              {hasItems ? (
                <span className="ml-2 text-sm font-normal text-text-caption">
                  {data.items.length}
                </span>
              ) : null}
            </h2>
            <p className="mt-0.5 text-xs text-text-caption">
              No updates past the age threshold
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          Older than
          <DropdownSelect
            value={String(data.thresholdHours)}
            options={UNTOUCHED_THRESHOLD_OPTIONS}
            disabled={pending}
            size="sm"
            onChange={(value) => onThreshold(Number(value))}
            aria-label="Untouched lead threshold"
          />
        </label>
      </div>

      {data.items.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">
          Nothing above this threshold.
        </p>
      ) : (
        <ul className="mt-4 max-h-56 divide-y divide-border-default overflow-y-auto">
          {data.items.map((lead) => (
            <li
              key={lead.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
            >
              <span className="min-w-0">
                <Link
                  to={`/contact/${lead.id}`}
                  className="font-medium text-text-primary hover:underline"
                >
                  {lead.displayName}
                </Link>
                <span className="block truncate text-xs text-text-caption">
                  {lead.email}
                  {lead.ownerName ? ` · ${lead.ownerName}` : " · Unassigned"}
                </span>
              </span>
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${TONE_WARNING}`}>
                {lead.ageHours}h
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamDealsCard({
  data,
  currency,
  assignableUsers,
  pending,
  onGroupBy,
  onRegion,
  onDone,
}: {
  data: AdminOpsData["teamDeals"];
  currency: string;
  assignableUsers: AdminOpsData["assignableUsers"];
  pending: boolean;
  onGroupBy: (g: string) => void;
  onRegion: (r: string | null) => void;
  onDone: () => void;
}) {
  const [reassignDealId, setReassignDealId] = useState<string | null>(null);
  const [ownerUserId, setOwnerUserId] = useState(
    assignableUsers[0]?.id ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reassign() {
    if (!reassignDealId || !ownerUserId) return;
    setBusy(true);
    setMessage(null);
    const result = await reassignDeal({
      dealId: reassignDealId,
      ownerUserId,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setReassignDealId(null);
    setMessage("Deal reassigned.");
    onDone();
  }

  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={SECTION_H2_CLASS}>Team deals</h2>
          <p className="mt-1 text-sm text-text-caption">
            {data.summary.open} open · {data.summary.negotiation} negotiating ·{" "}
            {data.summary.closed} closed
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownSelect
            value={data.groupBy}
            options={TEAM_DEALS_GROUP_OPTIONS}
            disabled={pending}
            size="sm"
            onChange={onGroupBy}
            aria-label="Group team deals by"
          />
          <DropdownSelect
            value={data.region ?? ""}
            options={[
              { value: "", label: "All regions" },
              ...data.regions.map((region) => ({
                value: region,
                label: region,
              })),
            ]}
            disabled={pending}
            size="sm"
            onChange={(value) => onRegion(value || null)}
            aria-label="Filter team deals by region"
          />
        </div>
      </div>

      {reassignDealId ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-subtle/70 p-3">
          <span className="text-xs text-text-secondary">Reassign to</span>
          <DropdownSelect
            value={ownerUserId}
            options={assignableUsers.map((user) => ({
              value: user.id,
              label: user.label,
            }))}
            disabled={busy}
            size="sm"
            onChange={setOwnerUserId}
            aria-label="Reassign deal owner"
          />
          <button
            type="button"
            disabled={busy || !ownerUserId}
            onClick={() => void reassign()}
            className="inline-flex h-[38px] items-center rounded-lg bg-black px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setReassignDealId(null)}
            className="inline-flex h-[38px] items-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm font-medium text-neutral-700"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="mt-2 text-xs text-text-caption">{message}</p>
      ) : null}

      {data.groups.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">No deals to show.</p>
      ) : (
        <div className="mt-4 max-h-[28rem] space-y-5 overflow-y-auto">
          {data.groups.map((group) => (
            <div key={group.id}>
              <h3 className="text-xs font-semibold tracking-wide text-text-caption uppercase">
                {group.label}{" "}
                <span className="font-normal">({group.deals.length})</span>
              </h3>
              <ul className="mt-2 divide-y divide-border-default">
                {group.deals.map((deal) => (
                  <li
                    key={deal.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/sales/${deal.id}`}
                        className="font-medium text-text-primary hover:underline"
                      >
                        {deal.title}
                      </Link>
                      <p className="text-xs text-text-caption">
                        {deal.companyName}
                        {deal.region ? ` · ${deal.region}` : null}
                        {deal.ownerName ? ` · ${deal.ownerName}` : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-secondary">
                        {deal.stageLabel}
                        {deal.amount
                          ? ` · ${formatMoneyFull(deal.amount, currency)}`
                          : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setReassignDealId(deal.id);
                          setOwnerUserId(
                            deal.ownerUserId ?? assignableUsers[0]?.id ?? "",
                          );
                        }}
                        className="text-xs font-medium text-text-secondary hover:text-text-primary hover:underline"
                      >
                        Reassign
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
