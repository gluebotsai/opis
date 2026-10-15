// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * Campaign activity → AppNotification emitters (lifecycle, pause, progress).
 */

import { prisma } from "../plugins/prisma.js";
import { upsertAppNotification } from "../dao/notifications.js";

async function campaignContext(campaignId: string) {
  return prisma.campaign.findFirst({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      organizationId: true,
      createdByUserId: true,
      status: true,
    },
  });
}

export async function notifyCampaignStatusChange(args: {
  campaignId: string;
  status: "scheduled" | "live" | "completed";
  priorStatus?: string;
}): Promise<void> {
  const row = await campaignContext(args.campaignId);
  if (!row) return;
  const name = row.name?.trim() || "Campaign";
  const href = `/campaigns/${row.id}`;

  if (args.status === "scheduled") {
    await upsertAppNotification({
      organizationId: row.organizationId,
      userId: row.createdByUserId,
      kind: "campaign_scheduled",
      title: "Campaign scheduled",
      body: `"${name}" is scheduled and waiting for launch.`,
      href,
      sourceKey: `campaign:scheduled:${row.id}`,
    });
    return;
  }

  if (args.status === "live") {
    await upsertAppNotification({
      organizationId: row.organizationId,
      userId: row.createdByUserId,
      kind: "campaign_launched",
      title: "Campaign launched",
      body: `"${name}" is live and sending.`,
      href,
      sourceKey: `campaign:launched:${row.id}`,
    });
    return;
  }

  if (args.status === "completed") {
    await upsertAppNotification({
      organizationId: row.organizationId,
      userId: row.createdByUserId,
      kind: "campaign_completed",
      title: "Campaign completed",
      body: `"${name}" finished sending.`,
      href,
      sourceKey: `campaign:completed:${row.id}`,
    });
  }
}

export async function notifyCampaignStopped(args: {
  campaignId: string;
  campaignName: string;
  organizationId: string;
  userId?: string | null;
  reason?: string | null;
  sent?: number;
  selected?: number;
}): Promise<void> {
  const name = args.campaignName.trim() || "Campaign";
  const reason = String(args.reason || "").trim();
  const sent = args.sent ?? 0;
  const selected = args.selected ?? 0;
  await upsertAppNotification({
    organizationId: args.organizationId,
    userId: args.userId,
    kind: "campaign_stopped",
    title: "Campaign stopped",
    body: reason
      ? `"${name}" stopped (${sent}/${selected} sent): ${reason}`
      : `"${name}" was stopped (${sent}/${selected} sent).`,
    href: `/campaigns/${args.campaignId}`,
    sourceKey: `campaign:stopped:${args.campaignId}`,
    updateExisting: true,
  });
}

export async function notifyCampaignChannelRunState(args: {
  campaignId: string;
  campaignName: string;
  organizationId: string;
  userId?: string | null;
  channel: string;
  paused: boolean;
  reason?: string | null;
}): Promise<void> {
  const ch = args.channel.trim().toLowerCase() || "channel";
  const name = args.campaignName.trim() || "Campaign";
  const href = `/campaigns/${args.campaignId}`;
  if (args.paused) {
    const reason = String(args.reason || "").trim();
    await upsertAppNotification({
      organizationId: args.organizationId,
      userId: args.userId,
      kind: "campaign_channel_paused",
      title: `${ch.toUpperCase()} paused`,
      body: reason
        ? `"${name}" — ${ch} stopped: ${reason}`
        : `"${name}" — ${ch} was stopped.`,
      href,
      sourceKey: `campaign:paused:${args.campaignId}:${ch}`,
      updateExisting: true,
    });
    return;
  }
  await upsertAppNotification({
    organizationId: args.organizationId,
    userId: args.userId,
    kind: "campaign_channel_resumed",
    title: `${ch.toUpperCase()} resumed`,
    body: `"${name}" — ${ch} is sending again.`,
    href,
    sourceKey: `campaign:resumed:${args.campaignId}:${ch}:${Date.now()}`,
  });
}

