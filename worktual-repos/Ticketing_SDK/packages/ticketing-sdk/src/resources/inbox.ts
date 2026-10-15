import type { HttpClient } from "../http.js";

export type InboxItem = {
  id: string;
  title: string;
  message: string;
  ticketNumber?: string;
  read: boolean;
  createdAt?: string;
  kind?: string;
};

function itemFrom(row: Record<string, unknown>): InboxItem | null {
  const id = String(row.id || "").trim();
  if (!id) return null;
  const ticket = row.ticketNumber || row.ticketId || row.ticket_number;
  return {
    id,
    title: String(row.title || ""),
    message: String(row.message || ""),
    ticketNumber: ticket != null && String(ticket).trim() ? String(ticket) : undefined,
    read: Boolean(row.read ?? row.is_read),
    createdAt: row.createdAt != null ? String(row.createdAt) : undefined,
    kind: row.kind != null ? String(row.kind) : undefined,
  };
}

export function createInboxResource(http: HttpClient) {
  return {
    async list(sessionToken?: string): Promise<{ items: InboxItem[] }> {
      const payload = await http.request<unknown>({
        method: "GET",
        path: "/api/notifications",
        auth: "accessToken",
        accessToken: sessionToken,
      });
      const rows = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
          ? (payload as { items: unknown[] }).items
          : [];
      const items: InboxItem[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const item = itemFrom(row as Record<string, unknown>);
        if (item) items.push(item);
      }
      return { items };
    },

    markRead(id: string, sessionToken?: string): Promise<{ ok: true }> {
      return http.request({
        method: "PATCH",
        path: `/api/notifications/${encodeURIComponent(id)}/read`,
        auth: "accessToken",
        accessToken: sessionToken,
      });
    },

    markAllRead(sessionToken?: string): Promise<{ ok: true }> {
      return http.request({
        method: "POST",
        path: "/api/notifications/read-all",
        auth: "accessToken",
        accessToken: sessionToken,
      });
    },
  };
}
