/**
 * Activity series IST period bounds.
 * Run: npx tsx scripts/test-activity-series-bounds.ts
 */
import assert from "node:assert/strict";
import { resolveActivitySeriesYmdBounds } from "../src/dao/portfolio-activity-series.js";

const today = resolveActivitySeriesYmdBounds({ relative: "today" });
assert.equal(today.fromYmd, today.toYmd);

const week = resolveActivitySeriesYmdBounds({ relative: "last_7_days" });
assert.ok(week.fromYmd <= week.toYmd);

const custom = resolveActivitySeriesYmdBounds({
  fromDate: "2026-01-01",
  toDate: "2026-01-07",
});
assert.equal(custom.fromYmd, "2026-01-01");
assert.equal(custom.toYmd, "2026-01-07");

console.log("test-activity-series-bounds: ok");
