import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage } from "./copilot-engine.ts";
import {
  formatInboxAssistMemory,
  inboxAssistMessageId,
  mergeInboxAssistTurns,
} from "./coworker-assist-memory.ts";

const welcome: ChatMessage = {
  id: "welcome",
  kind: "text",
  role: "assistant",
  content: "How can I help?",
  createdAt: "2026-09-20T00:00:00.000Z",
};

test("formats inbox assist memory for the panel coworker", () => {
  const text = formatInboxAssistMemory({
    id: "9001",
    conversationId: "110362",
    suggestionText: "I can check that for you.",
    copilotResponse: "",
    createdAt: "2026-09-20T00:00:01.000Z",
    assistState: {
      replyDraft: "I can check that for you.",
      privateNotes: [{ kind: "fact", text: "Caller wants a callback Friday" }],
    },
  });
  assert.equal(text, "I can check that for you.");
});

test("merges inbox assists after the welcome message and replaces stale ones", () => {
  const existing: ChatMessage[] = [
    welcome,
    {
      id: inboxAssistMessageId("1"),
      kind: "text",
      role: "assistant",
      content: "old",
      createdAt: "2026-09-20T00:00:01.000Z",
    },
    {
      id: "user-1",
      kind: "text",
      role: "user",
      content: "rewrite that",
      createdAt: "2026-09-20T00:00:02.000Z",
    },
  ];
  const merged = mergeInboxAssistTurns(existing, [
    {
      id: "2",
      conversationId: "110362",
      suggestionText: "Happy to help with that.",
      copilotResponse: null,
      createdAt: "2026-09-20T00:00:03.000Z",
    },
  ]);
  assert.equal(merged[0]?.id, "welcome");
  assert.equal(merged[1]?.id, inboxAssistMessageId("2"));
  assert.equal(merged[2]?.id, "user-1");
  assert.equal(merged.some((message) => message.id === inboxAssistMessageId("1")), false);
});

test("clears inbox assist memory when no conversation turns remain", () => {
  const merged = mergeInboxAssistTurns(
    [
      welcome,
      {
        id: inboxAssistMessageId("2"),
        kind: "text",
        role: "assistant",
        content: "Suggested reply: Hello",
        createdAt: "2026-09-20T00:00:03.000Z",
      },
    ],
    [],
  );
  assert.deepEqual(
    merged.map((message) => message.id),
    ["welcome"],
  );
});
