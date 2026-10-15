import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildInternalChatFileUrl,
  canonicalDmUserPair,
  mapPresenceForChat,
} from "./internal-chat.js";

test("mapPresenceForChat maps ready and offline", () => {
  assert.equal(mapPresenceForChat("ready"), "ready");
  assert.equal(mapPresenceForChat("offline"), "offline");
  assert.equal(mapPresenceForChat(null), "offline");
  assert.equal(mapPresenceForChat("break"), "not_ready");
});

test("canonicalDmUserPair sorts user ids", () => {
  assert.deepEqual(canonicalDmUserPair("12", "3"), { low: "3", high: "12" });
  assert.deepEqual(canonicalDmUserPair("5", "5"), { low: "5", high: "5" });
});

test("buildInternalChatFileUrl joins api base", () => {
  assert.equal(
    buildInternalChatFileUrl("/cc-core-api/v1", "42"),
    "/cc-core-api/v1/internal-chat/files/42",
  );
});
