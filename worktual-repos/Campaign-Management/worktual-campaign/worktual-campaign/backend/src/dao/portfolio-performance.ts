// @ts-nocheck
/**
 * Single contract for Dashboard + agent performance (launch KPIs + activity series).
 */
import type { CampaignSessionUser } from "../types/auth.js";
import {
  resolveCampaignDataScope,
  scopeAppliedLabel,
} from "../helpers/campaign-visibility.js";
import { listCampaignsByBucketDao, type ListCampaignsOptions } from "./campaign.js";
import {
  aggregatePortfolioFromListItems,
  portfolioTotalsAgentShape,
  PORTFOLIO_KPI_GLOSSARY,
} from "./portfolio-metrics.js";
import {
  getPortfolioActivitySeriesDao,
  resolveActivitySeriesYmdBounds,
} from "./portfolio-activity-series.js";

export type PerformanceMode = "launch" | "activity";

type SeriesPoint = {
  sent?: number;
  failed?: number;
  opens?: number;
  clicks?: number;
};

function sumActivitySeries(series: SeriesPoint[]) {
  let sent = 0;
  let failed = 0;
  let opens = 0;
  let clicks = 0;
  for (const row of series) {
    sent += Number(row.sent || 0);
    failed += Number(row.failed || 0);
    opens += Number(row.opens || 0);
    clicks += Number(row.clicks || 0);
  }
  return { sent, failed, opens, clicks };
}

const DEFINITIONS = {
  performance_mode_launch:
    "KPI totals from campaigns that launched in the period (launch local date / list filter).",
  performance_mode_activity:
    "activity_series buckets by event time (send/fail/open/click timestamps, IST).",
  campaigns_ran: "Live + completed + cancelled in period (messaging, non–PPC-only).",
  campaigns_with_send: "Ran campaigns with ≥1 delivery (Dashboard Sent card count).",
  messages_delivered: "Message volume delivered (sent KPI hint).",
  open_rate_pct: "Unique email opens / email open-tracked delivered.",
  click_rate_pct: "Unique clickers / click-tracked delivered (email, push, web).",
};

export async function getPortfolioPerformanceDao(
  session: CampaignSessionUser,
  input: {
    mode?: PerformanceMode | null;
    relative?: string | null;
    fromDate?: string | null;
    toDate?: string | null;
    /** Activity chart only — launch list filter still uses fromDate/toDate/relative. */
    activityFromDate?: string | null;
    activityToDate?: string | null;
    allowedChannels?: Set<string> | null;
    listOpts?: ListCampaignsOptions;
  },
): Promise<Record<string, unknown>> {
  const mode: PerformanceMode =
    input.mode === "activity" ? "activity" : "launch";
  const listOpts = input.listOpts || { bucket: "all", lite: false };
  const items = await listCampaignsByBucketDao(session, listOpts);
  const totals = aggregatePortfolioFromListItems(items, {
    excludePpcOnly: true,
    allowedChannels: input.allowedChannels,
  });
  const bounds = resolveActivitySeriesYmdBounds({
    relative: input.relative,
    fromDate: input.activityFromDate ?? input.fromDate,
    toDate: input.activityToDate ?? input.toDate,
  });
  const seriesPayload = await getPortfolioActivitySeriesDao(session, {
    relative: input.relative,
    fromDate: bounds.fromYmd,
    toDate: bounds.toYmd,
    allowedChannels: input.allowedChannels,
  });
  const scope = resolveCampaignDataScope(session);
  const series = (seriesPayload.series ?? []) as SeriesPoint[];
  const activityTotals = sumActivitySeries(series);
  let portfolioShape = portfolioTotalsAgentShape(totals);
  if (mode === "activity") {
    portfolioShape = {
      ...portfolioShape,
      sent: activityTotals.sent,
      failed: activityTotals.failed,
      messages_sent: activityTotals.sent,
      messages_failed: activityTotals.failed,
      delivered: activityTotals.sent,
      opens: activityTotals.opens,
      clicks: activityTotals.clicks,
      open_rate_pct: null,
      click_rate_pct: null,
      ctor_pct: null,
      open_rate_display: null,
      click_rate_display: null,
      note:
        "Activity mode: sent/failed/opens/clicks summed from event-time daily series (IST). " +
        "Open/click rates use launch-mode GET with mode=launch.",
    };
  }
  return {
    as_of: new Date().toISOString(),
    performance_mode: mode,
    period: {
      relative: input.relative || null,
      from_date: bounds.fromYmd,
      to_date: bounds.toYmd,
      launch_filter: "campaign launch local date in [from_date, to_date]",
      activity_filter: "send/fail/open/click timestamps in [from_date, to_date] IST",
    },
    scope_applied: scope,
    scope_label: scopeAppliedLabel(scope),
    campaigns_matched: items.length,
    portfolio_totals: portfolioShape,
    activity_totals: activityTotals,
    activity_series: series,
    activity_timezone: seriesPayload.timezone,
    definitions: DEFINITIONS,
    kpi_glossary: PORTFOLIO_KPI_GLOSSARY,
  };
}
