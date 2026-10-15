import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveConversationsResult,
  liveConversationParty,
  shouldMatchVisitorByPhone,
} from "./live-conversations.js";

test("live party follows conversation status", () => {
  assert.equal(liveConversationParty("bot_active"), "bot");
  assert.equal(liveConversationParty("queued"), "queue");
  assert.equal(liveConversationParty("assigned"), "agent");
  assert.equal(liveConversationParty("active"), "agent");
});

test("phone visitor match is used for a national number and skipped for a social id", () => {
  assert.equal(shouldMatchVisitorByPhone("9876543210", null), true);
  assert.equal(shouldMatchVisitorByPhone("+91 98765 43210", "whatsapp_phone"), true);
  assert.equal(shouldMatchVisitorByPhone("17841400000000000", "instagram_user"), false);
  assert.equal(shouldMatchVisitorByPhone("cdp_1003_suji", "cdp_id"), false);
  assert.equal(shouldMatchVisitorByPhone("12345", null), false);
});

test("empty live list stays not live and keeps the matched contact", () => {
  const result = buildLiveConversationsResult({
    contactId: "cdp_1003_suji",
    matchedAs: "whatsapp_phone",
    conversations: [],
  });
  assert.deepEqual(result, {
    contactId: "cdp_1003_suji",
    matchedAs: "whatsapp_phone",
    live: false,
    channels: [],
    conversations: [],
  });
});

test("channels are the distinct open channels in conversation order", () => {
  const result = buildLiveConversationsResult({
    contactId: "cdp_1003_suji",
    matchedAs: "cdp_id",
    conversations: [
      {
        conversationId: "104821",
        channel: "whatsapp",
        status: "active",
        with: "agent",
        assignedUserId: "5012",
        startedAt: "2026-10-08T08:15:00.000Z",
        updatedAt: "2026-10-08T08:22:10.000Z",
      },
      {
        conversationId: "104900",
        channel: "webchat",
        status: "bot_active",
        with: "bot",
        assignedUserId: null,
        startedAt: "2026-10-08T08:21:40.000Z",
        updatedAt: "2026-10-08T08:21:40.000Z",
      },
    ],
  });
  assert.equal(result.live, true);
  assert.deepEqual(result.channels, ["whatsapp", "webchat"]);
});

test("a visitor hit with no profile borrows matchedAs from the channel", () => {
  const result = buildLiveConversationsResult({
    contactId: null,
    matchedAs: null,
    conversations: [
      {
        conversationId: "104900",
        channel: "instagram",
        status: "queued",
        with: "queue",
        assignedUserId: null,
        startedAt: "2026-10-08T08:21:40.000Z",
        updatedAt: "2026-10-08T08:21:40.000Z",
      },
    ],
  });
  assert.equal(result.contactId, null);
  assert.equal(result.matchedAs, "instagram_user");
  assert.equal(result.live, true);
});
