// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * Campaign performance metrics — prefer live send-recipient counts when batches
 * exist; otherwise fall back to launch_plan.channel_run (demo / synthetic).
 */
import { prisma } from "../plugins/prisma.js";
import {
  isClickTrackedAgentChannel,
  isOpenTrackedAgentChannel,
  toAgentChannel,
} from "../helpers/channel-ids.js";
import { recipientDeliveryOutcome } from "../helpers/send-status.js";

function isBounceRecipient(input: {
  status?: string | null;
  skipFailReason?: string | null;
}): boolean {
  const st = String(input.status || "").trim().toLowerCase();
  if (st === "bounced" || st === "hard_bounce" || st === "soft_bounce") {
    return true;
  }
  const reason = String(input.skipFailReason || "").trim().toLowerCase();
  return /bounce|undeliver|mailbox.?full|550 |551 |552 |553 |554 /.test(reason);
}

export type ChannelMetricTotals = {
  channel: string;
  /** Contacts planned / queued for this channel. */
  selected: number;
  sent: number;
  failed: number;
  /** Email delivery bounces (subset of failures when live data exists). */
  bounced: number;
  /** Accepted by the provider; rate denominator (sent already excludes bounces). */
  delivered: number;
  /** Distinct recipients who opened — industry "unique opens". */
  opens: number;
  /** Every open hit including repeats. */
  totalOpens: number;
  /** Distinct recipients who clicked — industry "unique clicks". */
  clicks: number;
  /** Every click hit including repeats. */
  totalClicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  currency: string | null;
  network: string | null;
  /** True when sent/failed came from CampaignSendRecipient rows. */
  fromLiveSends: boolean;
  /** Local stub sends — not inbox delivery. */
  stubSent: number;
};

export type CampaignMetricTotals = {
  sent: number;
  failed: number;
  /** Messaging + ads delivered (sent, excluding bounces and stub sends). */
  delivered: number;
  /** Unique openers. */
  opens: number;
  /** Open hits including repeats. */
  totalOpens: number;
  /** Unique clickers. */
  clicks: number;
  /** Click hits including repeats. */
  totalClicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  currency: string | null;
  hasPpc: boolean;
  /** Kept for backward compat; KPIs now use all-channel sent/opens/clicks. */
  emailSent: number;
  emailOpens: number;
  emailClicks: number;
  stubSent: number;
  /** unique email opens / email delivered (0…1). Push/web do not track opens. */
  openRate: number | null;
  /** unique clicks / delivered on email, app push, and web push (each channel counted separately in `channels`). */
  clickRate: number | null;
  /** Click-to-open rate: unique clicks / unique opens (0…1). */
  ctor: number | null;
  channels: ChannelMetricTotals[];
};

/**
 * Industry-standard engagement rates. Denominator is delivered (not selected),
 * numerators are unique recipients, so rates can never exceed 100%.
 */
export function engagementRates(input: {
  delivered: number;
  opens: number;
  clicks: number;
}): { openRate: number | null; clickRate: number | null; ctor: number | null } {
  const delivered = Math.max(0, input.delivered);
  const opens = Math.max(0, input.opens);
  const clicks = Math.max(0, input.clicks);
  const rate = (num: number, den: number) =>
    den > 0 ? Math.min(1, num / den) : null;
  return {
    openRate: rate(opens, delivered),
    clickRate: rate(clicks, delivered),
    ctor: rate(clicks, opens),
  };
}

/** Per-channel rates: opens are email-only; clicks are email / app push / web push. */
export function engagementRatesForChannel(
  channel: string,
  input: { delivered: number; opens: number; clicks: number },
): { openRate: number | null; clickRate: number | null; ctor: number | null } {
  const rates = engagementRates(input);
  return {
    openRate: isOpenTrackedAgentChannel(channel) ? rates.openRate : null,
    clickRate: isClickTrackedAgentChannel(channel) ? rates.clickRate : null,
    ctor: isOpenTrackedAgentChannel(channel) ? rates.ctor : null,
  };
}

type RunRow = {
  selected: number;
  sent: number;
  failed: number;
  bounced: number;
  opens: number;
  clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
  currency: string | null;
  network: string | null;
};

