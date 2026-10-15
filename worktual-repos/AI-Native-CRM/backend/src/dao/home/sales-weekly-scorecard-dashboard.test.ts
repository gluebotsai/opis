/**
 * run: npx tsx --tsconfig tsconfig.json src/dao/home/sales-weekly-scorecard-dashboard.test.ts
 */
import { getWeekBounds, resolveTimeZone } from "@/lib/week-bounds";
import {
  attributeQuoteUserId,
  computeScorecardStatus,
  isQuoteTrackTier,
  isSqmTrackTier,
  matchesRegion,
} from "@/dao/home/sales-weekly-scorecard-dashboard";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// Week bounds — UTC (Wed Sep 9 2026 → Mon Sep 7 – Sun Sep 13)
const utcWed = new Date("2026-09-09T12:00:00.000Z");
const utcWeek = getWeekBounds("UTC", utcWed, 0);
assert(utcWeek.weekKey.match(/^\d{4}-W\d{2}$/), `week key format, got ${utcWeek.weekKey}`);
assert(
  utcWeek.weekStart.toISOString() === "2026-09-07T00:00:00.000Z",
  `UTC week starts Monday, got ${utcWeek.weekStart.toISOString()}`,
);
assert(
  utcWeek.weekEnd.toISOString() === "2026-09-14T00:00:00.000Z",
  `UTC week ends next Monday, got ${utcWeek.weekEnd.toISOString()}`,
);
assert(utcWeek.weekLabel.includes("Sep"), "UTC week label readable");

// Week bounds — Asia/Kolkata (Wed Sep 9 2026 is same calendar week)
const istWeek = getWeekBounds("Asia/Kolkata", utcWed, 0);
assert(istWeek.timeZone === "Asia/Kolkata", "IST timezone preserved");
assert(
  istWeek.weekStart < istWeek.weekEnd,
  "IST week start before end",
);

// Week offset
const prevWeek = getWeekBounds("UTC", utcWed, -1);
assert(
  prevWeek.weekEnd.getTime() === utcWeek.weekStart.getTime(),
  "previous week ends when current starts",
);

// Invalid timezone falls back
assert(resolveTimeZone("Not/AZone") === "UTC", "invalid tz → UTC");

// Quote attribution
assert(
  attributeQuoteUserId(BigInt(10), BigInt(20)) === "10",
  "prefers createdByUserId",
);
assert(
  attributeQuoteUserId(null, BigInt(20)) === "20",
  "falls back to deal owner",
);
assert(attributeQuoteUserId(null, null) === null, "null when both missing");

// Tier tracks
assert(isQuoteTrackTier("senior"), "senior on quote track");
assert(isQuoteTrackTier(null), "null tier on quote track");
assert(!isQuoteTrackTier("junior"), "junior not on quote track");
assert(isSqmTrackTier("junior"), "junior on sqm track");
assert(!isSqmTrackTier("senior"), "senior not on sqm track");

// Region filter
assert(matchesRegion("Mumbai", "Mumbai"), "exact region match");
assert(matchesRegion("Mumbai", null), "no region → all");
assert(!matchesRegion("Delhi", "Mumbai"), "region mismatch");

// RAG status — mid week behind
const weekStart = utcWeek.weekStart;
const weekEnd = utcWeek.weekEnd;
const midWeek = new Date("2026-09-10T12:00:00.000Z");
assert(
  computeScorecardStatus(0, 2, weekStart, weekEnd, midWeek) === "behind",
  "zero at mid-week is behind",
);
assert(
  computeScorecardStatus(2, 2, weekStart, weekEnd, midWeek) === "ahead",
  "full target at mid-week is ahead",
);
assert(
  computeScorecardStatus(2, 2, weekStart, weekEnd, weekEnd) === "on_track",
  "full target at week end is on_track",
);

console.log("sales-weekly-scorecard-dashboard.test.ts: all passed");
