/**
 * Server-backed in-app notifications API.
 */

import { apiGet, apiPost } from "@/services/api";
import type { AppNotification, NotificationKind } from "@/lib/notifications-store";

type ApiBody<T> = {
  statusCode: number;
  message: string;
} & T;

export type ServerNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  sourceKey: string;
  createdAt: string;
  readAt: string | null;
};

export function mapServerNotification(row: ServerNotification): AppNotification {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    href: row.href,
    createdAt: row.createdAt,
    readAt: row.readAt,
    sourceKey: row.sourceKey,
  };
}

export async function fetchAppNotifications(opts?: {
  limit?: number;
  unreadOnly?: boolean;
}): Promise<{ items: AppNotification[]; unread: number }> {
  const { data } = await apiGet<
    ApiBody<{ items: ServerNotification[]; unread: number }>
  >("/notifications", {
    params: {
      limit: opts?.limit ?? 40,
      ...(opts?.unreadOnly ? { unreadOnly: "1" } : {}),
    },
  });
  const items = (data.items || []).map(mapServerNotification);
  return { items, unread: data.unread ?? items.filter((i) => !i.readAt).length };
}

export async function markAppNotificationReadApi(id: string): Promise<void> {
  await apiPost(`/notifications/${encodeURIComponent(id)}/read`);
}

export async function markAllAppNotificationsReadApi(): Promise<void> {
  await apiPost("/notifications/read-all");
}

export async function createAppNotificationApi(input: {
  kind: NotificationKind | string;
  title: string;
  body: string;
  href?: string | null;
  sourceKey: string;
}): Promise<AppNotification | null> {
  try {
    const { data } = await apiPost<
      ApiBody<{ notification: ServerNotification | null }>
    >("/notifications", input);
    return data.notification ? mapServerNotification(data.notification) : null;
  } catch {
    return null;
  }
}

/** @deprecated Prefer fetchAppNotifications — WA approvals are emitted server-side. */
export async function fetchWhatsAppApprovalNotifications(): Promise<
  Array<{
    id: string;
    campaign_id: string;
    campaign_name: string;
    template_name?: string;
    approved_at: string;
    href?: string | null;
  }>
> {
  try {
    const { data } = await apiGet<
      ApiBody<{
        notifications: Array<{
          id: string;
          campaign_id: string;
          campaign_name: string;
          template_name?: string;
          approved_at: string;
          href?: string | null;
        }>;
      }>
    >("/campaigns/notifications/whatsapp-approvals");
    return data.notifications || [];
  } catch {
    return [];
  }
}
