// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import { prisma } from "../plugins/prisma.js";
import { campaignContactIdFromCdp } from "../helpers/id-schema.js";
import { isOpenTrackedAgentChannel } from "../helpers/channel-ids.js";
import { invalidateDashboardMetricsCache } from "../helpers/dashboard-metrics-cache.js";

export type CampaignContactEngagementView = {
  contact_id: string;
  email_unsubscribed: boolean;
  email_unsubscribed_at: string | null;
  email_unsubscribe_reason: string | null;
  last_email_opened_at: string | null;
  last_email_clicked_at: string | null;
  email_open_count: number;
  email_click_count: number;
};

function toView(row: {
  contactId: string;
  emailUnsubscribed: boolean;
  emailUnsubscribedAt: Date | null;
  emailUnsubscribeReason: string | null;
  lastEmailOpenedAt: Date | null;
  lastEmailClickedAt: Date | null;
  emailOpenCount: number;
  emailClickCount: number;
}): CampaignContactEngagementView {
  return {
    contact_id: row.contactId,
    email_unsubscribed: row.emailUnsubscribed,
    email_unsubscribed_at: row.emailUnsubscribedAt?.toISOString() ?? null,
    email_unsubscribe_reason: row.emailUnsubscribeReason,
    last_email_opened_at: row.lastEmailOpenedAt?.toISOString() ?? null,
    last_email_clicked_at: row.lastEmailClickedAt?.toISOString() ?? null,
    email_open_count: row.emailOpenCount,
    email_click_count: row.emailClickCount,
  };
}

export async function listEmailUnsubscribedContactIds(
  organizationId: string,
): Promise<Set<string>> {
  const rows = await prisma.campaignContactEngagement.findMany({
    where: { organizationId, emailUnsubscribed: true },
    select: { contactId: true },
  });
  return new Set(rows.map((r) => r.contactId));
}

export async function getEngagementMap(
  organizationId: string,
  contactIds: string[],
): Promise<Map<string, CampaignContactEngagementView>> {
  if (!contactIds.length) return new Map();

  const cdpByCampaign = new Map<string, string[]>();
  const campaignIds: string[] = [];
  for (const raw of contactIds) {
    const cdpId = String(raw || "").trim();
    if (!cdpId) continue;
    const campaignId = campaignContactIdFromCdp(cdpId);
    campaignIds.push(campaignId);
    const bucket = cdpByCampaign.get(campaignId) ?? [];
    bucket.push(cdpId);
    cdpByCampaign.set(campaignId, bucket);
  }
  if (!campaignIds.length) return new Map();

  const rows = await prisma.campaignContactEngagement.findMany({
    where: { organizationId, contactId: { in: [...new Set(campaignIds)] } },
  });

  const map = new Map<string, CampaignContactEngagementView>();
  for (const row of rows) {
    const view = toView(row);
    const keys = cdpByCampaign.get(String(row.contactId)) ?? [String(row.contactId)];
    for (const key of keys) {
      map.set(key, { ...view, contact_id: key });
    }
  }
  return map;
}

export async function getEngagementForContact(
  organizationId: string,
  contactId: string,
): Promise<CampaignContactEngagementView | null> {
  const campaignId = campaignContactIdFromCdp(contactId);
  const row = await prisma.campaignContactEngagement.findUnique({
    where: {
      organizationId_contactId: { organizationId, contactId: campaignId },
    },
  });
  if (!row) return null;
  const view = toView(row);
  return { ...view, contact_id: String(contactId).trim() || view.contact_id };
}

/** Mark a send recipient as opened; email pixel only — never counts as an app/web tap. */
export async function markRecipientOpened(recipientId: string): Promise<boolean> {
  const row = await prisma.campaignSendRecipient.findFirst({
    where: { id: recipientId },
    select: {
      id: true,
      openedAt: true,
      contactId: true,
      organizationId: true,
      batch: { select: { channel: true } },
    },
  });
  if (!row) return false;
  if (!isOpenTrackedAgentChannel(row.batch?.channel || "")) return false;
  const now = new Date();
  await prisma.campaignSendRecipient.update({
    where: { id: row.id },
    data: {
      openCount: { increment: 1 },
      openedAt: row.openedAt ?? now,
    },
  });
  if (row.contactId) {
    await recordEmailOpen(row.organizationId, row.contactId).catch(() => undefined);
  }
  await invalidateDashboardMetricsCache(String(row.organizationId)).catch(
    () => undefined,
  );
  return true;
}

