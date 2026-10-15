import assert from "node:assert/strict";
import test from "node:test";

import { commitEmailBotDecisionSchema } from "./email-bot-decisions.js";
import { urgencyToPriority } from "./email-priority.js";

test("commitEmailBotDecisionSchema defaults urgency to normal", () => {
  const parsed = commitEmailBotDecisionSchema.parse({
    customerMessageId: "1001",
    customerText: "Need help with billing",
    reply: "Here is the billing policy.",
    confidence: 0.95,
    grounded: true,
    intent: "billing",
    selectedQueueKey: "1000",
    candidateSkills: [],
    summary: null,
    sentiment: "neutral",
    importantFacts: [],
    knowledgeUsed: [],
    handoffRecommended: false,
    handoffReason: null,
    guardPassed: true,
    guardReasons: [],
    traceId: null,
    modelName: "test",
    queueProfileVersion: null,
    delivery: null,
  });
  assert.equal(parsed.urgency, "normal");
});

test("commitEmailBotDecisionSchema ignores invalid captured contact emails", () => {
  const parsed = commitEmailBotDecisionSchema.parse({
    customerMessageId: "1001",
    customerText: "Need help",
    reply: "Sure.",
    confidence: 0.9,
    grounded: true,
    intent: "support",
    selectedQueueKey: "1000",
    candidateSkills: [],
    summary: null,
    sentiment: null,
    importantFacts: [],
    knowledgeUsed: [],
    handoffRecommended: false,
    handoffReason: null,
    guardPassed: true,
    guardReasons: [],
    traceId: null,
    modelName: "test",
    queueProfileVersion: null,
    delivery: null,
    contactEntities: { email: "not-an-email" },
  });
  assert.equal(parsed.contactEntities?.email, null);
});

test("commitEmailBotDecisionSchema accepts critical urgency for priority routing", () => {
  const parsed = commitEmailBotDecisionSchema.parse({
    customerMessageId: "1001",
    customerText: "Urgent outage",
    reply: null,
    confidence: 0.4,
    grounded: false,
    intent: "support",
    selectedQueueKey: "1000",
    candidateSkills: [],
    summary: null,
    sentiment: "negative",
    importantFacts: [],
    knowledgeUsed: [],
    handoffRecommended: true,
    handoffReason: "low_confidence",
    guardPassed: false,
    guardReasons: ["low_confidence"],
    urgency: "critical",
    traceId: null,
    modelName: "test",
    queueProfileVersion: null,
    delivery: null,
  });
  assert.equal(parsed.urgency, "critical");
  assert.equal(urgencyToPriority(parsed.urgency), 2);
});
