import assert from "node:assert/strict";
import test from "node:test";

import {
  PROACTIVE_ENGAGEMENT_CUSTOMER_TEXT,
  persistProactiveBotMessage,
} from "./proactive-bot-memory.js";

test("persistProactiveBotMessage writes transcript and NLP turn", async () => {
  const calls: { append?: unknown; nlp?: unknown } = {};

  const ok = await persistProactiveBotMessage("1003", "97827", "Hi from Hub!", {
    reason: "hub_proactive",
    deps: {
      appendMessage: async (_org, _conv, input) => {
        calls.append = input;
        return { id: "msg-9001" };
      },
      recordNlpTurn: async (_org, _conv, input) => {
        calls.nlp = input;
        return true;
      },
    },
  });

  assert.equal(ok, true);
  assert.deepEqual(calls.append, {
    senderType: "bot",
    body: "Hi from Hub!",
    direction: "outbound",
    modelMetadata: { source: "hub_proactive", reason: "hub_proactive" },
  });
  assert.deepEqual(calls.nlp, {
    customerText: PROACTIVE_ENGAGEMENT_CUSTOMER_TEXT,
    botReply: "Hi from Hub!",
    botMessageId: "msg-9001",
    runtimeType: "webchat_bot",
    summary: "Hub proactive: hub_proactive",
  });
});

test("persistProactiveBotMessage skips blank text", async () => {
  let called = false;
  const ok = await persistProactiveBotMessage("1003", "97827", "   ", {
    deps: {
      appendMessage: async () => {
        called = true;
        return { id: "msg-1" };
      },
      recordNlpTurn: async () => true,
    },
  });
  assert.equal(ok, false);
  assert.equal(called, false);
});

test("persistProactiveBotMessage returns false when append fails", async () => {
  const ok = await persistProactiveBotMessage("1003", "97827", "Hello", {
    deps: {
      appendMessage: async () => null,
      recordNlpTurn: async () => true,
    },
  });
  assert.equal(ok, false);
});
