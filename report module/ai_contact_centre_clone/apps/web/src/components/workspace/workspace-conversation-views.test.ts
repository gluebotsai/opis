import assert from "node:assert/strict";
import test from "node:test";

import {
  didAppendLatestMessage,
  isConversationNearBottom,
} from "../../features/workspace/conversation-auto-scroll.js";

test("conversation is pinned only near the latest message", () => {
  assert.equal(isConversationNearBottom(1_000, 500, 400), false);
  assert.equal(isConversationNearBottom(1_000, 530, 400), true);
  assert.equal(isConversationNearBottom(1_000, 600, 400), true);
});

test("only an appended latest message triggers new-message behavior", () => {
  assert.equal(didAppendLatestMessage(5, 6, "message-5", "message-6"), true);
  assert.equal(didAppendLatestMessage(5, 8, "message-5", "message-5"), false);
  assert.equal(didAppendLatestMessage(5, 5, "message-5", "message-5"), false);
});
