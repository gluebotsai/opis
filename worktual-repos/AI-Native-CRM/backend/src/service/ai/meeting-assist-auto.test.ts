/**
 * run: npx tsx src/service/ai/meeting-assist-auto.test.ts
 */
import assert from "node:assert/strict";
import { shouldSkipAssistQuery } from "./meeting-assist-auto";

const now = 1_000_000;

const dropped = shouldSkipAssistQuery({
  query: "Can you explain about CRM in detail",
  score: 86,
  hash: "can you explain about crm in detail",
  lastQueryHash: "what are the products you have?",
  lastQueryScore: 172,
  lastAssistAt: now - 20_000,
  now,
  reason: "query",
});
assert.equal(dropped, false);

const same = shouldSkipAssistQuery({
  query: "What are the products you have?",
  score: 172,
  hash: "what are the products you have?",
  lastQueryHash: "what are the products you have?",
  lastQueryScore: 172,
  lastAssistAt: now - 5_000,
  now,
  reason: "query",
});
assert.equal(same, true);

const followUp = shouldSkipAssistQuery({
  query: "how it will suits for my business",
  score: 40,
  hash: "how it will suits for my business",
  lastQueryHash: "can you explain about crm in detail",
  lastQueryScore: 86,
  lastAssistAt: now - 2_000,
  now,
  reason: "query",
});
assert.equal(followUp, false);

console.log("meeting-assist-auto.test.ts ok");