function emptyRun(): RunRow {
  return {
    selected: 0,
    sent: 0,
    failed: 0,
    bounced: 0,
    opens: 0,
    clicks: 0,
    impressions: 0,
    spend: 0,
    conversions: 0,
    currency: null,
    network: null,
  };
}

function readRunMap(launchPlan: unknown): Record<string, RunRow> {
  const plan =
    launchPlan && typeof launchPlan === "object"
      ? (launchPlan as Record<string, unknown>)
      : {};
  const run =
    plan.channel_run && typeof plan.channel_run === "object"
      ? (plan.channel_run as Record<string, unknown>)
      : {};
  const out: Record<string, RunRow> = {};
  for (const [rawKey, value] of Object.entries(run)) {
    if (!value || typeof value !== "object") continue;
    const key = toAgentChannel(rawKey);
    if (!key) continue;
    const row = value as Record<string, unknown>;
    const prev = out[key] || emptyRun();
    out[key] = {
      selected:
        prev.selected +
        (typeof row.selected === "number"
          ? row.selected
          : typeof row.recipient_count === "number"
            ? row.recipient_count
            : 0),
      sent: prev.sent + (typeof row.sent === "number" ? row.sent : 0),
      failed: prev.failed + (typeof row.failed === "number" ? row.failed : 0),
      bounced:
        prev.bounced + (typeof row.bounced === "number" ? row.bounced : 0),
      opens: prev.opens + (typeof row.opens === "number" ? row.opens : 0),
      clicks: prev.clicks + (typeof row.clicks === "number" ? row.clicks : 0),
      impressions:
        prev.impressions +
        (typeof row.impressions === "number" ? row.impressions : 0),
      spend: prev.spend + (typeof row.spend === "number" ? row.spend : 0),
      conversions:
        prev.conversions +
        (typeof row.conversions === "number" ? row.conversions : 0),
      currency:
        prev.currency ||
        (typeof row.currency === "string" && row.currency.trim()
          ? row.currency.trim()
          : null),
      network:
        prev.network ||
        (typeof row.network === "string" && row.network.trim()
          ? row.network.trim()
          : null),
    };
  }
  return out;
}

type LiveChannelCounts = {
  selected: number;
  sent: number;
  failed: number;
  bounced: number;
  pending: number;
  stub: number;
  /** Distinct recipients with an open / click. */
  opens: number;
  clicks: number;
  /** Every hit, repeats included. */
  totalOpens: number;
  totalClicks: number;
};

/**
 * Aggregate recipient statuses per campaign + channel for many campaigns.
 */
export async function loadLiveSendCountsByCampaign(
  campaignIds: string[],
): Promise<Map<string, Map<string, LiveChannelCounts>>> {
  const out = new Map<string, Map<string, LiveChannelCounts>>();
  const ids = [...new Set(campaignIds.filter(Boolean))];
  if (!ids.length) return out;

  const batches = await prisma.campaignSendBatch.findMany({
    where: { campaignId: { in: ids } },
    select: { id: true, campaignId: true, channel: true },
  });
  if (!batches.length) return out;

  const batchChannel = new Map<string, { campaignId: string; channel: string }>();
  for (const b of batches) {
    batchChannel.set(b.id, {
      campaignId: b.campaignId,
      channel: toAgentChannel(b.channel),
    });
  }

  const recs = await prisma.campaignSendRecipient.findMany({
    where: { batchId: { in: batches.map((b) => b.id) } },
    select: {
      batchId: true,
      status: true,
      skipFailReason: true,
      providerMessageId: true,
      openCount: true,
      clickCount: true,
      openedAt: true,
      clickedAt: true,
    },
  });

  for (const rec of recs) {
    const meta = batchChannel.get(rec.batchId);
    if (!meta?.channel) continue;
    let byChannel = out.get(meta.campaignId);
    if (!byChannel) {
      byChannel = new Map();
      out.set(meta.campaignId, byChannel);
    }
    const prev = byChannel.get(meta.channel) || {
      selected: 0,
      sent: 0,
      failed: 0,
      bounced: 0,
      pending: 0,
      stub: 0,
      opens: 0,
      clicks: 0,
      totalOpens: 0,
      totalClicks: 0,
    };
    prev.selected += 1;
    const bounced = isBounceRecipient({
      status: rec.status,
      skipFailReason: rec.skipFailReason,
    });
    if (bounced) prev.bounced += 1;
    const outcome = recipientDeliveryOutcome({
      status: rec.status,
      providerMessageId: rec.providerMessageId,
    });
    if (outcome === "sent") prev.sent += 1;
    else if (outcome === "stub") prev.stub += 1;
    else if (outcome === "failed" || outcome === "skipped") prev.failed += 1;
    else prev.pending += 1;
    const openHits =
      rec.openCount > 0 ? rec.openCount : rec.openedAt != null ? 1 : 0;
    const clickHits =
      rec.clickCount > 0 ? rec.clickCount : rec.clickedAt != null ? 1 : 0;
    if (openHits > 0) prev.opens += 1;
    if (clickHits > 0) prev.clicks += 1;
    prev.totalOpens += openHits;
    prev.totalClicks += clickHits;
    byChannel.set(meta.channel, prev);
  }

  return out;
}

