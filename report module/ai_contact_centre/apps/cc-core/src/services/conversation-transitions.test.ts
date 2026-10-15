import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGAL_TRANSITIONS,
  LIFECYCLE_MAP,
  OWNER_BY_STATUS,
  capacityDeltaForAgentDisconnect,
  capacityDeltaForClose,
  expectedCapacityDelta,
  isLegalTransition,
  ownerForStatus,
  type ConversationStatus,
  type TransitionEvent,
} from "./lifecycle-contract.js";
import {
  LIFECYCLE_SCENARIOS,
  LIFECYCLE_TEST_FIXTURES,
  getScenarioById,
  scenariosByCategory,
} from "./lifecycle-scenario-manifest.js";

const ALL_STATUSES: ConversationStatus[] = [
  "bot_active",
  "queued",
  "assigned",
  "active",
  "resolved",
  "closed",
];

test("every conversation status has a lifecycle state and owner", () => {
  for (const status of ALL_STATUSES) {
    assert.ok(LIFECYCLE_MAP[status], `missing lifecycle for ${status}`);
    assert.ok(OWNER_BY_STATUS[status], `missing owner for ${status}`);
    assert.equal(ownerForStatus(status), OWNER_BY_STATUS[status]);
  }
});

test("legal happy-path transitions are accepted", () => {
  const path: Array<[TransitionEvent, ConversationStatus]> = [
    ["start_bot", "bot_active"],
    ["escalate", "queued"],
    ["offer", "assigned"],
    ["accept", "active"],
    ["resolve", "resolved"],
    ["close", "closed"],
  ];

  let status: ConversationStatus = "bot_active";
  assert.equal(isLegalTransition("start_bot", status), true);

  for (const [event, next] of path.slice(1)) {
    assert.equal(isLegalTransition(event, status), true, `${event} from ${status}`);
    assert.equal(LEGAL_TRANSITIONS[event].to, next);
    status = next;
  }
});

test("illegal transitions are rejected", () => {
  assert.equal(isLegalTransition("accept", "bot_active"), false);
  assert.equal(isLegalTransition("offer", "active"), false);
  assert.equal(isLegalTransition("escalate", "assigned"), false);
  assert.equal(isLegalTransition("resolve", "queued"), false);
  assert.equal(isLegalTransition("reopen", "active"), false);
  assert.equal(isLegalTransition("transfer", "queued"), false);
});

test("capacity deltas match offer accept reject timeout resolve", () => {
  assert.deepEqual(expectedCapacityDelta("offer"), { reserved: 1, active: 0 });
  assert.deepEqual(expectedCapacityDelta("accept"), { reserved: -1, active: 1 });
  assert.deepEqual(expectedCapacityDelta("reject"), { reserved: -1, active: 0 });
  assert.deepEqual(expectedCapacityDelta("offer_timeout"), { reserved: -1, active: 0 });
  assert.deepEqual(expectedCapacityDelta("resolve"), { reserved: 0, active: -1 });
});

test("close and agent disconnect capacity depend on current status", () => {
  assert.deepEqual(capacityDeltaForClose("assigned"), { reserved: -1, active: 0 });
  assert.deepEqual(capacityDeltaForClose("active"), { reserved: 0, active: -1 });
  assert.deepEqual(capacityDeltaForClose("queued"), { reserved: 0, active: 0 });
  assert.deepEqual(capacityDeltaForAgentDisconnect("assigned"), { reserved: -1, active: 0 });
  assert.deepEqual(capacityDeltaForAgentDisconnect("active"), { reserved: 0, active: -1 });
});

test("reject and timeout return ownership to the queue", () => {
  assert.equal(LEGAL_TRANSITIONS.reject.owner, "queue");
  assert.equal(LEGAL_TRANSITIONS.offer_timeout.owner, "queue");
  assert.equal(LEGAL_TRANSITIONS.reject.to, "queued");
  assert.equal(LEGAL_TRANSITIONS.offer_timeout.to, "queued");
});

test("routing exhaustion can return to bot or close", () => {
  assert.equal(LEGAL_TRANSITIONS.routing_exhausted_to_bot.to, "bot_active");
  assert.equal(LEGAL_TRANSITIONS.routing_exhausted_to_close.to, "closed");
  assert.equal(isLegalTransition("routing_exhausted_to_bot", "queued"), true);
  assert.equal(isLegalTransition("routing_exhausted_to_close", "assigned"), true);
});

test("scenario manifest covers ids 1 through 75 exactly once", () => {
  assert.equal(LIFECYCLE_SCENARIOS.length, 75);
  const ids = LIFECYCLE_SCENARIOS.map((s) => s.id).sort((a, b) => a - b);
  for (let i = 1; i <= 75; i += 1) {
    assert.equal(ids[i - 1], i, `missing scenario ${i}`);
    const scenario = getScenarioById(i);
    assert.ok(scenario, `scenario ${i} missing`);
    assert.ok(scenario!.expectedStatus);
    assert.ok(scenario!.expectedOwner);
  }
});

test("test fixtures include queues agents skills dispositions and no-agent behaviors", () => {
  assert.deepEqual([...LIFECYCLE_TEST_FIXTURES.queues], ["queue_a", "queue_b", "overflow_queue"]);
  assert.deepEqual([...LIFECYCLE_TEST_FIXTURES.agents], ["agent_a", "agent_b", "agent_c"]);
  assert.ok(LIFECYCLE_TEST_FIXTURES.skills.includes("billing"));
  assert.ok(LIFECYCLE_TEST_FIXTURES.dispositions.includes("resolved"));
  assert.deepEqual(
    [...LIFECYCLE_TEST_FIXTURES.noAgentBehaviors],
    ["queue_and_notify", "bot_continue", "close_with_message"],
  );
});

test("handoff and offer scenario categories are populated", () => {
  assert.ok(scenariosByCategory("handoff").length >= 5);
  assert.ok(scenariosByCategory("offers").length >= 10);
  assert.ok(scenariosByCategory("reconnect").length >= 8);
  assert.ok(scenariosByCategory("failure_security").length >= 10);
});

test("IllegalTransitionError contract uses HTTP 409 semantics", async () => {
  const { IllegalTransitionError } = await import("./conversation-transitions.js");
  const err = new IllegalTransitionError("accept", "bot_active", "conv-1");
  assert.equal(err.httpStatus, 409);
  assert.equal(err.name, "IllegalTransitionError");
  assert.match(err.message, /Illegal transition/);
});
