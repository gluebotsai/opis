/**
 * run: npx tsx --tsconfig tsconfig.json src/service/calendar/google-calendar-push.test.ts
 */
import {
  calendarPushWebhookUrl,
  isCalendarPushConfigured,
  shouldCaptureGoogleCalendarEvent,
} from "@/lib/google-calendar-capture";
import { redactCalendarPushWebhookUrl } from "@/service/calendar/google-calendar-push";
import { meetCodeFromGoogleMeetUrl } from "@/lib/meeting-body";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  meetCodeFromGoogleMeetUrl("https://meet.google.com/abc-defg-hij") ===
    "abc-defg-hij",
  "meet code",
);
assert(
  meetCodeFromGoogleMeetUrl("https://meet.google.com/lookup/xyz") === null,
  "lookup is not a meet code",
);

const now = Date.parse("2026-09-16T17:30:00.000Z");
assert(
  shouldCaptureGoogleCalendarEvent(
    {
      status: "confirmed",
      meetLink: "https://meet.google.com/abc-defg-hij",
      startAt: "2026-09-16T18:00:00.000Z",
      endAt: "2026-09-16T18:30:00.000Z",
    },
    now,
  ),
  "upcoming meet is capturable",
);
assert(
  !shouldCaptureGoogleCalendarEvent(
    {
      status: "cancelled",
      meetLink: "https://meet.google.com/abc-defg-hij",
      startAt: "2026-09-16T18:00:00.000Z",
      endAt: "2026-09-16T18:30:00.000Z",
    },
    now,
  ),
  "cancelled skipped",
);
assert(
  !shouldCaptureGoogleCalendarEvent(
    {
      status: "confirmed",
      meetLink: null,
      startAt: "2026-09-16T18:00:00.000Z",
      endAt: "2026-09-16T18:30:00.000Z",
    },
    now,
  ),
  "no meet link skipped",
);
assert(
  !shouldCaptureGoogleCalendarEvent(
    {
      status: "confirmed",
      meetLink: "https://meet.google.com/abc-defg-hij",
      startAt: "2026-08-01T18:00:00.000Z",
      endAt: "2026-08-01T18:30:00.000Z",
    },
    now,
  ),
  "ended long ago skipped",
);

const prevUrl = process.env.CALENDAR_PUSH_WEBHOOK_URL;
const prevPublic = process.env.CRM_API_PUBLIC_URL;
process.env.CALENDAR_PUSH_WEBHOOK_URL =
  "https://abc.ngrok-free.app/api/webhooks/google-calendar/push";
assert(
  calendarPushWebhookUrl() ===
    "https://abc.ngrok-free.app/api/webhooks/google-calendar/push",
  "explicit webhook url",
);
assert(isCalendarPushConfigured() === true, "configured when url set");
delete process.env.CALENDAR_PUSH_WEBHOOK_URL;
process.env.CRM_API_PUBLIC_URL = "https://abc.ngrok-free.app";
assert(
  calendarPushWebhookUrl() ===
    "https://abc.ngrok-free.app/api/webhooks/google-calendar/push",
  "derived from public api url",
);
process.env.CRM_API_PUBLIC_URL = "http://127.0.0.1:4000";
assert(calendarPushWebhookUrl() === null, "localhost is not a push url");
if (prevUrl) process.env.CALENDAR_PUSH_WEBHOOK_URL = prevUrl;
else delete process.env.CALENDAR_PUSH_WEBHOOK_URL;
if (prevPublic) process.env.CRM_API_PUBLIC_URL = prevPublic;
else delete process.env.CRM_API_PUBLIC_URL;

assert(
  redactCalendarPushWebhookUrl(
    "https://studied-clamp-galvanize.ngrok-free.dev/api/webhooks/google-calendar/push?token=secret",
  ) ===
    "https://studied-clamp-galvanize.ngrok-free.dev/api/webhooks/google-calendar/push?token=***",
  "redact verification token in webhook url logs",
);

console.log("google-calendar-push.test.ts ok");
