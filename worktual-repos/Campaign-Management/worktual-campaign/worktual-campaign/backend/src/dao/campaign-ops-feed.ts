// @ts-nocheck
/**
 * Unified Dashboard ops payload — live sends, recent failures, activity tail.
 */
import type { CampaignSessionUser } from "../types/auth.js";
import {
  resolveCampaignDataScope,
  scopeAppliedLabel,
} from "../helpers/campaign-visibility.js";
import {
  getPortfolioActivitySeriesDao,
  resolveActivitySeriesYmdBounds,
} from "./portfolio-activity-series.js";
import {
  listActiveLiveSendsDao,
  listRecentSendFailuresDao,
} from "./campaign-live-status.js";

export async function getCampaignOpsFeedDao(
  session: CampaignSessionUser,
  input: {
    relative?: string | null;
    fromDate?: string | null;
    toDate?: string | null;
    activityFromDate?: string | null;
    activityToDate?: string | null;
    allowedChannels?: Set<string> | null;
    liveLimit?: number;
    failureLimit?: number;
  },
): Promise<Record<string, unknown>> {
  const bounds = resolveActivitySeriesYmdBounds({
    relative: input.relative,
    fromDate: input.activityFromDate ?? input.fromDate,
    toDate: input.activityToDate ?? input.toDate,
  });

  const [live, failures, series] = await Promise.all([
    listActiveLiveSendsDao(session, input.liveLimit ?? 8),
    listRecentSendFailuresDao(session, {
      limit: input.failureLimit ?? 8,
    }),
    getPortfolioActivitySeriesDao(session, {
      relative: input.relative,
      fromDate: bounds.fromYmd,
      toDate: bounds.toYmd,
      allowedChannels: input.allowedChannels,
    }),
  ]);

  const scope = resolveCampaignDataScope(session);
  return {
    as_of: new Date().toISOString(),
    active_sends: live.active_sends ?? [],
    recent_failures: failures.failures ?? [],
    activity_series: series.series ?? [],
    activity_from_date: series.from_date,
    activity_to_date: series.to_date,
    timezone: series.timezone,
    scope_applied: scope,
    scope_label: scopeAppliedLabel(scope),
  };
}
