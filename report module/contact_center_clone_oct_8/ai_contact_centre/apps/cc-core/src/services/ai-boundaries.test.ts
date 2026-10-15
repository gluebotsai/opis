import assert from "node:assert/strict";
import test from "node:test";

import { recordCopilotTurnSchema } from "./copilot-turns.js";
import { getScenarioById } from "./lifecycle-scenario-manifest.js";

test("coworker surface must not target a customer conversation id", () => {
  const parsed = recordCopilotTurnSchema.parse({
    surface: "coworker",
    conversationId: "1001",
    agentInput: "rewrite this",
  });
  assert.equal(parsed.surface, "coworker");
  assert.ok(parsed.conversationId);
});

test("copilot turns accept expectedEventSequence for stale detection", () => {
  const parsed = recordCopilotTurnSchema.parse({
    surface: "agent_copilot",
    conversationId: "1001",
    expectedEventSequence: 12,
    suggestionText: "Try this reply",
  });
  assert.equal(parsed.expectedEventSequence, 12);
});

test("copilot turns ignore non-numeric client correlation ids", () => {
  const parsed = recordCopilotTurnSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    surface: "inbox",
    agentInput: "hello",
  });
  assert.equal(parsed.id, "11111111-1111-4111-8111-111111111111");
});

test("scenario 62 requires coworker isolation from customer bot memory", () => {
  const scenario = getScenarioById(62);
  assert.ok(scenario);
  assert.equal(scenario!.memoryAction, "none");
  assert.equal(scenario!.category, "ai_surfaces");
});

test("scenario 8 requires bot stop after handoff", () => {
  const scenario = getScenarioById(8);
  assert.ok(scenario);
  const statuses = Array.isArray(scenario!.expectedStatus)
    ? scenario!.expectedStatus
    : [scenario!.expectedStatus];
  assert.ok(!statuses.includes("bot_active"));
});
