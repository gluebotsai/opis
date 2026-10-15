// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { AppError } from "../helpers/response-builders.js";
import { campaignContactIdFromCdp } from "../helpers/id-schema.js";
import {
  isClickTrackedAgentChannel,
  isOpenTrackedAgentChannel,
  toAgentChannel,
} from "../helpers/channel-ids.js";
import { recipientDeliveryOutcome } from "../helpers/send-status.js";
import { getContactByIdDao } from "./contact.js";
import { getEngagementForContact } from "./campaign-contact-engagement.js";
import type { RecipientOutcome } from "./campaign-recipients.js";

export type ContactCampaignChannelActivity = {
  channel: string;
  outcome: RecipientOutcome;
  status: string;
  skip_fail_reason: string | null;
  open_count: number | null;
  click_count: number | null;
  opened_at: string | null;
  clicked_at: string | null;
  destination: string | null;
  ab_variant: string | null;
  sent_at: string | null;
};

export type ContactCampaignActivityRow = {
  campaign_id: string;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string | null;
  in_audience: boolean;
  channels_planned: string[];
  outcome: RecipientOutcome;
  channels: ContactCampaignChannelActivity[];
};

export type ContactChannelSummary = {
  sent: number;
  stub: number;
  failed: number;
  skipped: number;
  pending: number;
  opens: number | null;
  clicks: number | null;
  last_opened_at: string | null;
  last_clicked_at: string | null;
};

export type ContactCampaignActivityReport = {
  contact_id: string;
  summary: {
    campaigns_targeted: number;
    campaigns_with_sends: number;
    active_count: number;
    scheduled_count: number;
    past_count: number;
    draft_count: number;
    email_unsubscribed: boolean;
    by_channel: Record<string, ContactChannelSummary>;
  };
  active: ContactCampaignActivityRow[];
  draft: ContactCampaignActivityRow[];
  past: {
    total: number;
    page: number;
    limit: number;
    items: ContactCampaignActivityRow[];
  };
};

function rollupOutcome(
  channels: ContactCampaignChannelActivity[],
): RecipientOutcome {
  if (!channels.length) return "not_sent";
  if (channels.some((c) => c.outcome === "failed")) return "failed";
  if (channels.some((c) => c.outcome === "skipped")) return "skipped";
  if (channels.some((c) => c.outcome === "stub")) return "stub";
  if (channels.some((c) => c.outcome === "sent")) return "sent";
  if (channels.some((c) => c.outcome === "pending")) return "pending";
  return "not_sent";
}

function buildChannelRow(row: {
  status: string;
  skipFailReason: string | null;
  providerMessageId: string | null;
  email: string | null;
  destination: string | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  openCount: number;
  clickCount: number;
  abVariant: string | null;
  updatedAt: Date;
  batch?: { channel?: string | null } | null;
}): ContactCampaignChannelActivity {
  const channel =
    toAgentChannel(row.batch?.channel || "") || row.batch?.channel || "email";
  const outcome = recipientDeliveryOutcome({
    status: row.status,
    providerMessageId: row.providerMessageId,
  });
  const openTracked = isOpenTrackedAgentChannel(channel);
  const clickTracked = isClickTrackedAgentChannel(channel);
  const sentAt =
    outcome === "sent" || outcome === "stub" ? row.updatedAt.toISOString() : null;
  return {
    channel,
    outcome,
    status: row.status,
    skip_fail_reason: row.skipFailReason,
    open_count: openTracked ? row.openCount : null,
    click_count: clickTracked ? row.clickCount : null,
    opened_at: row.openedAt?.toISOString() ?? null,
    clicked_at: row.clickedAt?.toISOString() ?? null,
    destination: row.email || row.destination || null,
    ab_variant: row.abVariant,
    sent_at: sentAt,
  };
}

function buildNotSentChannel(
  channel: string,
  destination: string | null,
): ContactCampaignChannelActivity {
  return {
    channel,
    outcome: "not_sent",
    status: "not_sent",
    skip_fail_reason: "not_in_send_batch",
    open_count: null,
    click_count: null,
    opened_at: null,
    clicked_at: null,
    destination,
    ab_variant: null,
    sent_at: null,
  };
}

function campaignSortKey(row: {
  startsAt: Date | null;
  updatedAt: Date;
  endsAt: Date | null;
}): number {
  const iso =
    row.startsAt?.getTime() ??
    row.endsAt?.getTime() ??
    row.updatedAt.getTime();
  return iso;
}

function buildSummaryByChannel(
  sendRows: Array<{
    status: string;
    providerMessageId: string | null;
    openedAt: Date | null;
    clickedAt: Date | null;
    openCount: number;
    clickCount: number;
    batch?: { channel?: string | null } | null;
  }>,
): Record<string, ContactChannelSummary> {
  const byChannel: Record<string, ContactChannelSummary> = {};

  for (const row of sendRows) {
    const channel =
      toAgentChannel(row.batch?.channel || "") || row.batch?.channel || "email";
    if (!byChannel[channel]) {
      byChannel[channel] = {
        sent: 0,
        stub: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
        opens: isOpenTrackedAgentChannel(channel) ? 0 : null,
        clicks: isClickTrackedAgentChannel(channel) ? 0 : null,
        last_opened_at: null,
        last_clicked_at: null,
      };
    }
    const summary = byChannel[channel];
    const outcome = recipientDeliveryOutcome({
      status: row.status,
      providerMessageId: row.providerMessageId,
    });
    if (outcome === "sent") summary.sent += 1;
    else if (outcome === "stub") summary.stub += 1;
    else if (outcome === "failed") summary.failed += 1;
    else if (outcome === "skipped") summary.skipped += 1;
    else summary.pending += 1;

    if (summary.opens != null) {
      summary.opens += row.openCount;
      if (row.openedAt) {
        const iso = row.openedAt.toISOString();
        if (!summary.last_opened_at || iso > summary.last_opened_at) {
          summary.last_opened_at = iso;
        }
      }
    }
    if (summary.clicks != null) {
      summary.clicks += row.clickCount;
      if (row.clickedAt) {
        const iso = row.clickedAt.toISOString();
        if (!summary.last_clicked_at || iso > summary.last_clicked_at) {
          summary.last_clicked_at = iso;
        }
      }
    }
  }

  return byChannel;
}

