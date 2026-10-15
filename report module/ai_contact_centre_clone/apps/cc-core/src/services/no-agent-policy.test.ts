import assert from "node:assert/strict";
import test from "node:test";

import { LIFECYCLE_TEST_FIXTURES } from "./lifecycle-scenario-manifest.js";
import { LEGAL_TRANSITIONS } from "./lifecycle-contract.js";
import {
  customerNoticeSenderType,
  formatConnectedToAgentMessage,
  isOutOfHoursReason,
} from "./no-agent-policy.js";

test("out-of-hours reasons map to dedicated copy", () => {
  assert.equal(isOutOfHoursReason("outside_business_hours"), true);
  assert.equal(isOutOfHoursReason("no_shift_coverage"), true);
  assert.equal(isOutOfHoursReason("all_agents_busy"), false);
  assert.equal(
    formatConnectedToAgentMessage("Priya"),
    "You are connected to live agent Priya.",
  );
  assert.equal(
    formatConnectedToAgentMessage("  "),
    "You are connected to live agent our agent.",
  );
  assert.equal(customerNoticeSenderType("webchat"), "system");
  assert.equal(customerNoticeSenderType("whatsapp"), "bot");
});

test("no-agent behaviors match channel policy contract", () => {
  assert.deepEqual(
    [...LIFECYCLE_TEST_FIXTURES.noAgentBehaviors],
    ["queue_and_notify", "bot_continue", "close_with_message"],
  );
});

test("routing exhaustion transitions cover bot continue and close", () => {
  assert.equal(LEGAL_TRANSITIONS.routing_exhausted_to_bot.to, "bot_active");
  assert.equal(LEGAL_TRANSITIONS.routing_exhausted_to_bot.owner, "bot");
  assert.equal(LEGAL_TRANSITIONS.routing_exhausted_to_close.to, "closed");
  assert.equal(LEGAL_TRANSITIONS.routing_exhausted_to_close.owner, "closed");
});