function readPlanSelected(launchPlan: unknown, channel: string): number {
  const plan =
    launchPlan && typeof launchPlan === "object"
      ? (launchPlan as Record<string, unknown>)
      : {};
  const key = toAgentChannel(channel);
  if (key === "email") {
    const emailSend =
      plan.email_send && typeof plan.email_send === "object"
        ? (plan.email_send as Record<string, unknown>)
        : {};
    if (typeof emailSend.recipient_count === "number") {
      return emailSend.recipient_count;
    }
  }
  const pushSend =
    plan.push_send && typeof plan.push_send === "object"
      ? (plan.push_send as Record<string, unknown>)
      : {};
  if (typeof pushSend.recipient_count === "number") {
    return pushSend.recipient_count;
  }
  const run =
    plan.channel_run && typeof plan.channel_run === "object"
      ? (plan.channel_run as Record<string, unknown>)
      : {};
  const row = run[key];
  if (row && typeof row === "object") {
    const r = row as Record<string, unknown>;
    if (typeof r.selected === "number") return r.selected;
    if (typeof r.recipient_count === "number") return r.recipient_count;
  }
  return 0;
}

function mergeChannelMetrics(
  channel: string,
  run: RunRow | undefined,
  live: LiveChannelCounts | undefined,
  opts?: { audienceCount?: number; launchPlan?: unknown },
): ChannelMetricTotals {
  const base = run || emptyRun();
  /** Stub/pending-only live rows must not wipe channel_run delivered counts. */
  const liveHasDelivery = Boolean(live && live.sent + live.failed > 0);
  const liveHasRecipients = Boolean(live && live.selected > 0);
  const sent = liveHasDelivery && live ? live.sent : base.sent;
  let failed = liveHasDelivery && live ? live.failed : base.failed;
  let bounced =
    liveHasDelivery && live
      ? live.bounced
      : base.bounced;
  const stubSent = live?.stub ?? 0;
  /** channel_run rows have no repeat tracking: one hit per recipient. */
  const opens = liveHasDelivery && live ? live.opens : base.opens;
  const clicks = liveHasDelivery && live ? live.clicks : base.clicks;
  const totalOpens = liveHasDelivery && live ? live.totalOpens : base.opens;
  const totalClicks = liveHasDelivery && live ? live.totalClicks : base.clicks;
  if (channel === "email" && bounced > 0 && failed >= bounced) {
    failed -= bounced;
  } else if (channel === "email" && bounced === 0 && base.bounced > 0) {
    bounced = base.bounced;
    if (failed >= bounced) failed -= bounced;
  }
  let selected = 0;
  if (liveHasRecipients && live) {
    selected = live.selected;
  } else if (base.selected > 0) {
    selected = base.selected;
  } else {
    const planSelected = readPlanSelected(opts?.launchPlan, channel);
    if (planSelected > 0) selected = planSelected;
    else if ((opts?.audienceCount ?? 0) > 0) {
      selected = opts!.audienceCount!;
    } else {
      selected = Math.max(sent + failed + bounced + stubSent, base.sent + base.failed);
    }
  }
  if (selected > 0 && selected < sent + failed + bounced) {
    selected = sent + failed + bounced + (live?.pending ?? 0) + stubSent;
  }
  return {
    channel,
    selected,
    sent,
    failed,
    bounced,
    delivered: Math.max(0, sent),
    opens: sent > 0 ? Math.min(opens, sent) : opens,
    totalOpens,
    clicks: sent > 0 ? Math.min(clicks, sent) : clicks,
    totalClicks,
    impressions: base.impressions,
    spend: base.spend,
    conversions: base.conversions,
    currency: base.currency,
    network: base.network,
    fromLiveSends: liveHasDelivery,
    stubSent,
  };
}

