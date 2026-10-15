/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/meeting-body.test.ts
 */
import {
  buildMeetingActivityBody,
  isMeetingMarkedRescheduled,
  parseGcalProviderMessageId,
  parseIcsSequenceFromMeetingBody,
  parseIcsUidFromMeetingBody,
  parsePreviousDueAtFromMeetingBody,
  parsePreviousWhenLabelFromMeetingBody,
  meetCodeFromGoogleMeetUrl,
} from "./meeting-body";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const previousDue = new Date("2026-08-19T04:30:00.000Z");
const body = buildMeetingActivityBody({
  topic: "Product demo",
  whenLabel: "Wednesday, August 19, 2026 · 2:00 PM – 2:30 PM (Asia/Kolkata)",
  organizerName: "Aravind Selvaraj",
  organizerEmail: "aravind@worktual.com",
  guestEmails: ["yaswanthmg1@gmail.com"],
  provider: "google_meet",
  meetingLink: "https://meet.google.com/abc-defg-hij",
  googleEventId: "gcalEvent123",
  previousWhenLabel: "Wednesday, August 19, 2026 · 10:00 AM – 10:30 AM (Asia/Kolkata)",
  previousDueAt: previousDue,
  rescheduled: true,
  icsUid: "act1@worktual.crm",
  icsSequence: 1,
});

assert(isMeetingMarkedRescheduled(body), "rescheduled flag");
assert(
  parsePreviousWhenLabelFromMeetingBody(body)?.includes("10:00 AM"),
  "previous when label",
);
assert(
  parsePreviousDueAtFromMeetingBody(body)?.toISOString() === previousDue.toISOString(),
  "previous dueAt",
);
assert(parseIcsUidFromMeetingBody(body) === "act1@worktual.crm", "ics uid");
assert(parseIcsSequenceFromMeetingBody(body) === 1, "ics sequence");
assert(parseGcalProviderMessageId("gcal:evt_9") === "evt_9", "gcal provider id");
assert(parseGcalProviderMessageId("email-123") == null, "non-gcal provider id");
assert(
  meetCodeFromGoogleMeetUrl("https://meet.google.com/wxa-fffj-jvf") ===
    "wxa-fffj-jvf",
  "meet code from url",
);
assert(
  meetCodeFromGoogleMeetUrl("https://meet.google.com/vcsp-kdoe-xjw") ===
    "vcsp-kdoe-xjw",
  "four-letter Meet prefix must not be truncated",
);

console.log("meeting-body reschedule metadata ok");
