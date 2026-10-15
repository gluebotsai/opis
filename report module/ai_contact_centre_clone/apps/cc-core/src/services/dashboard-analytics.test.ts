import assert from "node:assert/strict";
import test from "node:test";

import {
  clamp,
  formatSignedDelta,
  hashInput,
  hourInTimeZone,
  hourRangeLabel,
  mad,
  median,
  peakHourOfDay,
  robustZScore,
  weekdayHourKey,
} from "./dashboard-analytics-math.js";
import { buildHourlyVolumeEvidence } from "./dashboard-analytics-predictive.js";

test("computes median and mad", () => {
  assert.equal(median([1, 3, 9]), 3);
  assert.equal(mad([1, 3, 9], 3), 2);
});

test("computes robust z-score", () => {
  assert.ok(robustZScore(10, 5, 2) > 1);
});

test("clamps multipliers", () => {
  assert.equal(clamp(2, 0.75, 1.25), 1.25);
  assert.equal(clamp(0.5, 0.75, 1.25), 0.75);
});

test("hashes deterministically regardless of key order", () => {
  const left = hashInput({ a: 1, b: [{ z: 2, x: 1 }] });
  const right = hashInput({ b: [{ x: 1, z: 2 }], a: 1 });
  assert.equal(left, right);
});

test("formats signed deltas", () => {
  assert.match(formatSignedDelta(4.2), /\+4\.2/);
  assert.match(formatSignedDelta(-2.5), /-2\.5/);
});

test("builds weekday hour keys", () => {
  const date = new Date("2026-08-27T14:30:00.000Z");
  assert.match(weekdayHourKey(date), /thursday-14/);
});

test("maps timestamps into Asia/Kolkata hours", () => {
  assert.equal(hourInTimeZone(new Date("2026-09-17T04:30:00.000Z"), "Asia/Kolkata"), 10);
  assert.equal(hourInTimeZone(new Date("2026-09-17T05:00:00.000Z"), "Asia/Kolkata"), 10);
  assert.equal(hourRangeLabel(10), "10:00-11:00");
  assert.equal(hourRangeLabel(23), "23:00-24:00");
  assert.equal(peakHourOfDay([0, 0, 4, 9, 1]), "03:00-04:00");
});

test("hourly peak is org-wide local hour of day, not a single queue bucket", () => {
  const today = new Date("2026-09-16T12:00:00.000Z");
  const evidence = buildHourlyVolumeEvidence(
    [
      { created_at: new Date("2026-09-15T04:45:00.000Z") },
      { created_at: new Date("2026-09-14T04:50:00.000Z") },
      { created_at: new Date("2026-09-13T07:15:00.000Z") },
    ],
    [
      { bucketStart: "2026-09-17T04:30:00.000Z", expected: 18 },
      { bucketStart: "2026-09-17T04:30:00.000Z", expected: 4 },
      { bucketStart: "2026-09-17T07:00:00.000Z", expected: 19 },
    ],
    today,
    "Asia/Kolkata",
  );
  assert.equal(evidence.peakHour, "10:00-11:00");
  assert.equal(evidence.observedPeakHour, "10:00-11:00");
  assert.equal(evidence.timeZone, "Asia/Kolkata");
  const ten = evidence.points.find((point) => point.label === "10:00-11:00");
  const twelve = evidence.points.find((point) => point.label === "12:00-13:00");
  assert.equal(ten?.actual, 2);
  assert.equal(ten?.forecast, 22);
  assert.equal(twelve?.actual, 1);
  assert.equal(twelve?.forecast, 19);
  assert.ok((ten?.forecast ?? 0) > (twelve?.forecast ?? 0));
});

test("sparse hourly actuals stay visible instead of rounding to zero", () => {
  const today = new Date("2026-09-16T12:00:00.000Z");
  const evidence = buildHourlyVolumeEvidence(
    [{ created_at: new Date("2026-09-15T04:45:00.000Z") }],
    [],
    today,
    "Asia/Kolkata",
  );
  assert.equal(evidence.peakHour, "10:00-11:00");
  assert.equal(evidence.source, "historical_actual");
  assert.equal(evidence.points.find((point) => point.label === "10:00-11:00")?.actual, 1);
});
