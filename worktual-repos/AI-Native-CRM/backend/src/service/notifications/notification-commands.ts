/**
 * Framework-agnostic notification bell commands (no "use server" / next/cache).
 * Mirrors legacy Next notifications/actions.ts so the Fastify strangler API can
 * reuse the exact same RBAC and shape without depending on Next server actions.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import {
  clearNotificationsForUser,
  countUnreadNotifications,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/dao/notifications/notification-store";
import { publishUserNotification } from "@/service/notifications/notification-events";

export type NotificationView = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  contactId: string | null;
  readAt: string | null;
  createdAt: string;
};

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    contactId: row.contactId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listMyNotificationsCommand(options?: {
  limit?: number;
}): Promise<
  | { ok: true; items: NotificationView[]; unreadCount: number }
  | { ok: false; error: string }
> {
  try {
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };
    const [items, unreadCount] = await Promise.all([
      listNotificationsForUser(userId, { limit: options?.limit ?? 30 }),
      countUnreadNotifications(userId),
    ]);
    return { ok: true, items: items.map(toView), unreadCount };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load notifications.",
    };
  }
}

export async function markNotificationReadCommand(
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };
    await markNotificationRead(userId, notificationId);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark as read.",
    };
  }
}

export async function markAllNotificationsReadCommand(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  try {
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };
    const count = await markAllNotificationsRead(userId);
    publishUserNotification({ userId });
    return { ok: true, count };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark all as read.",
    };
  }
}

export async function clearAllNotificationsCommand(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  try {
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };
    const count = await clearNotificationsForUser(userId);
    publishUserNotification({ userId });
    return { ok: true, count };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to clear notifications.",
    };
  }
}