export function buildCampaignMetricTotals(
  launchPlan: unknown,
  channelIds: string[],
  liveByChannel?: Map<string, LiveChannelCounts> | null,
  audienceCount = 0,
): CampaignMetricTotals {
  const runMap = readRunMap(launchPlan);
  const keys = new Set<string>();
  for (const c of channelIds) {
    const k = toAgentChannel(c);
    if (k) keys.add(k);
  }
  for (const k of Object.keys(runMap)) keys.add(k);
  if (liveByChannel) {
    for (const k of liveByChannel.keys()) keys.add(k);
  }

  const channels: ChannelMetricTotals[] = [...keys]
    .filter(Boolean)
    .sort()
    .map((ch) =>
      mergeChannelMetrics(ch, runMap[ch], liveByChannel?.get(ch), {
        audienceCount,
        launchPlan,
      }),
    );

  let sent = 0;
  let failed = 0;
  let stubSent = 0;
  let opens = 0;
  let clicks = 0;
  let totalOpens = 0;
  let totalClicks = 0;
  let messagingDelivered = 0;
  let openTrackedDelivered = 0;
  let openTrackedOpens = 0;
  let openTrackedClicks = 0;
  let clickTrackedDelivered = 0;
  let clickTrackedClicks = 0;
  let impressions = 0;
  let spend = 0;
  let conversions = 0;
  let currency: string | null = null;
  let hasPpc = false;
  let emailSent = 0;
  let emailOpens = 0;
  let emailClicks = 0;

  for (const ch of channels) {
    sent += ch.sent;
    failed += ch.failed;
    stubSent += ch.stubSent;
    opens += ch.opens;
    clicks += ch.clicks;
    totalOpens += ch.totalOpens;
    totalClicks += ch.totalClicks;
    impressions += ch.impressions;
    spend += ch.spend;
    conversions += ch.conversions;
    if (!currency && ch.currency) currency = ch.currency;
    if (ch.channel === "ppc" || ch.impressions > 0 || ch.spend > 0) {
      hasPpc = true;
    } else {
      messagingDelivered += ch.delivered;
    }
    if (isOpenTrackedAgentChannel(ch.channel)) {
      openTrackedDelivered += ch.delivered;
      openTrackedOpens += ch.opens;
      openTrackedClicks += ch.clicks;
    }
    if (isClickTrackedAgentChannel(ch.channel)) {
      clickTrackedDelivered += ch.delivered;
      clickTrackedClicks += ch.clicks;
    }
    if (ch.channel === "email") {
      emailSent += ch.sent;
      emailOpens += ch.opens;
      emailClicks += ch.clicks;
    }
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

  return {
    sent,
    failed,
    delivered: messagingDelivered,
    opens,
    totalOpens,
    clicks,
    totalClicks,
    impressions,
    spend,
    conversions,
    currency,
    hasPpc,
    emailSent,
    emailOpens,
    emailClicks,
    stubSent,
    openRate: openRates.openRate,
    clickRate: clickRates.clickRate,
    ctor: openRates.ctor,
    channels,
  };
}

export async function loadCampaignMetricsMap(
  rows: Array<{
    id: string;
    launchPlan: unknown;
    audienceCount?: number;
    channels?: Array<{ channel: string }>;
  }>,
): Promise<Map<string, CampaignMetricTotals>> {
  const live = await loadLiveSendCountsByCampaign(rows.map((r) => r.id));
  const map = new Map<string, CampaignMetricTotals>();
  for (const row of rows) {
    map.set(
      row.id,
      buildCampaignMetricTotals(
        row.launchPlan,
        (row.channels || []).map((c) => c.channel),
        live.get(row.id) || null,
        row.audienceCount ?? 0,
      ),
    );
  }
  return map;
}
