import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBotSessionSummaryFromTurns,
  DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS,
  isSessionIdleExpired,
  isSocialSessionChannel,
} from "./social-session.js";

test("isSocialSessionChannel recognizes whatsapp instagram facebook", () => {
  assert.equal(isSocialSessionChannel("whatsapp"), true);
  assert.equal(isSocialSessionChannel("instagram"), true);
  assert.equal(isSocialSessionChannel("facebook"), true);
  assert.equal(isSocialSessionChannel("email"), false);
});

test("isSessionIdleExpired uses configured inactivity window", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");
  const updatedAt = "2026-08-14T11:59:59.000Z";
  assert.equal(isSessionIdleExpired(updatedAt, DEFAULT_SOCIAL_INACTIVITY_CLOSE_HOURS, now), true);
  assert.equal(isSessionIdleExpired("2026-08-14T12:00:01.000Z", 24, now), false);
});

test("buildBotSessionSummaryFromTurns captures recent turns and intents", () => {
  const summary = buildBotSessionSummaryFromTurns([
    {
      id: "1",
      nlpConversationId: "nlp-1",
      conversationId: "10",
      turnNumber: 1,
      customerText: "Hello",
      botReply: "Hi there",
      intent: "greeting",
      confidence: 0.9,
      handoffRecommended: false,
      handoffReason: null,
      traceId: null,
      createdAt: "2026-08-15T10:00:00.000Z",
    },
    {
      id: "2",
      nlpConversationId: "nlp-1",
      conversationId: "10",
      turnNumber: 2,
      customerText: "What are your hours?",
      botReply: "We are open 9-6",
      intent: "hours",
      confidence: 0.95,
      handoffRecommended: false,
      handoffReason: null,
      traceId: null,
      createdAt: "2026-08-15T10:01:00.000Z",
    },
  ]);

  assert.match(summary.rollingSummary, /Hello/);
  assert.match(summary.rollingSummary, /hours/i);
  assert.deepEqual(summary.extractedFacts, ["greeting", "hours"]);
});
