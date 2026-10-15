// @ts-nocheck — worktual_bigint Prisma BigInt ids
/**
 * Daily campaign report data aggregation — activity window scoped by org + UTC range.
 */
import { prisma } from "../plugins/prisma.js";
import {
  engagementRates,
  engagementRatesForChannel,
} from "./campaign-metrics.js";
import {
  isClickTrackedAgentChannel,
  isOpenTrackedAgentChannel,
  toAgentChannel,
} from "../helpers/channel-ids.js";
import { recipientDeliveryOutcome } from "../helpers/send-status.js";
import {
  DEFAULT_LAUNCH_TIMEZONE,
  formatLaunchLabel,
  normalizeTimezone,
} from "../helpers/campaign-timezone.js";
import type {
  AttentionItem,
  CampaignActivityRow,
  ChannelPerformanceRow,
  ContactActivitySummary,
  CurrentCampaignStatus,
  OverallSummary,
  ScheduledCampaignRow,
  WhatsAppTemplateActivity,
} from "../services/daily-report/types.js";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  push: "App Push",
  web: "Web Push",
  ppc: "PPC",
};

function userTenant(organizationId: string, userId: string) {
  return { organizationId, createdByUserId: userId };
}

async function loadUserCampaignIds(
  organizationId: string,
  userId: string,
): Promise<string[]> {
  const rows = await prisma.campaign.findMany({
    where: userTenant(organizationId, userId),
    select: { id: true },
  });
  return rows.map((row) => String(row.id));
}

export async function resolveOrganizationTimezone(
  organizationId: string,
  userId?: string,
): Promise<string> {
  const row = await prisma.campaign.findFirst({
    where: userId
      ? userTenant(organizationId, userId)
      : { organizationId },
    orderBy: { updatedAt: "desc" },
    select: { timezone: true },
  });
  return normalizeTimezone(row?.timezone || DEFAULT_LAUNCH_TIMEZONE);
}

type ActivityCounts = {
  sent: number;
  delivered: number;
  failed: number;
  opens: number;
  clicks: number;
  processed: number;
};

function emptyActivity(): ActivityCounts {
  return { sent: 0, delivered: 0, failed: 0, opens: 0, clicks: 0, processed: 0 };
}

function accumulateRecipient(
  acc: ActivityCounts,
  rec: {
    status?: string | null;
    skipFailReason?: string | null;
    providerMessageId?: string | null;
    openCount?: number;
    clickCount?: number;
    openedAt?: Date | null;
    clickedAt?: Date | null;
  },
) {
  acc.processed += 1;
  const outcome = recipientDeliveryOutcome({
    status: rec.status,
    providerMessageId: rec.providerMessageId,
  });
  if (outcome === "sent") {
    acc.sent += 1;
    acc.delivered += 1;
  } else if (outcome === "failed" || outcome === "skipped") {
    acc.failed += 1;
  }
  const openHits =
    (rec.openCount ?? 0) > 0 ? rec.openCount! : rec.openedAt != null ? 1 : 0;
  const clickHits =
    (rec.clickCount ?? 0) > 0 ? rec.clickCount! : rec.clickedAt != null ? 1 : 0;
  if (openHits > 0) acc.opens += 1;
  if (clickHits > 0) acc.clicks += 1;
}