export async function getContactCampaignActivityDao(
  session: CampaignSessionUser,
  contactId: string,
  opts?: { pastPage?: number; pastLimit?: number },
): Promise<ContactCampaignActivityReport> {
  const contact = await getContactByIdDao(session, contactId);
  if (!contact) throw new AppError("Contact not found.", 404);

  const campaignContactId = campaignContactIdFromCdp(contactId);
  const pastPage = Math.max(1, opts?.pastPage ?? 1);
  const pastLimit = Math.max(1, Math.min(opts?.pastLimit ?? 20, 100));

  const [audienceRows, sendRows, engagement] = await Promise.all([
    prisma.campaignAudience.findMany({
      where: { contactId: campaignContactId },
      select: { campaignId: true },
    }),
    prisma.campaignSendRecipient.findMany({
      where: {
        contactId: campaignContactId,
        organizationId: session.organizationId,
      },
      include: { batch: { select: { channel: true } } },
      orderBy: { createdAt: "asc" },
    }),
    getEngagementForContact(session.organizationId, contactId).catch(
      () => null,
    ),
  ]);

  const audienceCampaignIds = new Set(
    audienceRows.map((a) => String(a.campaignId)),
  );
  const sendCampaignIds = new Set(sendRows.map((r) => String(r.campaignId)));
  const allCampaignIds = [
    ...new Set([...audienceCampaignIds, ...sendCampaignIds]),
  ];

  if (!allCampaignIds.length) {
    return {
      contact_id: contactId,
      summary: {
        campaigns_targeted: 0,
        campaigns_with_sends: 0,
        active_count: 0,
        scheduled_count: 0,
        past_count: 0,
        draft_count: 0,
        email_unsubscribed: engagement?.email_unsubscribed ?? false,
        by_channel: {},
      },
      active: [],
      draft: [],
      past: { total: 0, page: pastPage, limit: pastLimit, items: [] },
    };
  }

  const campaigns = await prisma.campaign.findMany({
    where: {
      id: { in: allCampaignIds },
      organizationId: session.organizationId,
      branchId: session.branchId,
    },
    include: {
      channels: { select: { channel: true } },
    },
  });

  const sendByCampaign = new Map<string, ContactCampaignChannelActivity[]>();
  for (const row of sendRows) {
    const cid = String(row.campaignId);
    const list = sendByCampaign.get(cid) || [];
    list.push(buildChannelRow(row));
    sendByCampaign.set(cid, list);
  }

  const buildRow = (campaign: (typeof campaigns)[number]): ContactCampaignActivityRow => {
    const cid = String(campaign.id);
    const inAudience = audienceCampaignIds.has(cid);
    const planned = campaign.channels.map(
      (c) => toAgentChannel(c.channel) || c.channel,
    );
    let channels = sendByCampaign.get(cid) || [];

    if (inAudience && !channels.length && planned.length) {
      channels = planned.map((ch) => buildNotSentChannel(ch, null));
    } else if (inAudience && planned.length) {
      const sentChannels = new Set(channels.map((c) => c.channel));
      for (const ch of planned) {
        if (!sentChannels.has(ch)) {
          channels.push(buildNotSentChannel(ch, null));
        }
      }
    }

    return {
      campaign_id: cid,
      name: campaign.name,
      status: campaign.status,
      starts_at: campaign.startsAt?.toISOString() ?? null,
      ends_at: campaign.endsAt?.toISOString() ?? null,
      updated_at: campaign.updatedAt.toISOString(),
      in_audience: inAudience,
      channels_planned: planned,
      outcome: rollupOutcome(channels),
      channels,
    };
  };

  const sorted = [...campaigns].sort(
    (a, b) => campaignSortKey(b) - campaignSortKey(a),
  );

  const active: ContactCampaignActivityRow[] = [];
  const draft: ContactCampaignActivityRow[] = [];
  const pastAll: ContactCampaignActivityRow[] = [];

  for (const campaign of sorted) {
    const row = buildRow(campaign);
    const st = campaign.status;
    if (st === "live") active.push(row);
    else if (st === "scheduled") active.push(row);
    else if (st === "draft") draft.push(row);
    else if (st === "completed" || st === "cancelled") pastAll.push(row);
  }

  const pastOffset = (pastPage - 1) * pastLimit;
  const pastItems = pastAll.slice(pastOffset, pastOffset + pastLimit);

  const campaignsWithSends = new Set(
    sendRows.map((r) => String(r.campaignId)),
  ).size;

  let scheduledCount = 0;
  for (const c of campaigns) {
    if (c.status === "scheduled") scheduledCount += 1;
  }

  return {
    contact_id: contactId,
    summary: {
      campaigns_targeted: campaigns.length,
      campaigns_with_sends: campaignsWithSends,
      active_count: active.filter((r) => r.status === "live").length,
      scheduled_count: scheduledCount,
      past_count: pastAll.length,
      draft_count: draft.length,
      email_unsubscribed: engagement?.email_unsubscribed ?? false,
      by_channel: buildSummaryByChannel(sendRows),
    },
    active,
    draft,
    past: {
      total: pastAll.length,
      page: pastPage,
      limit: pastLimit,
      items: pastItems,
    },
  };
}
