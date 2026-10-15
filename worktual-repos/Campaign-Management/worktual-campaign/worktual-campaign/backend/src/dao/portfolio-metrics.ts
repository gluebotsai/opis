// @ts-nocheck
/**
 * Portfolio KPI aggregation — single source of truth for Dashboard, analytics/ask,
 * and agent LIST_MONITOR_CAMPAIGNS totals (launch-window filter applied by caller).
 */
import {
  isClickTrackedAgentChannel,
  isOpenTrackedAgentChannel,
  toAgentChannel,
} from "../helpers/channel-ids.js";
import { engagementRates } from "./campaign-metrics.js";
import type { CampaignListItem } from "./campaign.js";

export type ChannelRollupRow = {
  channel: string;
  sent: number;
  failed: number;
  stubSent: number;
  delivered: number;
  opens: number;
  clicks: number;
  totalOpens: number;
  totalClicks: number;
  /** Ran campaigns that include this channel. */
  campaigns: number;
};

function isRanCampaignStatus(status: string): boolean {
  const s = String(status || "").toLowerCase();
  return s === "live" || s === "completed" || s === "cancelled";
}

export type PortfolioTotals = {
  campaigns: number;
  messaging_campaigns: number;
  /** Dashboard headline: live + completed + cancelled (messaging, non–PPC-only). */
  campaigns_ran: number;
  live_count: number;
  scheduled_count: number;
  completed_count: number;
  draft_count: number;
  /** Ran campaigns with at least one message delivered (any channel). */
  campaigns_with_send: number;
  /** Ran campaigns with at least one send failure (any channel). */
  campaigns_with_failure: number;
  /** Total messages delivered across ran campaigns (volume, not campaign count). */
  sent: number;
  failed: number;
  stub_sent: number;
  delivered: number;
  /** Unique openers on open-tracked channels (email). */
  opens: number;
  /** Unique clickers on click-tracked channels (email, push, web). */
  clicks: number;
  /** Denominator for open_rate (email delivered, open-tracked). */
  open_tracked_delivered: number;
  /** Denominator for click_rate (click-tracked channels delivered). */
  click_tracked_delivered: number;
  total_opens: number;
  total_clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  currency: string | null;
  /** Fractions 0…1 — same as campaign list openRate / clickRate. */
  open_rate: number | null;
  click_rate: number | null;
  ctor: number | null;
  /** Agent-facing percentages (one decimal, 0–100). */
  open_rate_pct: number | null;
  click_rate_pct: number | null;
  ctor_pct: number | null;
  open_rate_display: string | null;
  click_rate_display: string | null;
  channel_rollup: ChannelRollupRow[];
  note: string;
};

const RATE_NOTE =
  "open_rate_pct / click_rate_pct match Dashboard (unique opens/clicks over delivered on tracked channels). Do not rescale.";

export const PORTFOLIO_KPI_GLOSSARY =
  "campaigns_ran = campaigns that ran in the period (live+completed+cancelled). " +
  "campaigns_with_send = ran campaigns with at least one delivery (Dashboard Sent KPI count). " +
  "campaigns_with_failure = ran campaigns with send failures (Dashboard Failed KPI count). " +
  "sent / failed = message volumes across ran campaigns only (not campaign counts). " +
  "channel_rollup[].campaigns = ran campaigns that include that channel. " +
  "open_rate_pct / click_rate_pct = email engagement (unique over email delivered).";

function pctOneDecimal(fraction: number | null): number | null {
  if (fraction == null || Number.isNaN(fraction)) return null;
  return Math.round(Math.min(100, fraction * 100) * 10) / 10;
}

export function isPpcOnlyListItem(row: CampaignListItem): boolean {
  const keys = new Set<string>();
  for (const c of row.channels || []) {
    const k = toAgentChannel(String(c));
    if (k) keys.add(k);
  }
  for (const cm of row.channelMetrics || []) {
    const k = toAgentChannel(String(cm.channel || ""));
    if (k) keys.add(k);
  }
  if (keys.size === 0) return Boolean(row.hasPpc);
  return [...keys].every((k) => k === "ppc");
}

function channelAllowed(key: string, allowed: Set<string> | null | undefined): boolean {
  if (!allowed || allowed.size === 0) return true;
  return allowed.has(key);
}

/**
 * Sum list rows the same way buildCampaignMetricTotals rolls up channels.
 */
