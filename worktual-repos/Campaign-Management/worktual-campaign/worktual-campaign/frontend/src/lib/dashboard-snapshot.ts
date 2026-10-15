import {
  fetchCampaignOpsFeed,
  fetchPortfolioPerformance,
} from "@/services/campaigns.service";
import {
  buildDashboardPeriodPayload,
  dashboardActivitySeriesFilter,
  dashboardPeriodToAgentFilter,
  isPpcOnlyCampaign,
} from "@/lib/dashboard-metrics";
import type { CampaignListItem } from "@/services/campaigns.service";
import type { PerformanceCustomRange, PerformanceRange } from "@/lib/dashboard-metrics";

/** Compact context for reports agent — same period as Overview. */
export async function buildDashboardSnapshot(args: {
  range: PerformanceRange;
  customRange: PerformanceCustomRange | null;
  periodLabel: string;
  campaigns?: CampaignListItem[];
}) {
  const filter = dashboardPeriodToAgentFilter(args.range, args.customRange);
  const messaging = (args.campaigns ?? []).filter((r) => !isPpcOnlyCampaign(r));
  const activity = dashboardActivitySeriesFilter(
    args.range,
    args.customRange,
    messaging,
  );
  const [portfolio, ops] = await Promise.all([
    fetchPortfolioPerformance({
      mode: "launch",
      relative: filter.relative,
      from: filter.from_date,
      to: filter.to_date,
      activityFrom: activity.activity_from,
      activityTo: activity.activity_to,
    }).catch(() => null),
    fetchCampaignOpsFeed({
      relative: activity.relative,
      from: filter.from_date,
      to: filter.to_date,
      activityFrom: activity.activity_from,
      activityTo: activity.activity_to,
      liveLimit: 8,
      failureLimit: 6,
    }).catch(() => ({
      asOf: null,
      activeSends: [],
      recentFailures: [],
      activitySeries: [],
    })),
  ]);
  return {
    as_of: new Date().toISOString(),
    period_label: args.periodLabel,
    dashboard_period: buildDashboardPeriodPayload(
      args.range,
      args.customRange,
      messaging,
    ),
    performance_mode: portfolio?.performanceMode ?? "launch",
    portfolio_totals: portfolio?.totals ?? null,
    activity_series:
      portfolio?.activitySeries?.length
        ? portfolio.activitySeries
        : ops.activitySeries,
    active_sends: ops.activeSends,
    active_sends_as_of: ops.asOf,
    recent_failures: ops.recentFailures,
  };
}
