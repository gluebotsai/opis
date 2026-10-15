import assert from "node:assert/strict";
import test from "node:test";

import {
  nlpTurnsToTranscript,
  upsertConversationMemorySchema,
} from "./conversation-memory.js";
import type { NlpTurnRecord } from "./nlp-conversations.js";

test("conversation memory upsert schema validates payload", () => {
  const parsed = upsertConversationMemorySchema.parse({
    rollingSummary: "Customer asked about billing.",
    extractedFacts: ["Billing issue"],
    modelName: "gpt-oss-120b",
  });
  assert.match(parsed.rollingSummary ?? "", /billing/i);
  assert.equal(parsed.extractedFacts?.length, 1);
});

test("nlpTurnsToTranscript maps customer and bot lines", () => {
  const turns: NlpTurnRecord[] = [
    {
      id: "1",
      nlpConversationId: "nlp-1",
      conversationId: "conv-1",
      turnNumber: 1,
      customerText: "I need a live agent",
      botReply: "All our agents are busy.",
      confidence: 0.9,
      intent: "live_agent",
      handoffRecommended: true,
      handoffReason: "explicit_request",
      traceId: null,
      createdAt: new Date().toISOString(),
    },
  ];
  assert.deepEqual(nlpTurnsToTranscript(turns), [
    { role: "user", content: "I need a live agent" },
    { role: "assistant", content: "All our agents are busy." },
  ]);
});