export function aggregatePortfolioFromListItems(
  items: CampaignListItem[],
  opts?: {
    excludePpcOnly?: boolean;
    allowedChannels?: Set<string> | null;
  },
): PortfolioTotals {
  const excludePpc = opts?.excludePpcOnly !== false;
  const allowed = opts?.allowedChannels ?? null;

  let campaigns = 0;
  let messagingCampaigns = 0;
  let campaignsRan = 0;
  let liveCount = 0;
  let scheduledCount = 0;
  let completedCount = 0;
  let draftCount = 0;

  let campaignsWithSend = 0;
  let campaignsWithFailure = 0;
  let sent = 0;
  let failed = 0;
  let stubSent = 0;
  let messagingDelivered = 0;
  let openTrackedDelivered = 0;
  let openTrackedOpens = 0;
  let openTrackedClicks = 0;
  let clickTrackedDelivered = 0;
  let clickTrackedClicks = 0;
  let totalOpens = 0;
  let totalClicks = 0;
  let impressions = 0;
  let spend = 0;
  let conversions = 0;
  let currency: string | null = null;

  const rollupMap = new Map<string, ChannelRollupRow>();

  for (const row of items) {
    campaigns += 1;
    const st = String(row.status || "").toLowerCase();
    if (st === "live") liveCount += 1;
    else if (st === "scheduled") scheduledCount += 1;
    else if (st === "completed" || st === "cancelled") completedCount += 1;
    else if (st === "draft") draftCount += 1;

    const ppcOnly = excludePpc && isPpcOnlyListItem(row);
    if (!ppcOnly && isRanCampaignStatus(row.status)) campaignsRan += 1;

    if (ppcOnly) continue;
    messagingCampaigns += 1;

    const ran = isRanCampaignStatus(row.status);
    if (!ran) continue;

    const metrics = row.channelMetrics?.length
      ? row.channelMetrics
      : (row.channels || []).map((channel) => ({
          channel,
          sent: row.sent || 0,
          failed: row.failed || 0,
          delivered: row.delivered ?? row.sent ?? 0,
          stubSent: row.stubSent || 0,
          opens: row.opens || 0,
          clicks: row.clicks || 0,
          totalOpens: row.totalOpens || row.opens || 0,
          totalClicks: row.totalClicks || row.clicks || 0,
          impressions: row.impressions || 0,
          spend: row.spend || 0,
          conversions: row.conversions || 0,
          currency: row.currency,
        }));

    let rowSent = 0;
    let rowFailed = 0;
    for (const ch of metrics) {
      const key = toAgentChannel(String(ch.channel || ""));
      if (!key || key === "ppc") continue;
      if (!channelAllowed(key, allowed)) continue;

      const chSent = Number(ch.sent || 0);
      const chFailed = Number(ch.failed || 0);
      const chStub = Number(ch.stubSent || 0);
      const chDelivered = Number(ch.delivered ?? chSent);
      const chOpens = Number(ch.opens || 0);
      const chClicks = Number(ch.clicks || 0);
      const chTotalOpens = Number(ch.totalOpens ?? chOpens);
      const chTotalClicks = Number(ch.totalClicks ?? chClicks);

      rowSent += chSent;
      rowFailed += chFailed;
      sent += chSent;
      failed += chFailed;
      stubSent += chStub;
      messagingDelivered += chDelivered;

      if (isOpenTrackedAgentChannel(key)) {
        openTrackedDelivered += chDelivered;
        openTrackedOpens += chOpens;
        openTrackedClicks += chClicks;
        totalOpens += chTotalOpens;
      }
      if (isClickTrackedAgentChannel(key)) {
        clickTrackedDelivered += chDelivered;
        clickTrackedClicks += chClicks;
        totalClicks += chTotalClicks;
      }

      const prev =
        rollupMap.get(key) ||
        ({
          channel: key,
          sent: 0,
          failed: 0,
          stubSent: 0,
          delivered: 0,
          opens: 0,
          clicks: 0,
          totalOpens: 0,
          totalClicks: 0,
          campaigns: 0,
        } as ChannelRollupRow);
      prev.sent += chSent;
      prev.failed += chFailed;
      prev.stubSent += chStub;
      prev.delivered += chDelivered;
      if (isOpenTrackedAgentChannel(key)) {
        prev.opens += chOpens;
        prev.totalOpens += chTotalOpens;
      }
      if (isClickTrackedAgentChannel(key)) {
        prev.clicks += chClicks;
        prev.totalClicks += chTotalClicks;
      }
      rollupMap.set(key, prev);
    }
    if (rowSent > 0) campaignsWithSend += 1;
    if (rowFailed > 0) campaignsWithFailure += 1;

    const seenChannels = new Set<string>();
    for (const cm of metrics) {
      const key = toAgentChannel(String(cm.channel || ""));
      if (!key || key === "ppc" || !channelAllowed(key, allowed)) continue;
      seenChannels.add(key);
    }
    for (const key of seenChannels) {
      const prev = rollupMap.get(key);
      if (prev) prev.campaigns += 1;
    }
  }

  for (const row of items) {
    if (excludePpc && isPpcOnlyListItem(row)) continue;
    if (!isRanCampaignStatus(row.status)) continue;
    impressions += Number(row.impressions || 0);
    spend += Number(row.spend || 0);
    conversions += Number(row.conversions || 0);
    if (!currency && row.currency) currency = row.currency;
  }

  const openRates = engagementRates({
    delivered: openTrackedDelivered,
    opens: openTrackedOpens,
    clicks: openTrackedClicks,
  });
  const clickRates = engagementRates({
    delivered: clickTrackedDelivered,
    opens: 0,
    clicks: clickTrackedClicks,
  });

  const openPct = pctOneDecimal(openRates.openRate);
  const clickPct = pctOneDecimal(clickRates.clickRate);
  const ctorPct = pctOneDecimal(openRates.ctor);

  return {
    campaigns,
    messaging_campaigns: messagingCampaigns,
    campaigns_ran: campaignsRan,
    live_count: liveCount,
    scheduled_count: scheduledCount,
    completed_count: completedCount,
    draft_count: draftCount,
    campaigns_with_send: campaignsWithSend,
    campaigns_with_failure: campaignsWithFailure,
    sent,
    failed,
    stub_sent: stubSent,
    delivered: messagingDelivered,
    opens: openTrackedOpens,
    clicks: clickTrackedClicks,
    open_tracked_delivered: openTrackedDelivered,
    click_tracked_delivered: clickTrackedDelivered,
    total_opens: totalOpens,
    total_clicks: totalClicks,
    impressions,
    spend: Math.round(spend * 100) / 100,
    conversions,
    currency: currency || "INR",
    open_rate: openRates.openRate,
    click_rate: clickRates.clickRate,
    ctor: openRates.ctor,
    open_rate_pct: openPct,
    click_rate_pct: clickPct,
    ctor_pct: ctorPct,
    open_rate_display: openPct != null ? `${openPct}%` : null,
    click_rate_display: clickPct != null ? `${clickPct}%` : null,
    channel_rollup: [...rollupMap.values()].sort((a, b) =>
      a.channel.localeCompare(b.channel),
    ),
    note: RATE_NOTE,
  };
}

