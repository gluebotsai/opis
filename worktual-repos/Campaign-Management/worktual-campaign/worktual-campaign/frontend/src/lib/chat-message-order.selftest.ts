/**
 * Run: npx tsx src/lib/chat-message-order.selftest.ts
 */
import {
  mergeMessagesServerWinsPendingLocal,
  type ChatMessage,
} from "@/lib/campaign-drafts";
import {
  chatMessageOrderChanged,
  hasFixableChatInversion,
  sortChatMessagesStable,
} from "@/lib/chat-message-order";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const u1: ChatMessage = {
  id: "u1",
  role: "user",
  text: "first",
  createdAt: "2026-09-29T10:00:00.000Z",
};
const a1: ChatMessage = {
  id: "a1",
  role: "assistant",
  text: "reply",
  createdAt: "2026-09-29T10:00:01.000Z",
};
const u2: ChatMessage = {
  id: "u2",
  role: "user",
  text: "second",
  createdAt: "2026-09-29T10:05:00.000Z",
};

const scrambled = [u2, u1, a1];
assert(hasFixableChatInversion(scrambled), "detect scrambled thread");
const sorted = sortChatMessagesStable(scrambled);
assert(
  sorted.map((m) => m.id).join(",") === "u1,a1,u2",
  "sort fixes scrambled local cache",
);

const localThread = [u1, a1, u2];
const merged = mergeMessagesServerWinsPendingLocal(localThread, [u1]);
assert(
  merged.map((m) => m.id).join(",") === "u1,a1,u2",
  "short remote merge keeps chronological order",
);

const mergedScramble = mergeMessagesServerWinsPendingLocal(scrambled, [u1, a1, u2]);
assert(
  mergedScramble.map((m) => m.id).join(",") === "u1,a1,u2",
  "merge+sort repairs scrambled local against full remote",
);

assert(
  chatMessageOrderChanged(scrambled, sorted),
  "order change detected",
);

console.log("chat-message-order.selftest: ok");
