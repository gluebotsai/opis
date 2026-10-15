import assert from "node:assert/strict";
import test from "node:test";

import {
  isLoggedInPresenceState,
  isPresenceEligibleForChannel,
  isRoutablePresenceState,
} from "./presence-cache.js";
import { pickHandoffQueue, pickWebchatQueue, toRoutableChannel } from "./routing.js";

test("offer routable presence is ready only", () => {
  assert.equal(isRoutablePresenceState("ready"), true);
  assert.equal(isRoutablePresenceState("busy"), false);
  assert.equal(isRoutablePresenceState("offline"), false);
  assert.equal(isRoutablePresenceState("not_ready"), false);
  assert.equal(isRoutablePresenceState("break"), false);
  assert.equal(isRoutablePresenceState("away"), false);
  assert.equal(isRoutablePresenceState("after_contact_work"), false);
  assert.equal(isRoutablePresenceState(null), false);
});

test("logged-in presence excludes offline only", () => {
  assert.equal(isLoggedInPresenceState("ready"), true);
  assert.equal(isLoggedInPresenceState("busy"), true);
  assert.equal(isLoggedInPresenceState("away"), true);
  assert.equal(isLoggedInPresenceState("not_ready"), true);
  assert.equal(isLoggedInPresenceState("break"), true);
  assert.equal(isLoggedInPresenceState("after_contact_work"), true);
  assert.equal(isLoggedInPresenceState("offline"), false);
  assert.equal(isLoggedInPresenceState(null), false);
});

test("channel presence eligibility: every routed channel requires ready", () => {
  for (const channel of ["chat", "whatsapp", "instagram", "facebook", "webchat", "email"]) {
    assert.equal(isPresenceEligibleForChannel(channel, "ready"), true);
    assert.equal(isPresenceEligibleForChannel(channel, "available"), true);
    assert.equal(isPresenceEligibleForChannel(channel, "busy"), false);
    assert.equal(isPresenceEligibleForChannel(channel, "away"), false);
    assert.equal(isPresenceEligibleForChannel(channel, "offline"), false);
    assert.equal(isPresenceEligibleForChannel(channel, "not_ready"), false);
    assert.equal(isPresenceEligibleForChannel(channel, "break"), false);
    assert.equal(isPresenceEligibleForChannel(channel, "after_contact_work"), false);
    assert.equal(isPresenceEligibleForChannel(channel, null), false);
  }
});

test("email conversations use email routing capacity", () => {
  assert.equal(toRoutableChannel("email"), "email");
});

test("whatsapp conversations use whatsapp routing capacity", () => {
  assert.equal(toRoutableChannel("whatsapp"), "whatsapp");
});

test("instagram and facebook conversations use matching routing capacity", () => {
  assert.equal(toRoutableChannel("instagram"), "instagram");
  assert.equal(toRoutableChannel("facebook"), "facebook");
});

test("existing and unknown synchronous channels retain chat routing defaults", () => {
  assert.equal(toRoutableChannel("chat"), "chat");
  assert.equal(toRoutableChannel("webchat"), "chat");
});

const chatQueues = [
  { id: "1001", name: "Support", description: "Support", skills: ["support"], intents: ["general_inquiry"] },
  { id: "1002", name: "Billing", description: "Billing", skills: ["billing", "payments"], intents: ["billing"] },
  { id: "1003", name: "Sales", description: "Sales", skills: ["sales"], intents: ["sales"] },
];

test("handoff queue picker uses NLP selected key when it matches a queue", () => {
  assert.equal(pickHandoffQueue(chatQueues, { selectedQueueKey: "1002" }), "1002");
  assert.equal(pickHandoffQueue(chatQueues, { selectedQueueKey: "Billing" }), "1002");
  assert.equal(pickWebchatQueue(chatQueues, { selectedQueueKey: "1002" }), "1002");
});

test("handoff queue picker falls back to first active queue", () => {
  assert.equal(pickHandoffQueue(chatQueues, { selectedQueueKey: "support_bot" }), "1001");
  assert.equal(pickHandoffQueue(chatQueues, {}), "1001");
  assert.equal(pickHandoffQueue([], { selectedQueueKey: "billing" }), null);
});

test("handoff queue picker cannot select a queue outside the allowed list", () => {
  const allowed = chatQueues.filter((queue) => queue.id !== "1003");
  assert.equal(pickHandoffQueue(allowed, { selectedQueueKey: "1003" }), "1001");
  assert.equal(pickHandoffQueue(allowed, { selectedQueueKey: "1002" }), "1002");
});
