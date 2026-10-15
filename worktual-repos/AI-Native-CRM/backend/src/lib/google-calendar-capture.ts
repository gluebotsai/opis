import type { GoogleCalendarListedEvent } from "@/service/google/calendar";

export function calendarPushWebhookUrl(): string | null {
  const explicit = process.env.CALENDAR_PUSH_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const origin = (
    process.env.CRM_API_PUBLIC_URL?.trim() ||
    process.env.API_PUBLIC_URL?.trim() ||
    process.env.MEETING_BOT_WEBHOOK_BASE_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
  if (
    !origin ||
    origin.startsWith("http://127.") ||
    origin.startsWith("http://localhost")
  ) {
    return null;
  }
  return `${origin}/api/webhooks/google-calendar/push`;
}

export function isCalendarPushConfigured(): boolean {
  return Boolean(calendarPushWebhookUrl());
}

export function shouldCaptureGoogleCalendarEvent(
  ev: Pick<
    GoogleCalendarListedEvent,
    "status" | "meetLink" | "startAt" | "endAt"
  >,
  nowMs = Date.now(),
): boolean {
  if ((ev.status || "").toLowerCase() === "cancelled") return false;
  if (!ev.meetLink?.trim()) return false;
  const start = ev.startAt ? new Date(ev.startAt).getTime() : NaN;
  const end = ev.endAt ? new Date(ev.endAt).getTime() : NaN;
  if (Number.isFinite(end) && end < nowMs - 2 * 60 * 60_000) return false;
  if (Number.isFinite(start) && start > nowMs + 30 * 24 * 60 * 60_000) {
    return false;
  }
  return true;
}
