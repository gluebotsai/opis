import assert from "node:assert/strict";
import test from "node:test";

import { isAgentShiftActiveAt, type ShiftWindow } from "./shift-routing.js";

const supportHours: ShiftWindow[] = [
  {
    shiftType: "Evening",
    dayOfWeek: "Friday",
    startTime: "00:00",
    endTime: "08:59",
    crossesMidnight: false,
  },
  {
    shiftType: "Morning",
    dayOfWeek: "Friday",
    startTime: "09:00",
    endTime: "20:00",
    crossesMidnight: false,
  },
];

function ist(date: string): Date {
  return new Date(date);
}

test("morning shift is active during business morning window", () => {
  assert.equal(
    isAgentShiftActiveAt("Morning", supportHours, "Asia/Kolkata", ist("2026-08-14T12:00:00+05:30")),
    true,
  );
  assert.equal(
    isAgentShiftActiveAt("Evening", supportHours, "Asia/Kolkata", ist("2026-08-14T12:00:00+05:30")),
    false,
  );
});

test("evening shift is active during early-morning window", () => {
  assert.equal(
    isAgentShiftActiveAt("Evening", supportHours, "Asia/Kolkata", ist("2026-08-14T06:30:00+05:30")),
    true,
  );
  assert.equal(
    isAgentShiftActiveAt("Morning", supportHours, "Asia/Kolkata", ist("2026-08-14T06:30:00+05:30")),
    false,
  );
});

test("gap between configured shifts excludes all agents", () => {
  assert.equal(
    isAgentShiftActiveAt("Morning", supportHours, "Asia/Kolkata", ist("2026-08-14T21:30:00+05:30")),
    false,
  );
  assert.equal(
    isAgentShiftActiveAt("Evening", supportHours, "Asia/Kolkata", ist("2026-08-14T21:30:00+05:30")),
    false,
  );
});

test("empty shift schedule does not gate routing", () => {
  assert.equal(isAgentShiftActiveAt("Regular", [], "Asia/Kolkata"), true);
});
