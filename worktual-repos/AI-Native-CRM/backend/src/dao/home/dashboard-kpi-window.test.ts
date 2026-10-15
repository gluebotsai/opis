/**
 * run: npx tsx --tsconfig tsconfig.json src/dao/home/dashboard-kpi-window.test.ts
 */
import assert from "node:assert/strict";
import {
  dashboardDealSets,
  dashboardKpiBounds,
} from "./dashboard-kpi-window";

const now = new Date("2026-10-07T14:00:00.000Z");

const today = dashboardKpiBounds("today", now);
assert.equal(today.currentStart.toISOString(), "2026-10-07T00:00:00.000Z");
assert.equal(today.currentEnd.toISOString(), "2026-10-08T00:00:00.000Z");
assert.equal(today.prevStart.toISOString(), "2026-10-06T00:00:00.000Z");
assert.equal(today.prevEnd.toISOString(), "2026-10-07T00:00:00.000Z");

const week = dashboardKpiBounds("week", now);
assert.equal(week.currentStart.toISOString(), "2026-09-30T00:00:00.000Z");
assert.equal(week.currentEnd.toISOString(), "2026-10-08T00:00:00.000Z");
assert.equal(week.prevStart.toISOString(), "2026-09-23T00:00:00.000Z");
assert.equal(week.prevEnd.toISOString(), "2026-09-30T00:00:00.000Z");
assert.equal(week.shortLabel, "Last 7 days");

const month = dashboardKpiBounds("month", now);
assert.equal(month.currentStart.toISOString(), "2026-09-07T00:00:00.000Z");
assert.equal(month.currentEnd.toISOString(), "2026-10-08T00:00:00.000Z");
assert.equal(month.prevStart.toISOString(), "2026-08-08T00:00:00.000Z");
assert.equal(month.prevEnd.toISOString(), "2026-09-07T00:00:00.000Z");
assert.equal(month.shortLabel, "Last 30 days");

const quarter = dashboardKpiBounds("quarter", now);
assert.equal(quarter.currentStart.toISOString(), "2026-10-01T00:00:00.000Z");
assert.equal(quarter.currentEnd.toISOString(), "2027-01-01T00:00:00.000Z");
assert.equal(quarter.prevStart.toISOString(), "2026-07-01T00:00:00.000Z");
assert.equal(quarter.prevEnd.toISOString(), "2026-10-01T00:00:00.000Z");

const q1 = dashboardKpiBounds("quarter", new Date("2026-01-15T08:00:00.000Z"));
assert.equal(q1.currentStart.toISOString(), "2026-01-01T00:00:00.000Z");
assert.equal(q1.currentEnd.toISOString(), "2026-04-01T00:00:00.000Z");
assert.equal(q1.prevStart.toISOString(), "2025-10-01T00:00:00.000Z");

const sets = dashboardDealSets(
  [
    {
      stage: "discover",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      closedAt: null,
    },
    {
      stage: "closed_won",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      closedAt: new Date("2026-10-05T00:00:00.000Z"),
    },
    {
      stage: "closed_won",
      createdAt: new Date("2026-10-06T00:00:00.000Z"),
      closedAt: null,
    },
  ],
  week,
);
assert.equal(sets.openCreated.length, 0);
assert.equal(sets.wonClosed.length, 2);
assert.equal(sets.openByCloseTs.length, 0);

console.log("dashboard-kpi-window.test.ts ok");
