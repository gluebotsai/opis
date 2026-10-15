/**
 * Explicit analytics metrics normalization (no NL infer).
 * Run: npx tsx scripts/test-analytics-metrics.ts
 */
import assert from "node:assert/strict";
import { normalizeAnalyticsMetrics } from "../src/dao/analytics-ask.js";

assert.deepEqual(normalizeAnalyticsMetrics(undefined), ["portfolio"]);
assert.deepEqual(normalizeAnalyticsMetrics([]), ["portfolio"]);
assert.deepEqual(normalizeAnalyticsMetrics(["open_rate", "sent"]), [
  "open_rate",
  "sent",
]);
assert.deepEqual(normalizeAnalyticsMetrics(["OPEN_RATE", "bogus", "sent"]), [
  "open_rate",
  "sent",
]);
assert.deepEqual(normalizeAnalyticsMetrics(["monitoring_tab_counts"]), [
  "monitoring_tab_counts",
]);

console.log("test-analytics-metrics: ok");