/**
 * Mark a send recipient as clicked.
 * Always: this row's clickCount / clickedAt (the sending channel).
 * Email only: also open + campaign_contact_engagement email_* counters.
 * App/web tap never increments email_open_count / email_click_count.
 */
export async function markRecipientClicked(recipientId: string): Promise<boolean> {
  const row = await prisma.campaignSendRecipient.findFirst({
    where: { id: recipientId },
    select: {
      id: true,
      openedAt: true,
      clickedAt: true,
      contactId: true,
      organizationId: true,
      batch: { select: { channel: true } },
    },
  });
  if (!row) return false;
  const now = new Date();
  const isEmail = isOpenTrackedAgentChannel(row.batch?.channel || "");
  await prisma.campaignSendRecipient.update({
    where: { id: row.id },
    data: {
      clickCount: { increment: 1 },
      clickedAt: row.clickedAt ?? now,
      ...(isEmail
        ? {
            openedAt: row.openedAt ?? now,
            ...(row.openedAt ? {} : { openCount: { increment: 1 } }),
          }
        : {}),
    },
  });
  if (isEmail && row.contactId) {
    await recordEmailClick(row.organizationId, row.contactId).catch(() => undefined);
    if (!row.openedAt) {
      await recordEmailOpen(row.organizationId, row.contactId).catch(() => undefined);
    }
  }
  await invalidateDashboardMetricsCache(String(row.organizationId)).catch(
    () => undefined,
  );
  return true;
}

export async function recordEmailOpen(
  organizationId: string,
  contactId: string,
): Promise<CampaignContactEngagementView> {
  const now = new Date();
  const row = await prisma.campaignContactEngagement.upsert({
    where: { organizationId_contactId: { organizationId, contactId } },
    create: {
      organizationId,
      contactId,
      lastEmailOpenedAt: now,
      emailOpenCount: 1,
    },
    update: {
      lastEmailOpenedAt: now,
      emailOpenCount: { increment: 1 },
    },
  });
  return toView(row);
}

export async function recordEmailClick(
  organizationId: string,
  contactId: string,
): Promise<CampaignContactEngagementView> {
  const now = new Date();
  const row = await prisma.campaignContactEngagement.upsert({
    where: { organizationId_contactId: { organizationId, contactId } },
    create: {
      organizationId,
      contactId,
      lastEmailClickedAt: now,
      emailClickCount: 1,
    },
    update: {
      lastEmailClickedAt: now,
      emailClickCount: { increment: 1 },
    },
  });
  return toView(row);
}

export async function markEmailUnsubscribed(
  organizationId: string,
  contactId: string,
  reason = "user_link",
): Promise<CampaignContactEngagementView> {
  const now = new Date();
  const row = await prisma.campaignContactEngagement.upsert({
    where: { organizationId_contactId: { organizationId, contactId } },
    create: {
      organizationId,
      contactId,
      emailUnsubscribed: true,
      emailUnsubscribedAt: now,
      emailUnsubscribeReason: reason,
    },
    update: {
      emailUnsubscribed: true,
      emailUnsubscribedAt: now,
      emailUnsubscribeReason: reason,
    },
  });
  return toView(row);
}

/**
 * Public unsubscribe from a send recipient id: engagement flag + email suppression.
 * Idempotent — safe for repeated GET/POST (one-click List-Unsubscribe).
 */
export async function markRecipientEmailUnsubscribed(
  recipientId: string,
  reason = "user_link",
): Promise<boolean> {
  const row = await prisma.campaignSendRecipient.findFirst({
    where: { id: recipientId },
    select: {
      id: true,
      email: true,
      contactId: true,
      organizationId: true,
      batch: { select: { channel: true } },
    },
  });
  if (!row) return false;
  const channel = String(row.batch?.channel || "email").toLowerCase();
  if (channel && channel !== "email") return false;

  if (row.contactId) {
    await markEmailUnsubscribed(row.organizationId, row.contactId, reason);
  }

  const email = String(row.email || "")
    .trim()
    .toLowerCase();
  if (email) {
    await prisma.emailSuppression.upsert({
      where: {
        organizationId_email: {
          organizationId: row.organizationId,
          email,
        },
      },
      create: {
        organizationId: row.organizationId,
        email,
        reason: "unsubscribe",
      },
      update: { reason: "unsubscribe" },
    });
  }

  return Boolean(row.contactId || email);
}
