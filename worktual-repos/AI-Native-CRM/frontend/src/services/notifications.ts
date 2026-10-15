import { api } from "./api";

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

export async function fetchNotifications(limit = 30) {
  const { data } = await api.get<
    | { ok: true; items: NotificationView[]; unreadCount: number }
    | { ok: false; error: string }
  >("/api/notifications", { params: { limit } });
  return data;
}

export async function markNotificationReadRequest(id: string) {
  const { data } = await api.post<{ ok: true } | { ok: false; error: string }>(
    `/api/notifications/${id}/read`,
  );
  return data;
}

export async function markAllNotificationsReadRequest() {
  const { data } = await api.post<
    { ok: true; count: number } | { ok: false; error: string }
  >("/api/notifications/read-all");
  return data;
}

export async function clearAllNotificationsRequest() {
  const { data } = await api.post<
    { ok: true; count: number } | { ok: false; error: string }
  >("/api/notifications/clear");
  return data;
}
