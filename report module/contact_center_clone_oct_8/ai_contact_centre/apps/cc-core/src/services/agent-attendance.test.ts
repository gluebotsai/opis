import assert from "node:assert/strict";
import test from "node:test";

import { buildPresenceMix, summarizeAttendanceDay, summarizePresenceDurations } from "./agent-attendance.js";

test("summarizeAttendanceDay marks present when non-offline time exists", () => {
  const dayStart = new Date("2026-08-21T00:00:00+05:30");
  const dayEnd = new Date("2026-08-22T00:00:00+05:30");
  const now = new Date("2026-08-21T18:00:00+05:30");

  const day = summarizeAttendanceDay({
    date: "2026-08-21",
    dayStart,
    dayEnd,
    now,
    events: [
      {
        at: new Date("2026-08-21T09:00:00+05:30"),
        previousState: "offline",
        newState: "ready",
      },
      {
        at: new Date("2026-08-21T12:00:00+05:30"),
        previousState: "ready",
        newState: "not_ready",
      },
      {
        at: new Date("2026-08-21T13:00:00+05:30"),
        previousState: "not_ready",
        newState: "offline",
      },
    ],
  });

  assert.equal(day.attendance, "present");
  assert.equal(day.hasHistory, true);
  assert.equal(day.durationsSeconds.ready, 3 * 3600);
  assert.equal(day.durationsSeconds.not_ready, 3600);
  assert.ok((day.durationsSeconds.offline ?? 0) >= 9 * 3600);
});

test("summarizeAttendanceDay marks absent with no login and offline carry", () => {
  const dayStart = new Date("2026-08-20T00:00:00+05:30");
  const dayEnd = new Date("2026-08-21T00:00:00+05:30");
  const now = new Date("2026-08-21T12:00:00+05:30");

  const day = summarizeAttendanceDay({
    date: "2026-08-20",
    dayStart,
    dayEnd,
    now,
    events: [],
    currentState: "offline",
  });

  assert.equal(day.attendance, "absent");
  assert.equal(day.hasHistory, false);
});

test("summarizeAttendanceDay present when offline now but ready earlier", () => {
  const dayStart = new Date("2026-08-21T00:00:00+05:30");
  const dayEnd = new Date("2026-08-22T00:00:00+05:30");
  const now = new Date("2026-08-21T20:00:00+05:30");

  const day = summarizeAttendanceDay({
    date: "2026-08-21",
    dayStart,
    dayEnd,
    now,
    currentState: "offline",
    events: [
      {
        at: new Date("2026-08-21T10:00:00+05:30"),
        previousState: "offline",
        newState: "ready",
      },
      {
        at: new Date("2026-08-21T11:00:00+05:30"),
        previousState: "ready",
        newState: "offline",
      },
    ],
  });

  assert.equal(day.attendance, "present");
  assert.equal(day.durationsSeconds.ready, 3600);
});

test("buildPresenceMix returns sorted percentages", () => {
  const mix = buildPresenceMix({
    ready: 7_200,
    not_ready: 1_200,
    offline: 600,
  });

  assert.equal(mix.totalSeconds, 9_000);
  assert.equal(mix.states[0]?.state, "ready");
  assert.equal(mix.states[0]?.percent, 80);
  assert.equal(mix.states[1]?.state, "not_ready");
  assert.equal(mix.states[1]?.percent, 13.3);
});

test("summarizePresenceDurations aggregates a simple ready window", () => {
  const start = new Date("2026-08-21T09:00:00+05:30");
  const end = new Date("2026-08-21T12:00:00+05:30");
  const durations = summarizePresenceDurations({
    rangeStart: start,
    rangeEnd: end,
    now: end,
    events: [
      {
        at: new Date("2026-08-21T09:00:00+05:30"),
        previousState: "offline",
        newState: "ready",
      },
    ],
    currentState: "ready",
  });

  assert.equal(durations.ready, 3 * 3600);
});