/** Shape returned on campaign list + portfolio endpoint for Python agents. */
export function portfolioTotalsAgentShape(t: PortfolioTotals) {
  return {
    campaigns: t.campaigns_ran,
    campaigns_ran: t.campaigns_ran,
    campaigns_with_send: t.campaigns_with_send,
    campaigns_with_failure: t.campaigns_with_failure,
    live_count: t.live_count,
    scheduled_count: t.scheduled_count,
    completed_count: t.completed_count,
    draft_count: t.draft_count,
    messages_sent: t.sent,
    messages_failed: t.failed,
    sent: t.sent,
    delivered: t.delivered,
    failed: t.failed,
    stub_sent: t.stub_sent,
    opens: t.opens,
    clicks: t.clicks,
    open_tracked_delivered: t.open_tracked_delivered,
    click_tracked_delivered: t.click_tracked_delivered,
    total_opens: t.total_opens,
    total_clicks: t.total_clicks,
    impressions: t.impressions,
    spend: t.spend,
    conversions: t.conversions,
    currency: t.currency,
    open_rate_pct: t.open_rate_pct,
    click_rate_pct: t.click_rate_pct,
    ctor_pct: t.ctor_pct,
    open_rate_display: t.open_rate_display,
    click_rate_display: t.click_rate_display,
    channel_rollup: t.channel_rollup,
    note: t.note,
    kpi_glossary: PORTFOLIO_KPI_GLOSSARY,
  };
}
