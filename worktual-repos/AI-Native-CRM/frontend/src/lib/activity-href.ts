/** Deep-link a CRM activity to inbox, calendar, or the activities list. */

export type ActivityRouteInput = {
  id: string;
  type: string;
  threadId?: string | null;
  gmailThreadId?: string | null;
  emailDirection?: "outbound" | "inbound" | null;
  folder?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
};

function isoDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Contact-detail tab that holds this activity type. SMS stays on Overview. */
export function contactDetailTabForActivity(
  type: string | null | undefined,
): "emails" | "calls" | "meetings" | "notes" | "tasks" | null {
  switch ((type || "").toLowerCase()) {
    case "email":
      return "emails";
    case "call":
      return "calls";
    case "meeting":
      return "meetings";
    case "note":
      return "notes";
    case "task":
      return "tasks";
    default:
      return null;
  }
}

/** Open one activity on the matching tab of that contact's detail page. */
export function contactActivityHref(
  contactId: string,
  activityId: string,
  type?: string | null,
): string {
  const params = new URLSearchParams();
  params.set("activity", activityId);
  const tab = contactDetailTabForActivity(type);
  if (tab) params.set("tab", tab);
  return `/contact/${encodeURIComponent(contactId)}?${params.toString()}`;
}

export function hrefForActivity(activity: ActivityRouteInput): string | null {
  const type = (activity.type || "").toLowerCase();
  if (type === "note") return null;
  if (type === "email") {
    const thread =
      activity.threadId?.trim() ||
      activity.gmailThreadId?.trim() ||
      activity.id;
    if (!thread) return null;
    const inbound =
      activity.emailDirection === "inbound" || activity.folder === "inbox";
    return `/inbox?thread=${encodeURIComponent(thread)}&folder=${
      inbound ? "inbox" : "sent"
    }`;
  }
  if (type === "meeting") {
    const params = new URLSearchParams();
    params.set("event", `crm:${activity.id}`);
    const day = isoDate(activity.dueAt) ?? isoDate(activity.createdAt);
    if (day) params.set("date", day);
    return `/sales/calendar?${params.toString()}`;
  }
  const params = new URLSearchParams();
  params.set("highlight", activity.id);
  if (type) params.set("type", type);
  return `/activities?${params.toString()}`;
}

export function calendarEventMatchesId(
  eventId: string,
  wanted: string | null | undefined,
): boolean {
  if (!wanted) return false;
  if (eventId === wanted) return true;
  if (eventId === `crm:${wanted}`) return true;
  if (wanted.startsWith("crm:") && eventId.startsWith(wanted)) return true;
  return eventId.startsWith(`crm:${wanted}`);
}
