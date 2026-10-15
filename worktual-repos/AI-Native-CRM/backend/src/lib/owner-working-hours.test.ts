import {
  addWorkingMinutes,
  calendarFromBusinessHours,
  followupDeadline,
  parseFollowupPolicy,
} from "./owner-working-hours";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const calendar = calendarFromBusinessHours({
  timezone: "UTC",
  workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  openTime: "09:00",
  closeTime: "18:00",
});

const fridayAfternoon = new Date("2026-09-25T17:50:00.000Z");
const plus30 = addWorkingMinutes(fridayAfternoon, 30, calendar);
assert(
  plus30.toISOString() === "2026-09-28T09:20:00.000Z",
  `30 working minutes from Friday 17:50 should land Monday 09:20, got ${plus30.toISOString()}`,
);

const coldRemind = followupDeadline({
  from: fridayAfternoon,
  band: "cold",
  step: "remind",
  calendar,
});
assert(
  coldRemind.toISOString() === "2026-09-25T18:00:00.000Z",
  `cold remind is end of that working day, got ${coldRemind.toISOString()}`,
);

const coldManager = followupDeadline({
  from: fridayAfternoon,
  band: "cold",
  step: "manager",
  calendar,
});
assert(
  coldManager.toISOString() === "2026-09-28T18:00:00.000Z",
  `cold manager is next working day, got ${coldManager.toISOString()}`,
);

const coldAdmin = followupDeadline({
  from: fridayAfternoon,
  band: "cold",
  step: "admin",
  calendar,
});
assert(
  coldAdmin.toISOString() === "2026-09-29T18:00:00.000Z",
  `cold admin is two working days, got ${coldAdmin.toISOString()}`,
);

const afterClose = new Date("2026-09-25T19:00:00.000Z");
const afterRemind = followupDeadline({
  from: afterClose,
  band: "cold",
  step: "remind",
  calendar,
});
assert(
  afterRemind.toISOString() === "2026-09-28T18:00:00.000Z",
  `after close, cold remind is the next working day's end, got ${afterRemind.toISOString()}`,
);

const hot = followupDeadline({
  from: new Date("2026-09-25T10:00:00.000Z"),
  band: "hot",
  step: "admin",
  calendar,
});
assert(
  hot.toISOString() === "2026-09-25T10:30:00.000Z",
  `hot admin is 30 working minutes, got ${hot.toISOString()}`,
);

const policy = parseFollowupPolicy({
  hot: { remindMinutes: 10, managerMinutes: 20, adminMinutes: 40 },
});
assert(policy.hot.remindMinutes === 10, "admin can override hot remind");
assert(policy.warm.remindMinutes === 30, "missing warm keeps the default");
assert(policy.cold.remind === "end_of_working_day", "cold markers stay fixed");

const perDay = calendarFromBusinessHours({
  timezone: "UTC",
  workingDays: ["Monday"],
  openTime: "09:00",
  closeTime: "18:00",
  dayTimings: { Monday: { openTime: "10:00", closeTime: "16:00" } },
});
assert(perDay.days[1]?.openMin === 10 * 60, "day timings override the shared window");

console.log("owner-working-hours.test.ts ok");