export async function aggregatePeriodMessagingStats(input: {
  organizationId: string;
  userId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<{
  byChannel: Map<string, ActivityCounts>;
  byCampaign: Map<string, ActivityCounts>;
  totals: ActivityCounts;
}> {
  const byChannel = new Map<string, ActivityCounts>();
  const byCampaign = new Map<string, ActivityCounts>();
  const totals = emptyActivity();

  const campaignIds = await loadUserCampaignIds(
    input.organizationId,
    input.userId,
  );
  if (!campaignIds.length) {
    return { byChannel, byCampaign, totals };
  }

  const batches = await prisma.campaignSendBatch.findMany({
    where: {
      organizationId: input.organizationId,
      campaignId: { in: campaignIds },
    },
    select: { id: true, campaignId: true, channel: true },
  });
  if (!batches.length) {
    return { byChannel, byCampaign, totals };
  }

  const batchMeta = new Map<string, { campaignId: string; channel: string }>();
  for (const b of batches) {
    batchMeta.set(String(b.id), {
      campaignId: String(b.campaignId),
      channel: toAgentChannel(b.channel),
    });
  }

  const recs = await prisma.campaignSendRecipient.findMany({
    where: {
      organizationId: input.organizationId,
      batchId: { in: batches.map((b) => b.id) },
      updatedAt: { gte: input.windowStart, lt: input.windowEnd },
    },
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
    const meta = batchMeta.get(String(rec.batchId));
    if (!meta) continue;
    const chKey = meta.channel || "email";
    if (!byChannel.has(chKey)) byChannel.set(chKey, emptyActivity());
    if (!byCampaign.has(meta.campaignId)) {
      byCampaign.set(meta.campaignId, emptyActivity());
    }
    accumulateRecipient(byChannel.get(chKey)!, rec);
    accumulateRecipient(byCampaign.get(meta.campaignId)!, rec);
    accumulateRecipient(totals, rec);
  }

  return { byChannel, byCampaign, totals };
}

export async function loadCampaignActivityRows(input: {
  organizationId: string;
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  byCampaign: Map<string, ActivityCounts>;
}): Promise<CampaignActivityRow[]> {
  const ids = [...input.byCampaign.keys()].filter(Boolean);
  if (!ids.length) return [];

  const campaigns = await prisma.campaign.findMany({
    where: {
      ...userTenant(input.organizationId, input.userId),
      id: { in: ids },
    },
    select: {
      id: true,
      name: true,
      status: true,
      audienceCount: true,
      startsAt: true,
      updatedAt: true,
      channels: { select: { channel: true } },
    },
  });

  return campaigns
    .map((c) => {
      const stats = input.byCampaign.get(String(c.id)) || emptyActivity();
      return {
        campaignId: String(c.id),
        name: c.name,
        channels: c.channels.map((ch) => toAgentChannel(ch.channel)),
        status: String(c.status),
        audienceCount: c.audienceCount ?? 0,
        contactsProcessed: stats.processed,
        messagesSent: stats.sent + stats.failed,
        delivered: stats.delivered,
        failed: stats.failed,
        startedAt: c.startsAt?.toISOString() ?? null,
        completedAt:
          c.status === "completed" ? c.updatedAt?.toISOString() ?? null : null,
      };
    })
    .sort((a, b) => b.messagesSent - a.messagesSent);
}

function readChannelPaused(launchPlan: unknown, channel: string): boolean {
  const plan =
    launchPlan && typeof launchPlan === "object"
      ? (launchPlan as Record<string, unknown>)
      : {};
  const run =
    plan.channel_run && typeof plan.channel_run === "object"
      ? (plan.channel_run as Record<string, unknown>)
      : {};
  const row = run[toAgentChannel(channel)];
  if (!row || typeof row !== "object") return false;
  return Boolean((row as Record<string, unknown>).paused);
}

export async function loadCurrentCampaignStatus(
  organizationId: string,
  userId: string,
): Promise<CurrentCampaignStatus> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      ...userTenant(organizationId, userId),
      status: { in: ["live", "scheduled", "completed", "cancelled"] },
    },
    select: {
      id: true,
      name: true,
      status: true,
      launchPlan: true,
      launchLocalDate: true,
      launchLocalTime: true,
      timezone: true,
      startsAt: true,
      audienceCount: true,
      channels: { select: { channel: true, status: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const active: CurrentCampaignStatus["active"] = [];
  const scheduled: CurrentCampaignStatus["scheduled"] = [];
  const paused: CurrentCampaignStatus["paused"] = [];
  const failed: CurrentCampaignStatus["failed"] = [];
  const cancelled: CurrentCampaignStatus["cancelled"] = [];

  for (const c of campaigns) {
    const channels = c.channels.map((ch) => toAgentChannel(ch.channel));
    const base = { id: String(c.id), name: c.name, channels };
    if (c.status === "live") {
      const pauseReasons: string[] = [];
      for (const ch of c.channels) {
        if (
          ch.status?.toLowerCase() === "paused" ||
          readChannelPaused(c.launchPlan, ch.channel)
        ) {
          pauseReasons.push(toAgentChannel(ch.channel));
        }
      }
      if (pauseReasons.length) {
        paused.push({
          ...base,
          reason: `Paused channels: ${pauseReasons.join(", ")}`,
        });
      } else {
        active.push(base);
      }
    } else if (c.status === "scheduled") {
      scheduled.push({
        ...base,
        launchLabel: formatLaunchLabel({
          timezone: normalizeTimezone(c.timezone),
          launchLocalDate: c.launchLocalDate,
          launchLocalTime: c.launchLocalTime,
          startsAt: c.startsAt?.toISOString() ?? null,
        }),
      });
    } else if (c.status === "cancelled") {
      cancelled.push(base);
    }
  }

  // Failed = live/completed with high failure in launch_plan channel_run
  const recent = await prisma.campaign.findMany({
    where: {
      ...userTenant(organizationId, userId),
      status: { in: ["live", "completed"] },
    },
    select: { id: true, name: true, launchPlan: true, channels: { select: { channel: true } } },
    take: 50,
    orderBy: { updatedAt: "desc" },
  });
  for (const c of recent) {
    const plan =
      c.launchPlan && typeof c.launchPlan === "object"
        ? (c.launchPlan as Record<string, unknown>)
        : {};
    const run =
      plan.channel_run && typeof plan.channel_run === "object"
        ? (plan.channel_run as Record<string, unknown>)
        : {};
    let totalFailed = 0;
    let totalSent = 0;
    for (const val of Object.values(run)) {
      if (!val || typeof val !== "object") continue;
      const row = val as Record<string, unknown>;
      totalFailed += typeof row.failed === "number" ? row.failed : 0;
      totalSent += typeof row.sent === "number" ? row.sent : 0;
    }
    if (totalFailed > 0 && totalFailed >= Math.max(3, totalSent * 0.25)) {
      failed.push({
        id: String(c.id),
        name: c.name,
        channels: c.channels.map((ch) => toAgentChannel(ch.channel)),
        detail: `${totalFailed} failed message(s) recorded`,
      });
    }
  }

  return { active, scheduled, paused, failed, cancelled };
}

export async function loadScheduledCampaignRows(
  organizationId: string,
  userId: string,
): Promise<ScheduledCampaignRow[]> {
  const rows = await prisma.campaign.findMany({
    where: { ...userTenant(organizationId, userId), status: "scheduled" },
    select: {
      id: true,
      name: true,
      audienceCount: true,
      launchLocalDate: true,
      launchLocalTime: true,
      timezone: true,
      startsAt: true,
      channels: { select: { channel: true } },
    },
    orderBy: [{ launchLocalDate: "asc" }, { launchLocalTime: "asc" }],
  });

  return rows.map((c) => ({
    campaignId: String(c.id),
    name: c.name,
    channels: c.channels.map((ch) => toAgentChannel(ch.channel)),
    scheduledAt: formatLaunchLabel({
      timezone: normalizeTimezone(c.timezone),
      launchLocalDate: c.launchLocalDate,
      launchLocalTime: c.launchLocalTime,
      startsAt: c.startsAt?.toISOString() ?? null,
    }),
    expectedContacts: c.audienceCount ?? 0,
  }));
}

export function buildChannelPerformanceRows(
  byChannel: Map<string, ActivityCounts>,
): ChannelPerformanceRow[] {
  const order = ["email", "sms", "whatsapp", "push", "web"];
  const keys = [...new Set([...order, ...byChannel.keys()])].filter((k) =>
    byChannel.has(k),
  );

  return keys.map((channel) => {
    const stats = byChannel.get(channel) || emptyActivity();
    const rates = engagementRatesForChannel(channel, {
      delivered: stats.delivered,
      opens: isOpenTrackedAgentChannel(channel) ? stats.opens : 0,
      clicks: isClickTrackedAgentChannel(channel) ? stats.clicks : 0,
    });
    const deliveryRate =
      stats.sent + stats.failed > 0
        ? stats.delivered / (stats.sent + stats.failed)
        : null;
    return {
      channel,
      label: CHANNEL_LABELS[channel] || channel,
      sent: stats.sent + stats.failed,
      delivered: stats.delivered,
      failed: stats.failed,
      deliveryRate,
      opens: isOpenTrackedAgentChannel(channel) ? stats.opens : null,
      openRate: rates.openRate,
      clicks: isClickTrackedAgentChannel(channel) ? stats.clicks : null,
      clickRate: rates.clickRate,
    };
  });
}

export async function loadContactActivitySummary(input: {
  organizationId: string;
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  contactsReached: number;
  contactsFailed: number;
}): Promise<ContactActivitySummary> {
  const imported = await prisma.campaignSessionTempContact.count({
    where: {
      organizationId: input.organizationId,
      createdAt: { gte: input.windowStart, lt: input.windowEnd },
      session: { createdByUserId: input.userId },
    },
  });

  const audienceAdds = await prisma.campaignAudience.count({
    where: {
      createdAt: { gte: input.windowStart, lt: input.windowEnd },
      campaign: userTenant(input.organizationId, input.userId),
    },
  });

  const userCampaignIds = await loadUserCampaignIds(
    input.organizationId,
    input.userId,
  );
  let unsubscribed = 0;
  if (userCampaignIds.length) {
    const audienceContactIds = await prisma.campaignAudience.findMany({
      where: { campaignId: { in: userCampaignIds } },
      select: { contactId: true },
    });
    const contactIds = [
      ...new Set(audienceContactIds.map((row) => String(row.contactId))),
    ];
    if (contactIds.length) {
      unsubscribed = await prisma.campaignContactEngagement.count({
        where: {
          organizationId: input.organizationId,
          contactId: { in: contactIds },
          emailUnsubscribed: true,
          emailUnsubscribedAt: {
            gte: input.windowStart,
            lt: input.windowEnd,
          },
        },
      });
    }
  }

  return {
    created: imported,
    updated: 0,
    imported,
    addedToCampaigns: audienceAdds,
    reached: input.contactsReached,
    notReached: Math.max(0, input.contactsReached - input.contactsFailed),
    failed: input.contactsFailed,
    unsubscribed,
    duplicates: null,
    noActivity:
      imported + audienceAdds + unsubscribed + input.contactsReached === 0,
  };
}

export async function loadWhatsAppTemplateActivity(input: {
  organizationId: string;
  userId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<WhatsAppTemplateActivity> {
  const rows = await prisma.regulatedChannelTemplate.findMany({
    where: {
      organizationId: input.organizationId,
      createdByUserId: input.userId,
      channel: "whatsapp",
      OR: [
        { submittedAt: { gte: input.windowStart, lt: input.windowEnd } },
        { updatedAt: { gte: input.windowStart, lt: input.windowEnd } },
      ],
    },
    select: {
      name: true,
      status: true,
      rejectedReason: true,
      submittedAt: true,
      updatedAt: true,
    },
  });

  let submitted = 0;
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let activated = 0;
  let deactivated = 0;
  const rejectedDetails: WhatsAppTemplateActivity["rejectedDetails"] = [];

  for (const row of rows) {
    const st = String(row.status || "").toLowerCase();
    const inWindow =
      (row.submittedAt &&
        row.submittedAt >= input.windowStart &&
        row.submittedAt < input.windowEnd) ||
      (row.updatedAt >= input.windowStart && row.updatedAt < input.windowEnd);

    if (!inWindow) continue;

    if (row.submittedAt && row.submittedAt >= input.windowStart && row.submittedAt < input.windowEnd) {
      submitted += 1;
    }
    if (st === "pending") pending += 1;
    else if (st === "approved") approved += 1;
    else if (st === "rejected") {
      rejected += 1;
      rejectedDetails.push({ name: row.name, reason: row.rejectedReason });
    } else if (st === "paused" || st === "disabled") deactivated += 1;
    else if (st === "approved" || st === "draft") activated += 0;
  }

  return {
    submitted,
    pending,
    approved,
    rejected,
    activated,
    deactivated,
    rejectedDetails,
    noActivity: submitted + pending + approved + rejected + deactivated === 0,
  };
}

export async function loadOverallSummary(input: {
  organizationId: string;
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  messagingTotals: ActivityCounts;
}): Promise<Omit<OverallSummary, "noActivity">> {
  const tenant = userTenant(input.organizationId, input.userId);

  const [launched, completed, running, scheduled, cancelled] =
    await Promise.all([
      prisma.campaign.count({
        where: {
          ...tenant,
          OR: [
            { startsAt: { gte: input.windowStart, lt: input.windowEnd } },
            {
              status: "live",
              updatedAt: { gte: input.windowStart, lt: input.windowEnd },
            },
          ],
        },
      }),
      prisma.campaign.count({
        where: {
          ...tenant,
          status: "completed",
          updatedAt: { gte: input.windowStart, lt: input.windowEnd },
        },
      }),
      prisma.campaign.count({ where: { ...tenant, status: "live" } }),
      prisma.campaign.count({ where: { ...tenant, status: "scheduled" } }),
      prisma.campaign.count({
        where: {
          ...tenant,
          status: "cancelled",
          updatedAt: { gte: input.windowStart, lt: input.windowEnd },
        },
      }),
    ]);

  const current = await loadCurrentCampaignStatus(
    input.organizationId,
    input.userId,
  );
  const paused = current.paused.length;
  const failed = current.failed.length;

  const rates = engagementRates({
    delivered: input.messagingTotals.delivered,
    opens: input.messagingTotals.opens,
    clicks: input.messagingTotals.clicks,
  });

  const targeted = await prisma.campaignAudience.count({
    where: {
      createdAt: { lte: input.windowEnd },
      campaign: userTenant(input.organizationId, input.userId),
    },
  });

  return {
    campaignsLaunched: launched,
    campaignsCompleted: completed,
    campaignsRunning: running,
    campaignsScheduled: scheduled,
    campaignsFailed: failed,
    campaignsPaused: paused,
    campaignsCancelled: cancelled,
    contactsTargeted: targeted,
    contactsReached: input.messagingTotals.delivered,
    messagesSent: input.messagingTotals.sent + input.messagingTotals.failed,
    messagesDelivered: input.messagingTotals.delivered,
    messagesFailed: input.messagingTotals.failed,
    deliveryRate:
      input.messagingTotals.sent + input.messagingTotals.failed > 0
        ? input.messagingTotals.delivered /
          (input.messagingTotals.sent + input.messagingTotals.failed)
        : null,
    clickRate: rates.clickRate,
  };
}

export function buildAttentionItems(input: {
  current: CurrentCampaignStatus;
  whatsapp: WhatsAppTemplateActivity;
  scheduled: ScheduledCampaignRow[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const c of input.current.failed) {
    items.push({
      kind: "campaign_failed",
      title: c.name,
      detail: c.detail,
      href: `/campaigns/${c.id}`,
    });
  }
  for (const c of input.current.paused) {
    items.push({
      kind: "campaign_paused",
      title: c.name,
      detail: c.reason || "Campaign channel paused",
      href: `/campaigns/${c.id}`,
    });
  }
  for (const tpl of input.whatsapp.rejectedDetails) {
    items.push({
      kind: "whatsapp_rejected",
      title: tpl.name,
      detail: tpl.reason || "WhatsApp template rejected",
      href: "/campaigns/whatsapp-approvals",
    });
  }
  for (const c of input.scheduled) {
    if (c.scheduledAt === "not set") {
      items.push({
        kind: "schedule_missing",
        title: c.name,
        detail: "Scheduled campaign is missing a launch date/time",
        href: `/campaigns/${c.campaignId}`,
      });
    }
  }

  return items;
}

export function buildDayComparison(
  current: ActivityCounts,
  previous: ActivityCounts,
): import("../services/daily-report/types.js").DayComparison {
  const mk = (
    label: string,
    cur: number,
    prev: number,
  ): import("../services/daily-report/types.js").DayComparisonMetric => {
    const delta = cur - prev;
    const deltaPct = prev > 0 ? delta / prev : null;
    return { label, current: cur, previous: prev, delta, deltaPct };
  };

  const curRates = engagementRates({
    delivered: current.delivered,
    opens: current.opens,
    clicks: current.clicks,
  });
  const prevRates = engagementRates({
    delivered: previous.delivered,
    opens: previous.opens,
    clicks: previous.clicks,
  });

  const curDelivery =
    current.sent + current.failed > 0
      ? current.delivered / (current.sent + current.failed)
      : null;
  const prevDelivery =
    previous.sent + previous.failed > 0
      ? previous.delivered / (previous.sent + previous.failed)
      : null;

  return {
    available: true,
    metrics: [
      mk("Messages sent", current.sent + current.failed, previous.sent + previous.failed),
      mk("Contacts reached", current.delivered, previous.delivered),
      mk("Failed messages", current.failed, previous.failed),
      {
        label: "Delivery rate",
        current: curDelivery,
        previous: prevDelivery,
        delta:
          curDelivery != null && prevDelivery != null
            ? curDelivery - prevDelivery
            : null,
        deltaPct: null,
      },
      {
        label: "Click rate",
        current: curRates.clickRate,
        previous: prevRates.clickRate,
        delta:
          curRates.clickRate != null && prevRates.clickRate != null
            ? curRates.clickRate - prevRates.clickRate
            : null,
        deltaPct: null,
      },
    ],
  };
}
