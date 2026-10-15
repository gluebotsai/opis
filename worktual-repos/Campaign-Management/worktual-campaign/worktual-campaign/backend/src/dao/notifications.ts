// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
/**
 * In-app notifications — upsert by (organizationId, sourceKey), list, mark read.
 */

import { prisma } from "../plugins/prisma.js";
import type { CampaignSessionUser } from "../types/auth.js";

export type AppNotificationKind =
  | "campaign_launched"
  | "campaign_scheduled"
  | "campaign_send_progress"
  | "campaign_failures"
  | "campaign_completed"
  | "campaign_stopped"
  | "campaign_channel_paused"
  | "campaign_channel_resumed"
  | "whatsapp_approved"
  | "send_time_insight"
  | "send_time_mismatch"
  | "template_rejected"
  | "template_expiring"
  | "template_paused"
  | "recommendation_ready"
  | "recommendation_expiry"
  | "recommendation_edit"
  | "system";

export type AppNotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  sourceKey: string;
  createdAt: string;
  readAt: string | null;
};

export type UpsertNotificationInput = {
  organizationId: string;
  userId?: string | null;
  kind: AppNotificationKind | string;
  title: string;
  body: string;
  href?: string | null;
  sourceKey: string;
  /** When true, refresh title/body/href if the row already exists. */
  updateExisting?: boolean;
};

function toPublic(row: {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  sourceKey: string;
  createdAt: Date;
  readAt: Date | null;
}): AppNotificationRow {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    sourceKey: row.sourceKey,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

/** Best-effort upsert — never throws into send paths. */
export async function upsertAppNotification(
  input: UpsertNotificationInput,
): Promise<AppNotificationRow | null> {
  try {
    const sourceKey = String(input.sourceKey || "").trim();
    if (!sourceKey || !input.organizationId) return null;
    const href =
      input.href != null && String(input.href).trim()
        ? String(input.href).trim()
        : null;

    const existing = await prisma.appNotification.findUnique({
      where: {
        organizationId_sourceKey: {
          organizationId: input.organizationId,
          sourceKey,
        },
      },
    });

    if (existing) {
      if (input.updateExisting) {
        const updated = await prisma.appNotification.update({
          where: { id: existing.id },
          data: {
            kind: String(input.kind),
            title: String(input.title).slice(0, 200),
            body: String(input.body).slice(0, 2000),
            href,
            ...(input.userId ? { userId: input.userId } : {}),
          },
        });
        return toPublic(updated);
      }
      return toPublic(existing);
    }

    const created = await prisma.appNotification.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId || null,
        kind: String(input.kind),
        title: String(input.title).slice(0, 200),
        body: String(input.body).slice(0, 2000),
        href,
        sourceKey,
      },
    });
    return toPublic(created);
  } catch {
    return null;
  }
}

export async function listAppNotificationsDao(
  session: CampaignSessionUser,
  opts?: { limit?: number; unreadOnly?: boolean },
): Promise<AppNotificationRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 100);
  try {
    const rows = await prisma.appNotification.findMany({
      where: {
        organizationId: session.organizationId,
        OR: [{ userId: null }, { userId: session.id }],
        ...(opts?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toPublic);
  } catch {
    return [];
  }
}

export async function markAppNotificationReadDao(
  session: CampaignSessionUser,
  id: string,
): Promise<AppNotificationRow | null> {
  const row = await prisma.appNotification.findFirst({
    where: {
      id,
      organizationId: session.organizationId,
      OR: [{ userId: null }, { userId: session.id }],
    },
  });
  if (!row) return null;
  if (row.readAt) return toPublic(row);
  const updated = await prisma.appNotification.update({
    where: { id: row.id },
    data: { readAt: new Date() },
  });
  return toPublic(updated);
}

export async function markAllAppNotificationsReadDao(
  session: CampaignSessionUser,
): Promise<{ updated: number }> {
  const result = await prisma.appNotification.updateMany({
    where: {
      organizationId: session.organizationId,
      readAt: null,
      OR: [{ userId: null }, { userId: session.id }],
    },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

export async function createAppNotificationFromClientDao(
  session: CampaignSessionUser,
  input: {
    kind: string;
    title: string;
    body: string;
    href?: string | null;
    sourceKey: string;
  },
): Promise<AppNotificationRow | null> {
  return upsertAppNotification({
    organizationId: session.organizationId,
    userId: session.id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    href: input.href,
    sourceKey: input.sourceKey,
  });
}
