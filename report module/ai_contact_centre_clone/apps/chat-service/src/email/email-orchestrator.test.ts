import assert from "node:assert/strict";
import test from "node:test";

import {
  requiresEmailHandoff,
  selectAllowedEmailQueue,
} from "./email-orchestrator.js";
import type { NlpEmailTurn } from "../services/nlp-client.js";

const profiles = [
  {
    key: "11111111-1111-4111-8111-111111111111",
    queueId: "11111111-1111-4111-8111-111111111111",
    name: "Billing",
    description: "Billing questions",
    intents: ["billing"],
    skills: ["billing"],
    classifierVersion: "v1",
  },
  {
    key: "22222222-2222-4222-8222-222222222222",
    queueId: "22222222-2222-4222-8222-222222222222",
    name: "Support",
    description: "Technical support",
    intents: ["technical_support"],
    skills: ["technical"],
    classifierVersion: "v2",
  },
];

const approved: NlpEmailTurn = {
  reply: "Grounded answer",
  confidence: 0.95,
  grounded: true,
  intent: "billing",
  selectedQueueKey: profiles[0]!.key,
  candidateSkills: ["billing"],
  summary: null,
  sentiment: "neutral",
  importantFacts: [],
  knowledgeUsed: ["kb-1"],
  handoffRecommended: false,
  handoffReason: null,
  guardPassed: true,
  guardReasons: [],
  urgency: "normal",
  traceId: "trace",
  modelName: "model",
};

test("queue selection accepts NLP key when it is in the allowed list", () => {
  assert.equal(selectAllowedEmailQueue(profiles[1]!.key, profiles, null), profiles[1]!.queueId);
  assert.equal(selectAllowedEmailQueue("Support", profiles, null), profiles[1]!.queueId);
  assert.equal(
    selectAllowedEmailQueue(
      "33333333-3333-4333-8333-333333333333",
      profiles,
      profiles[1]!.queueId,
    ),
    profiles[0]!.queueId,
  );
});

test("email handoff happens only when the agent recommends it", () => {
  assert.equal(requiresEmailHandoff(approved), false);
  assert.equal(requiresEmailHandoff({ ...approved, confidence: 0.84 }), false);
  assert.equal(requiresEmailHandoff({ ...approved, grounded: false }), false);
  assert.equal(requiresEmailHandoff({ ...approved, guardPassed: false }), false);
  assert.equal(requiresEmailHandoff({ ...approved, reply: null }), false);
  assert.equal(requiresEmailHandoff(null), false);
  assert.equal(requiresEmailHandoff({ ...approved, handoffRecommended: true }), true);
});
