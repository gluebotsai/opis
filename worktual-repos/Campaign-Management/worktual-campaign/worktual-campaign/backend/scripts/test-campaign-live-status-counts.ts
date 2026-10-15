/**
 * Live-status recipient count rollup helper.
 * Run: npx tsx scripts/test-campaign-live-status-counts.ts
 */
import assert from "node:assert/strict";
import { countByStatus } from "../src/dao/campaign-live-status.js";

assert.deepEqual(countByStatus([]), {
  pending: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
});

assert.deepEqual(
  countByStatus([
    { status: "pending", _count: { _all: 3 } },
    { status: "sent", _count: { _all: 10 } },
    { status: "failed", _count: { _all: 1 } },
  ]),
  { pending: 3, sent: 10, failed: 1, skipped: 0 },
);

console.log("test-campaign-live-status-counts: ok");
