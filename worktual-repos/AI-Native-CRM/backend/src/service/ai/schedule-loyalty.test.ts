/**
 * run: npx tsx --tsconfig tsconfig.json src/service/ai/schedule-loyalty.test.ts
 */
import {
  classifyEngagementTier,
  detectScheduleIntent,
  evaluateScheduleLoyaltyGate,
  resolveScheduleIntentForThread,
} from "./schedule-loyalty";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  detectScheduleIntent("Please reschedule to tomorrow 4pm") === "reschedule",
  "reschedule phrasing",
);
assert(
  detectScheduleIntent("I'd like to book a demo") === "schedule",
  "schedule phrasing",
);
assert(
  resolveScheduleIntentForThread({
    text: "I want to demo for the product at 9.00 pm today",
    hasUpcomingMeeting: true,
  }) === "reschedule",
  "new time with open meeting => reschedule",
);
assert(
  resolveScheduleIntentForThread({
    text: "I want to demo for the product at 9.00 pm today",
    hasUpcomingMeeting: false,
  }) === "schedule",
  "follow-up after completed meeting stays schedule",
);
assert(
  detectScheduleIntent("Thanks for the brochure") === null,
  "unrelated mail",
);
assert(
  detectScheduleIntent("Yes, I am interested.", "demo_ask_slot") === null,
  "interest confirmation is not a demo booking",
);
assert(
  detectScheduleIntent("Thanks!") === null,
  "courtesy is not schedule",
);
assert(
  resolveScheduleIntentForThread({
    text: "7:15 PM today",
    category: "demo_check_slot",
    hasUpcomingMeeting: false,
  }) === "schedule",
  "parsed follow-up time with demo category counts as schedule",
);

assert(
  detectScheduleIntent(
    "which specific tool you provide to help my company grow",
    "demo_ask_slot",
  ) === "schedule",
  "demo_* category still counts when caller passes it — apply must not pass it without latest demo intent",
);

assert(
  classifyEngagementTier({
    meetingCount: 0,
    bookedDemoCount: 1,
    inboundEmailCount: 1,
    outboundEmailCount: 1,
  }) === "loyal",
  "booked demo => loyal",
);
assert(
  classifyEngagementTier({
    meetingCount: 0,
    bookedDemoCount: 0,
    inboundEmailCount: 1,
    outboundEmailCount: 1,
  }) === "new",
  "sparse => new",
);

assert(
  evaluateScheduleLoyaltyGate({
    tier: "new",
    intent: "schedule",
    autoRescheduleCount: 0,
    hasUpcomingMeeting: false,
  })?.action === "allow",
  "new schedule auto-books",
);
assert(
  evaluateScheduleLoyaltyGate({
    tier: "loyal",
    intent: "schedule",
    autoRescheduleCount: 0,
    hasUpcomingMeeting: false,
  })?.action === "allow",
  "loyal schedule allows",
);
assert(
  evaluateScheduleLoyaltyGate({
    tier: "new",
    intent: "reschedule",
    autoRescheduleCount: 0,
    hasUpcomingMeeting: true,
  })?.action === "allow",
  "new first reschedule allows",
);
assert(
  evaluateScheduleLoyaltyGate({
    tier: "new",
    intent: "reschedule",
    autoRescheduleCount: 1,
    hasUpcomingMeeting: true,
  })?.action === "escalate",
  "new second reschedule escalates",
);
assert(
  evaluateScheduleLoyaltyGate({
    tier: "new",
    intent: "reschedule",
    autoRescheduleCount: 0,
    hasUpcomingMeeting: false,
  })?.category === "demo_schedule",
  "reschedule with no open meeting treated as new booking",
);

console.log("schedule-loyalty tests passed");
