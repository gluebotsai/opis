/**
 * Run: npx tsx src/lib/create-campaign-transcript.selftest.ts
 */
import {
  collapseDuplicateAssistantReplies,
  finalizeCreateCampaignMessages,
  isCreateStaticWelcomeMessage,
  mergeCreateCampaignChatMessages,
  upsertCreateCampaignAssistantReply,
} from "./create-campaign-transcript";
import type { ChatMessage } from "@/lib/campaign-drafts";

const draftId = "draft-test-uuid";
const staticWelcome: ChatMessage = {
  id: `static-welcome-${draftId}`,
  role: "assistant",
  text: "Welcome static",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const user: ChatMessage = {
  id: "u1",
  role: "user",
  text: "hi",
  createdAt: "2026-01-01T00:01:00.000Z",
};
const replyA: ChatMessage = {
  id: "a1",
  role: "assistant",
  text: "Hey! Short.",
  createdAt: "2026-01-01T00:02:00.000Z",
};
const replyB: ChatMessage = {
  id: "a2",
  role: "assistant",
  text: "Hi there! Longer assistant reply for the user.",
  createdAt: "2026-01-01T00:02:01.000Z",
};

if (!isCreateStaticWelcomeMessage(staticWelcome)) {
  throw new Error("static welcome detect");
}

const collapsed = collapseDuplicateAssistantReplies([
  staticWelcome,
  user,
  replyA,
  replyB,
]);
const nonStaticAfterUser = collapsed.filter(
  (m, i) =>
    m.role === "assistant" &&
    !isCreateStaticWelcomeMessage(m) &&
    i > collapsed.findIndex((x) => x.id === user.id),
);
if (nonStaticAfterUser.length !== 1) {
  throw new Error("expected one assistant reply per user turn");
}
if (!nonStaticAfterUser[0]!.text.includes("Longer")) {
  throw new Error("expected longer assistant reply to win");
}
if (!collapsed.some((m) => m.id === staticWelcome.id)) {
  throw new Error("static welcome must remain");
}

const merged = mergeCreateCampaignChatMessages(
  draftId,
  [staticWelcome, user],
  [user, replyB],
  { followUpReady: true, hydration: true, busy: false },
);
if (!merged.some((m) => m.id === staticWelcome.id)) {
  throw new Error("merge must keep static welcome");
}
if (!merged.some((m) => m.role === "user" && m.text === "hi")) {
  throw new Error("merge must keep user");
}
if (!merged.some((m) => m.text.includes("Longer"))) {
  throw new Error("merge must include server assistant");
}

const upserted = upsertCreateCampaignAssistantReply(
  draftId,
  [staticWelcome, user],
  "Hi there! Longer assistant reply for the user.",
);
if (upserted.filter((m) => m.role === "assistant" && !isCreateStaticWelcomeMessage(m)).length !== 1) {
  throw new Error("upsert must not duplicate assistant");
}

const finalized = finalizeCreateCampaignMessages(draftId, [
  staticWelcome,
  user,
  replyA,
]);
if (finalized.length !== 3) {
  throw new Error("finalize should keep static user reply");
}

console.log("create-campaign-transcript.selftest: ok");
