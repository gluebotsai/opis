import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentSessionTranscript,
  filterAgentSessionMessages,
} from "./wrap-up-suggest.js";
import type { MessageRecord } from "./conversations.js";

function message(
  partial: Partial<MessageRecord> & Pick<MessageRecord, "senderType" | "body">,
): MessageRecord {
  return {
    id: partial.id ?? "msg-1",
    conversationId: partial.conversationId ?? "conv-1",
    direction: partial.direction ?? "inbound",
    visibility: partial.visibility ?? "customer",
    deliveryState: partial.deliveryState ?? "delivered",
    messageType: partial.messageType ?? "text",
    sentAt: partial.sentAt ?? "2026-08-11T05:00:00.000Z",
    attachments: partial.attachments ?? [],
    createdAt: partial.createdAt ?? partial.sentAt ?? "2026-08-11T05:00:00.000Z",
    senderType: partial.senderType,
    body: partial.body,
  };
}

test("filterAgentSessionMessages keeps only post-assignment customer and agent turns", () => {
  const messages = [
    message({
      id: "1",
      senderType: "bot",
      body: "How can I help?",
      sentAt: "2026-08-11T05:00:00.000Z",
    }),
    message({
      id: "2",
      senderType: "customer",
      body: "Need a live agent",
      sentAt: "2026-08-11T05:01:00.000Z",
    }),
    message({
      id: "3",
      senderType: "system",
      body: "Connecting you with a live agent",
      sentAt: "2026-08-11T05:02:00.000Z",
    }),
    message({
      id: "4",
      senderType: "agent",
      body: "Hi, I can help",
      sentAt: "2026-08-11T05:03:00.000Z",
    }),
    message({
      id: "5",
      senderType: "customer",
      body: "Thanks, that worked",
      sentAt: "2026-08-11T05:04:00.000Z",
    }),
  ];

  const filtered = filterAgentSessionMessages(messages, "2026-08-11T05:03:00.000Z");
  assert.equal(filtered.length, 2);
  assert.deepEqual(
    filtered.map((entry) => entry.senderType),
    ["agent", "customer"],
  );
});

test("buildAgentSessionTranscript strips html and maps roles", () => {
  const transcript = buildAgentSessionTranscript(
    [
      message({
        senderType: "agent",
        body: "<p>Hello <strong>there</strong></p>",
        sentAt: "2026-08-11T05:03:00.000Z",
      }),
    ],
    "2026-08-11T05:03:00.000Z",
  );
  assert.deepEqual(transcript, [
    {
      role: "agent",
      text: "Hello there",
      at: "2026-08-11T05:03:00.000Z",
    },
  ]);
});
