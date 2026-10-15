import assert from "node:assert/strict";
import test from "node:test";

import {
  mapHandoffFailureReason,
  missedContactEpisodeBoundary,
  normalizeMissedContactReason,
} from "./agent-missed-contacts.js";

test("missed-contact deduplication starts at the current handoff episode", () => {
  const queuedAt = "2026-08-19T09:09:40.000Z";

  assert.equal(missedContactEpisodeBoundary(queuedAt).toISOString(), queuedAt);
});

test("missed-contact deduplication safely falls back to 24 hours", () => {
  const now = new Date("2026-08-19T10:00:00.000Z");

  assert.equal(
    missedContactEpisodeBoundary(null, now).toISOString(),
    "2026-08-18T10:00:00.000Z",
  );
  assert.equal(
    missedContactEpisodeBoundary("invalid", now).toISOString(),
    "2026-08-18T10:00:00.000Z",
  );
});

test("handoff failure is recorded as no agent available, not routing_exhausted", () => {
  assert.equal(mapHandoffFailureReason("routing_exhausted"), "no_agent_available");
  assert.equal(mapHandoffFailureReason("all_agents_busy"), "no_agent_available");
  assert.equal(mapHandoffFailureReason("no_ready_agents"), "no_agent_available");
});

test("legacy missed-contact reason codes fold onto two values", () => {
  assert.equal(normalizeMissedContactReason("offer_timeout"), "offer_timeout");
  assert.equal(normalizeMissedContactReason("manual_reject"), "offer_timeout");
  assert.equal(normalizeMissedContactReason("no_agent_available"), "no_agent_available");
  assert.equal(normalizeMissedContactReason("routing_exhausted"), "no_agent_available");
});