import assert from "node:assert/strict";
import test from "node:test";

import {
  capacityDeltaForClose,
  expectedCapacityDelta,
  isLegalTransition,
  LEGAL_TRANSITIONS,
} from "./lifecycle-contract.js";
import { getScenarioById, scenariosByCategory } from "./lifecycle-scenario-manifest.js";
import {
  endConversationSchema,
  handoffSchema,
  startsNewHandoffEpisode,
  transferConversationSchema,
  triedAgentIdsForCurrentRoutingCycle,
} from "./conversations.js";

test("webchat handoff schema does not require a widget queue id", () => {
  const parsed = handoffSchema.parse({
    reason: "explicit_request",
    selectedQueueKey: "Billing",
    intent: "billing",
    candidateSkills: ["billing"],
  });
  assert.equal(parsed.queueId, undefined);
  assert.equal(parsed.selectedQueueKey, "Billing");
});

test("handoff scenarios require queue or offered ownership", () => {
  for (const scenario of scenariosByCategory("handoff")) {
    const owners = Array.isArray(scenario.expectedOwner)
      ? scenario.expectedOwner
      : [scenario.expectedOwner];
    assert.ok(
      owners.some((owner) =>
        ["queue", "offered_agent", "active_agent"].includes(owner),
      ),
      `scenario ${scenario.id} has unexpected owner`,
    );
  }
});

test("accept capacity moves reserved to active once", () => {
  assert.deepEqual(expectedCapacityDelta("accept"), { reserved: -1, active: 1 });
  assert.equal(isLegalTransition("accept", "assigned"), true);
  assert.equal(isLegalTransition("accept", "active"), false);
});

test("customer close while ringing releases reserved capacity", () => {
  const scenario = getScenarioById(41);
  assert.ok(scenario);
  assert.deepEqual(scenario!.capacityDelta, { reserved: -1, active: 0 });
  assert.deepEqual(capacityDeltaForClose("assigned"), { reserved: -1, active: 0 });
});

test("transfer schema requires target queue", () => {
  assert.equal(
    transferConversationSchema.safeParse({
      notes: "missing queue",
    }).success,
    false,
  );
  assert.equal(
    transferConversationSchema.safeParse({
      queueId: "1002",
    }).success,
    true,
  );
});

test("agent end requires disposition payload shape", () => {
  const withoutDisposition = endConversationSchema.parse({
    actor: "agent",
    reason: "agent_ended",
  });
  assert.equal(withoutDisposition.disposition, undefined);

  const withDisposition = endConversationSchema.parse({
    actor: "agent",
    reason: "agent_ended",
    disposition: { code: "resolved", note: "Fixed" },
  });
  assert.equal(withDisposition.disposition?.code, "resolved");
});

test("offer and reject return ownership to queue", () => {
  assert.equal(LEGAL_TRANSITIONS.reject.to, "queued");
  assert.equal(LEGAL_TRANSITIONS.offer_timeout.to, "queued");
  assert.equal(LEGAL_TRANSITIONS.offer.from.includes("queued"), true);
});

test("a customer retry after bot fallback starts a new handoff episode", () => {
  assert.equal(startsNewHandoffEpisode("bot_active"), true);
  assert.equal(startsNewHandoffEpisode("closed"), true);
  assert.equal(startsNewHandoffEpisode("queued"), false);
  assert.equal(startsNewHandoffEpisode("assigned"), false);
});

test("reroute excludes only agents tried in the current handoff cycle", () => {
  const triedAgentIds = triedAgentIdsForCurrentRoutingCycle(
    [
      { agent_id: "1003", offered_at: new Date("2026-08-17T07:14:14.000Z") },
      { agent_id: "1000", offered_at: new Date("2026-08-17T10:03:16.000Z") },
      { agent_id: "1000", offered_at: new Date("2026-08-17T10:03:20.000Z") },
    ],
    "2026-08-17T10:03:00.000Z",
  );

  assert.deepEqual(triedAgentIds, ["1000"]);
});

test("reroute safely excludes all tried agents when the cycle boundary is unavailable", () => {
  const triedAgentIds = triedAgentIdsForCurrentRoutingCycle(
    [
      { agent_id: "1000", offered_at: new Date("2026-08-17T10:03:16.000Z") },
      { agent_id: "1003", offered_at: new Date("2026-08-17T10:05:13.000Z") },
    ],
    null,
  );

  assert.deepEqual(triedAgentIds, ["1000", "1003"]);
});
