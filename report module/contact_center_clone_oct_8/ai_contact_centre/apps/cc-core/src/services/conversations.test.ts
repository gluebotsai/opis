import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentMetadataSchema,
  endConversationSchema,
  isEndedConversationStatus,
  mapLegacyStatusToLifecycle,
  messageReceiptSchema,
  saveDispositionSchema,
  transferConversationSchema,
} from "./conversations.js";

test("legacy statuses map to explicit lifecycle states", () => {
  assert.equal(mapLegacyStatusToLifecycle("bot_active"), "bot");
  assert.equal(mapLegacyStatusToLifecycle("queued"), "waiting");
  assert.equal(mapLegacyStatusToLifecycle("assigned"), "offered");
  assert.equal(mapLegacyStatusToLifecycle("active"), "connected");
  assert.equal(mapLegacyStatusToLifecycle("resolved"), "ended");
  assert.equal(mapLegacyStatusToLifecycle("closed"), "ended");
});

test("resolved and legacy closed conversations are already ended", () => {
  assert.equal(isEndedConversationStatus("resolved"), true);
  assert.equal(isEndedConversationStatus("closed"), true);
  assert.equal(isEndedConversationStatus("active"), false);
});

test("receipt and attachment metadata contracts reject invalid payloads", () => {
  assert.equal(
    messageReceiptSchema.safeParse({
      messageId: "1001",
      recipientType: "visitor",
      status: "read",
    }).success,
    true,
  );
  assert.equal(
    attachmentMetadataSchema.safeParse({
      storageKey: "tenant/messages/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      byteSize: 42,
    }).success,
    true,
  );
  assert.equal(
    attachmentMetadataSchema.safeParse({
      storageKey: "tenant/messages/file.pdf",
      fileName: "file.pdf",
      contentType: "application/pdf",
      byteSize: -1,
    }).success,
    false,
  );
});

test("transfer requires a queue and supports an optional target agent", () => {
  const payload = transferConversationSchema.parse({
    queueId: "1001",
    agentId: "1002",
    notes: "Customer needs billing support",
    resolution: { code: "needs_billing", data: { verified: true } },
  });
  assert.equal(payload.agentId, "1002");
});

test("disposition requires an id or code", () => {
  assert.equal(saveDispositionSchema.safeParse({ note: "missing selection" }).success, false);
  assert.equal(saveDispositionSchema.safeParse({ code: "follow_up" }).success, true);
});

test("end semantics distinguish customer and session actors", () => {
  assert.equal(
    endConversationSchema.parse({ actor: "customer", reason: "customer_left" }).actor,
    "customer",
  );
  assert.equal(
    endConversationSchema.parse({ actor: "session", reason: "session_expired" }).actor,
    "session",
  );
});