export async function notifyWhatsAppApproved(args: {
  campaignId: string;
  campaignName: string;
  organizationId: string;
  userId?: string | null;
  templateName: string;
  approvedAt: string;
}): Promise<void> {
  await upsertAppNotification({
    organizationId: args.organizationId,
    userId: args.userId,
    kind: "whatsapp_approved",
    title: "WhatsApp template approved",
    body: `"${args.templateName}" for "${args.campaignName || "Campaign"}" is approved by Meta.`,
    href: `/campaigns/${args.campaignId}`,
    sourceKey: `whatsapp:approved:${args.campaignId}`,
  });
}

/** Library WhatsApp template left pending (Approvals page). */
export async function notifyRegulatedWhatsAppDecision(args: {
  organizationId: string;
  userId?: string | null;
  templateId: string;
  templateName: string;
  status: "approved" | "rejected";
  rejectedReason?: string | null;
}): Promise<void> {
  const name = args.templateName.trim() || "WhatsApp template";
  const href = "/campaigns/create/whatsapp";
  if (args.status === "approved") {
    await upsertAppNotification({
      organizationId: args.organizationId,
      userId: args.userId,
      kind: "whatsapp_approved",
      title: "WhatsApp template approved",
      body: `"${name}" is approved by Meta.`,
      href,
      sourceKey: `whatsapp:library-approved:${args.templateId}`,
    });
    return;
  }
  await upsertAppNotification({
    organizationId: args.organizationId,
    userId: args.userId,
    kind: "template_rejected",
    title: "WhatsApp template rejected",
    body: args.rejectedReason?.trim()
      ? `"${name}" was rejected: ${args.rejectedReason.trim()}`
      : `"${name}" was rejected by Meta.`,
    href,
    sourceKey: `whatsapp:library-rejected:${args.templateId}`,
  });
}

/**
 * Upsert progress / failure notifications for live campaigns (tick).
 */
export async function syncLiveCampaignActivityNotifications(): Promise<number> {
  const live = await prisma.campaign.findMany({
    where: { status: "live" },
    select: {
      id: true,
      name: true,
      organizationId: true,
      createdByUserId: true,
    },
    take: 80,
  });

  let written = 0;
  for (const c of live) {
    const [sent, failed, pending] = await Promise.all([
      prisma.campaignSendRecipient.count({
        where: { campaignId: c.id, status: "sent" },
      }),
      prisma.campaignSendRecipient.count({
        where: { campaignId: c.id, status: "failed" },
      }),
      prisma.campaignSendRecipient.count({
        where: { campaignId: c.id, status: { in: ["pending", "sending"] } },
      }),
    ]);
    const total = sent + failed + pending;
    if (total === 0) continue;
    const name = c.name?.trim() || "Campaign";
    const href = `/campaigns/${c.id}`;
    const pct = Math.round((sent / total) * 100);

    // Milestone progress every ~25%
    const bucket = Math.floor(pct / 25) * 25;
    if (bucket >= 25 && sent > 0) {
      const row = await upsertAppNotification({
        organizationId: c.organizationId,
        userId: c.createdByUserId,
        kind: "campaign_send_progress",
        title: "Send progress",
        body: `"${name}" — ${sent.toLocaleString()} sent (${pct}%).`,
        href,
        sourceKey: `campaign:progress:${c.id}:${bucket}`,
      });
      if (row) written += 1;
    }

    if (failed >= 5) {
      const failBucket = Math.min(Math.floor(failed / 10) * 10, 500);
      const row = await upsertAppNotification({
        organizationId: c.organizationId,
        userId: c.createdByUserId,
        kind: "campaign_failures",
        title: "Delivery failures",
        body: `"${name}" — ${failed.toLocaleString()} contacts failed after retries.`,
        href,
        sourceKey: `campaign:failures:${c.id}:${failBucket}`,
        updateExisting: true,
      });
      if (row) written += 1;
    }
  }
  return written;
}
