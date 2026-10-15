/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/calendar-reschedule-display.test.ts
 */
import {
  applySameDayRescheduleDisplay,
  type RescheduleDisplayEvent,
} from "./calendar-reschedule-display";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function ev(
  partial: Partial<RescheduleDisplayEvent> & Pick<RescheduleDisplayEvent, "id" | "startAt">,
): RescheduleDisplayEvent {
  return {
    title: "Product demo",
    description: "Provider: google_meet",
    meetLink: "https://meet.google.com/abc",
    contactId: "contact-1",
    rescheduled: false,
    superseded: false,
    ...partial,
  };
}

const separateSameDay = applySameDayRescheduleDisplay([
  ev({ id: "crm:old", startAt: "2026-08-19T04:30:00.000Z" }),
  ev({ id: "crm:new", startAt: "2026-08-19T08:30:00.000Z" }),
]);
assert(
  separateSameDay.every((e) => !e.superseded && !e.rescheduled),
  "two follow-up meetings same day stay independent",
);

const withGhost = applySameDayRescheduleDisplay([
  ev({
    id: "crm:live",
    startAt: "2026-08-19T08:30:00.000Z",
    rescheduled: true,
  }),
  ev({
    id: "crm:live:previous",
    startAt: "2026-08-19T04:30:00.000Z",
    meetLink: null,
    rescheduled: false,
    superseded: true,
  }),
]);
assert(withGhost.filter((e) => e.superseded).length === 1, "ghost kept once");
assert(withGhost.some((e) => e.rescheduled && !e.superseded), "live reschedule kept");

const overlapping = applySameDayRescheduleDisplay([
  ev({
    id: "crm:old",
    startAt: "2026-08-20T04:30:00.000Z",
  }),
  ev({
    id: "crm:new:previous",
    startAt: "2026-08-20T04:30:00.000Z",
    superseded: true,
    meetLink: null,
  }),
  ev({
    id: "crm:new",
    startAt: "2026-08-20T08:30:00.000Z",
    rescheduled: true,
  }),
  ev({
    id: "crm:dup",
    startAt: "2026-08-20T08:30:00.000Z",
  }),
]);
assert(overlapping.length === 2, "four rows collapse to two chips");
assert(
  overlapping.filter((e) => e.superseded).length === 1,
  "one previous 10am chip",
);
assert(
  overlapping.filter((e) => e.rescheduled && !e.superseded).length === 1,
  "one rescheduled 2pm chip",
);

console.log("calendar same-day reschedule display ok");
