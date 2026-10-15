/**
 * Wall-clock conversion for a Sales Assist "schedule meeting" click.
 * Run: npx tsx src/service/ai/execute-assist-action.test.ts
 */
import { normalizeAssistAction } from "./meeting-assist";
import { assistActionKey, zonedLocalToUtc } from "./execute-assist-action";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const start = zonedLocalToUtc("2026-10-02T16:00", "Asia/Kolkata");
assert(start?.toISOString() === "2026-10-02T10:30:00.000Z", "4 pm IST is 10:30 UTC");
assert(zonedLocalToUtc("tomorrow", "Asia/Kolkata") === null, "rejects a bare word");
assert(zonedLocalToUtc("2026-10-02T16:00", "Not/AZone") === null, "rejects a bad zone");

const meeting = normalizeAssistAction({
  kind: "schedule_meeting",
  label: "Schedule meeting",
  detail: "Tomorrow at 4:00 PM with Lucifer",
  whenLocal: "2026-10-02T16:00",
  durationMinutes: 30,
  subject: "Meeting with Lucifer",
});
assert(meeting?.kind === "schedule_meeting", "keeps a complete meeting action");
assert(
  normalizeAssistAction({
    kind: "schedule_meeting",
    detail: "Tomorrow at 4",
  }) === null,
  "drops a meeting with no clock time",
);
assert(
  normalizeAssistAction({
    kind: "send_follow_up",
    detail: "Send the catalog",
    subject: "Catalog",
  }) === null,
  "drops an email with no body",
);
assert(meeting && assistActionKey(meeting).startsWith("schedule_meeting|"), "key includes the time");

console.log("execute-assist-action tests ok");
