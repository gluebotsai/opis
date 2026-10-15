/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/meeting-ics.test.ts
 */
import { buildMeetingIcs } from "./meeting-ics";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const start = new Date("2026-08-19T04:30:00.000Z");
const end = new Date("2026-08-19T05:00:00.000Z");
const updated = new Date("2026-08-19T08:30:00.000Z");
const updatedEnd = new Date("2026-08-19T09:00:00.000Z");

const first = buildMeetingIcs({
  uid: "act1@worktual.crm",
  topic: "Product demo",
  start,
  end,
  organizerEmail: "aravind@worktual.com",
  organizerName: "Aravind Selvaraj",
  attendeeEmails: ["yaswanthmg1@gmail.com"],
  sequence: 0,
});
assert(first.includes("METHOD:REQUEST"), "initial request method");
assert(first.includes("UID:act1@worktual.crm"), "stable uid");
assert(first.includes("SEQUENCE:0"), "first invite sequence 0");

const reschedule = buildMeetingIcs({
  uid: "act1@worktual.crm",
  topic: "Product demo",
  start: updated,
  end: updatedEnd,
  organizerEmail: "aravind@worktual.com",
  organizerName: "Aravind Selvaraj",
  attendeeEmails: ["yaswanthmg1@gmail.com"],
  sequence: 1,
});
assert(reschedule.includes("UID:act1@worktual.crm"), "reschedule keeps uid");
assert(reschedule.includes("SEQUENCE:1"), "reschedule increments sequence");
assert(reschedule.includes("DTSTART:20260819T083000Z"), "new start time");
assert(!reschedule.includes("METHOD:CANCEL"), "update is still REQUEST");

console.log("meeting-ics reschedule sequence ok");
