import assert from "node:assert/strict";
import test from "node:test";

import { WebchatSessionStore } from "../services/webchat-session-store.js";

test("session store resumes the same conversation id after lookup", () => {
  const store = new WebchatSessionStore();
  const first = store.getOrCreate("wc_1", "visitor_1", "conv-aaa");
  const second = store.getOrCreate("wc_1", "visitor_1", "conv-bbb");
  assert.equal(first.conversationId, "conv-aaa");
  assert.equal(second.conversationId, "conv-aaa");
  assert.equal(store.get("wc_1", "visitor_1")?.conversationId, "conv-aaa");
});

test("session end clears local cache so durable resume can rebuild", () => {
  const store = new WebchatSessionStore();
  store.getOrCreate("wc_1", "visitor_1", "conv-aaa");
  store.end("wc_1", "visitor_1");
  assert.equal(store.get("wc_1", "visitor_1"), undefined);
});

test("local messages are preserved for soft reconnect", () => {
  const store = new WebchatSessionStore();
  store.getOrCreate("wc_1", "visitor_1", "conv-aaa");
  store.addMessage("wc_1", "visitor_1", {
    from: "user",
    text: "hello",
    at: new Date().toISOString(),
  });
  assert.equal(store.get("wc_1", "visitor_1")?.messages.length, 1);
});

test("replaceConversationId updates the active session", () => {
  const store = new WebchatSessionStore();
  store.getOrCreate("wc_1", "visitor_1", "conv-aaa");
  store.replaceConversationId("wc_1", "visitor_1", "conv-resumed");
  assert.equal(store.get("wc_1", "visitor_1")?.conversationId, "conv-resumed");
});

test("markStartupComplete gates message handling", () => {
  const store = new WebchatSessionStore();
  store.getOrCreate("wc_1", "visitor_1", "conv-aaa");
  assert.equal(store.get("wc_1", "visitor_1")?.startupComplete, undefined);
  store.markStartupComplete("wc_1", "visitor_1");
  assert.equal(store.get("wc_1", "visitor_1")?.startupComplete, true);
});

test("getOrCreate reserves a session slot before async startup completes", () => {
  const store = new WebchatSessionStore();
  store.getOrCreate("wc_1", "visitor_1", "conv-pending");
  const duringStartup = store.get("wc_1", "visitor_1");
  assert.ok(duringStartup);
  assert.equal(duringStartup?.conversationId, "conv-pending");
  assert.notEqual(duringStartup?.startupComplete, true);
});
