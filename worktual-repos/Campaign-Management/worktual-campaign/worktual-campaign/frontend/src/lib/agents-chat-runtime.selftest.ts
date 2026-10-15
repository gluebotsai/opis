/**
 * Run: npx tsx src/lib/agents-chat-runtime.selftest.ts
 */
import {
  appendAssistantDeduped,
  applySessionReadyChatMessages,
  isAgentBusyError,
  isHydrationSessionReady,
  sessionReadyPhase,
  shouldPreserveLocalTranscriptOnReady,
  transcriptHasUser,
} from "./agents-chat-runtime";

const user = { id: "u1", role: "user" as const, text: "hello" };
const welcome = { id: "w1", role: "assistant" as const, text: "Welcome" };

if (sessionReadyPhase({ ready_phase: "hydration" }) !== "hydration") {
  throw new Error("hydration phase");
}
if (sessionReadyPhase({}) !== "initial") {
  throw new Error("default initial phase");
}
if (!isHydrationSessionReady({ ready_phase: "hydration" })) {
  throw new Error("isHydrationSessionReady");
}

if (!transcriptHasUser([welcome, user])) {
  throw new Error("transcriptHasUser");
}

if (
  !shouldPreserveLocalTranscriptOnReady({
    prev: [welcome, user],
    remote: [welcome],
    busy: true,
    followUpReady: true,
    hydration: true,
  })
) {
  throw new Error("preserve local on hydration while busy");
}

const merged = applySessionReadyChatMessages([welcome, user], [welcome], {
  busy: true,
  followUpReady: true,
  hydration: true,
});
if (merged.length !== 2 || merged[1]?.text !== "hello") {
  throw new Error("applySessionReady should keep in-flight user turn");
}

const assistant = {
  id: "a1",
  role: "assistant" as const,
  text: "How can I help?",
};
if (
  shouldPreserveLocalTranscriptOnReady({
    prev: [welcome, user],
    remote: [welcome, user, assistant],
    busy: false,
    followUpReady: true,
    hydration: true,
  })
) {
  throw new Error("hydration must merge when server already has assistant reply");
}
const mergedWithReply = applySessionReadyChatMessages(
  [welcome, user],
  [welcome, user, assistant],
  { followUpReady: true, hydration: true, busy: false },
);
if (mergedWithReply.length !== 3 || mergedWithReply[2]?.text !== assistant.text) {
  throw new Error("applySessionReady should merge assistant on hydration when ready");
}

const deduped = appendAssistantDeduped(
  [{ id: "a1", role: "assistant", text: "Same" }],
  "Same",
);
if (deduped.length !== 1) {
  throw new Error("appendAssistantDeduped should skip duplicate");
}

if (!isAgentBusyError({ code: "agent_busy" })) {
  throw new Error("agent_busy code");
}
if (!isAgentBusyError({ message: "Please wait for the current agent response." })) {
  throw new Error("agent_busy message");
}
if (isAgentBusyError({ message: "Network error" })) {
  throw new Error("unrelated error must not be busy");
}

console.log("agents-chat-runtime.selftest: ok");
