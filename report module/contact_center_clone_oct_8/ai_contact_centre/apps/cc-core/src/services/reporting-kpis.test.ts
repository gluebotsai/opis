import assert from "node:assert/strict";
import test from "node:test";

import { buildPerformanceKpis, type AggregateRow } from "./reporting.js";

const empty: AggregateRow = {
  total: 0n,
  handled: 0n,
  resolved: 0n,
  transferred: 0n,
  first_response_count: 0n,
  within_sla: 0n,
  avg_first_response_seconds: null,
  avg_handle_seconds: null,
};

test("empty first-response and handle averages stay null instead of 0", () => {
  const kpis = buildPerformanceKpis(empty, empty);
  assert.equal(kpis.avgFirstResponseSeconds, null);
  assert.equal(kpis.avgHandleSeconds, null);
  assert.equal(kpis.firstResponseCount, 0);
  assert.equal(kpis.withinSlaCount, 0);
});

test("sub-second first-response average rounds to 0s when a sample exists", () => {
  const kpis = buildPerformanceKpis(
    {
      ...empty,
      first_response_count: 8n,
      within_sla: 8n,
      avg_first_response_seconds: 0.4,
    },
    empty,
  );
  assert.equal(kpis.avgFirstResponseSeconds, 0);
  assert.equal(kpis.firstResponseCount, 8);
  assert.equal(kpis.withinSlaCount, 8);
  assert.equal(kpis.slaRate, 100);
});

test("first-reply SLA is within-60s count over first-response sample", () => {
  const kpis = buildPerformanceKpis(
    {
      ...empty,
      first_response_count: 19n,
      within_sla: 16n,
    },
    empty,
  );
  assert.equal(kpis.slaRate, 84.2);
  assert.equal(kpis.withinSlaCount, 16);
  assert.equal(kpis.firstResponseCount, 19);
});
