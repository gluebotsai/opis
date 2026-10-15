/**
 * Lightweight contract validation for Website Chat lifecycle scenarios.
 * This does not require a live stack; it asserts the shared scenario manifest
 * is complete and that capacity/owner expectations are coherent.
 *
 * Usage: npx tsx scripts/e2e/validate-webchat-lifecycle-contract.ts
 */
import assert from "node:assert/strict";

import {
  LIFECYCLE_SCENARIOS,
  LIFECYCLE_TEST_FIXTURES,
} from "../../apps/cc-core/src/services/lifecycle-scenario-manifest.ts";
import {
  LEGAL_TRANSITIONS,
  capacityDeltaForClose,
  expectedCapacityDelta,
} from "../../apps/cc-core/src/services/lifecycle-contract.ts";

function main() {
  assert.equal(LIFECYCLE_SCENARIOS.length, 75, "expected 75 lifecycle scenarios");
  assert.ok(LIFECYCLE_TEST_FIXTURES.queues.includes("overflow_queue"));
  assert.ok(LIFECYCLE_TEST_FIXTURES.noAgentBehaviors.includes("bot_continue"));

  assert.deepEqual(expectedCapacityDelta("offer"), { reserved: 1, active: 0 });
  assert.deepEqual(expectedCapacityDelta("accept"), { reserved: -1, active: 1 });
  assert.deepEqual(capacityDeltaForClose("assigned"), { reserved: -1, active: 0 });
  assert.equal(LEGAL_TRANSITIONS.escalate.to, "queued");
  assert.equal(LEGAL_TRANSITIONS.accept.to, "active");

  const categories = new Set(LIFECYCLE_SCENARIOS.map((s) => s.category));
  for (const required of [
    "customer_ai",
    "handoff",
    "offers",
    "accept_capacity",
    "transfer",
    "reconnect",
    "agent_disconnect",
    "end_memory",
    "ai_surfaces",
    "failure_security",
  ]) {
    assert.ok(categories.has(required), `missing category ${required}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scenarios: LIFECYCLE_SCENARIOS.length,
        categories: [...categories].sort(),
        fixtures: LIFECYCLE_TEST_FIXTURES,
      },
      null,
      2,
    ),
  );
}

main();
