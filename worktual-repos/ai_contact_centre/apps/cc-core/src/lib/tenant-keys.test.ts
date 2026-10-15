import assert from "node:assert/strict";
import test from "node:test";

import {
  offerGenerationKey,
  organizationLockKey,
  presenceAgentKey,
  transferActionOperationKey,
  umnCallSessionKey,
} from "./redis-keys.js";
import {
  conversationRoom,
  internalChatRoom,
  organizationRoom,
  userRoom,
} from "./socket-rooms.js";

test("Redis keys isolate overlapping entity ids by organization", () => {
  assert.equal(presenceAgentKey("10", "7"), "org:10:cc:presence:agent:7");
  assert.notEqual(presenceAgentKey("10", "7"), presenceAgentKey("20", "7"));
  assert.notEqual(umnCallSessionKey("10", "same-session"), umnCallSessionKey("20", "same-session"));
  assert.notEqual(transferActionOperationKey("10", "op-1"), transferActionOperationKey("20", "op-1"));
  assert.notEqual(offerGenerationKey("10", "7"), offerGenerationKey("20", "7"));
});

test("distributed lock keys retain organization and resource scope", () => {
  assert.equal(
    organizationLockKey("10", "capacity", "agent-7", "voice"),
    "org:10:cc:lock:capacity:agent-7:voice",
  );
  assert.notEqual(
    organizationLockKey("10", "capacity", "agent-7", "voice"),
    organizationLockKey("20", "capacity", "agent-7", "voice"),
  );
});

test("Socket.IO rooms are organization-qualified at every scope", () => {
  assert.equal(organizationRoom("10"), "org:10");
  assert.equal(userRoom("10", "7"), "org:10:user:7");
  assert.equal(conversationRoom("10", "9"), "org:10:conversation:9");
  assert.equal(internalChatRoom("10", "11"), "org:10:internal-chat:11");
  assert.notEqual(userRoom("10", "7"), userRoom("20", "7"));
  assert.notEqual(conversationRoom("10", "9"), conversationRoom("20", "9"));
});

test("tenant key and room builders reject missing organization scope", () => {
  assert.throws(() => presenceAgentKey("", "7"), /organizationId is required/);
  assert.throws(() => userRoom("", "7"), /organizationId is required/);
});
