import assert from "node:assert/strict";
import {
  decideConversationNurtureGate,
  GATE_RELEASE_MS,
  RESCORE_RETRY_MS,
  type ConversationGateDecision,
  type ConversationGateState,
} from "./nurture-conversation-gate";

function blocked(
  decision: ConversationGateDecision,
): Exclude<ConversationGateDecision, { action: "allow" }> {
  if (decision.action === "allow") {
    throw new Error("Expected conversation gate to block nurture");
  }
  return decision;
}

const now = new Date("2026-10-08T10:00:00.000Z");
const openLookup = {
  ok: true as const,
  contactId: "cdp_1003_suji",
  matchedAs: "cdp_id",
  live: true,
  channels: ["webchat"],
  conversations: [
    {
      conversationId: "104900",
      channel: "webchat" as const,
      status: "bot_active" as const,
      with: "bot" as const,
      assignedUserId: null,
      startedAt: "2026-10-08T09:58:00.000Z",
      updatedAt: "2026-10-08T09:59:00.000Z",
    },
  ],
};
const closedLookup = {
  ok: true as const,
  contactId: "cdp_1003_suji",
  matchedAs: "cdp_id",
  live: false,
  channels: [],
  conversations: [],
};

const live = decideConversationNurtureGate({
  lookup: openLookup,
  currentOmniHash: "old-hash",
  prior: null,
  postConversationScoreReady: false,
  now,
});
assert.equal(live.action, "wait");
assert.equal(blocked(live).reason, "live_conversation");
assert.equal(
  blocked(live).nextRetryAt.toISOString(),
  "2026-10-08T10:00:30.000Z",
);

const liveState = blocked(live).state;
const summaryPending = decideConversationNurtureGate({
  lookup: closedLookup,
  currentOmniHash: "old-hash",
  prior: liveState,
  postConversationScoreReady: false,
  now,
});
assert.equal(summaryPending.action, "wait");
assert.equal(
  blocked(summaryPending).reason,
  "awaiting_omni_summary",
);

const summaryReady = decideConversationNurtureGate({
  lookup: closedLookup,
  currentOmniHash: "new-hash",
  prior: liveState,
  postConversationScoreReady: false,
  now,
});
assert.equal(summaryReady.action, "rescore");
assert.equal(
  blocked(summaryReady).state.summaryHash,
  "new-hash",
);

const awaitingRescore =
  summaryReady.action === "rescore"
    ? summaryReady.state
    : (null as unknown as ConversationGateState);
assert.equal(
  decideConversationNurtureGate({
    lookup: closedLookup,
    currentOmniHash: "new-hash",
    prior: awaitingRescore,
    postConversationScoreReady: false,
    now,
  }).action,
  "wait",
);
assert.equal(
  decideConversationNurtureGate({
    lookup: closedLookup,
    currentOmniHash: "new-hash",
    prior: awaitingRescore,
    postConversationScoreReady: true,
    now,
  }).action,
  "allow",
  "a completed score releases nurture even when the numeric score is unchanged",
);

const afterBackoff = new Date(now.getTime() + RESCORE_RETRY_MS);
const retried = decideConversationNurtureGate({
  lookup: closedLookup,
  currentOmniHash: "new-hash",
  prior: awaitingRescore,
  postConversationScoreReady: false,
  now: afterBackoff,
});
assert.equal(retried.action, "rescore");
assert.equal(blocked(retried).state.summaryHash, "new-hash");
assert.equal(
  blocked(retried).state.rescoreRequestedAt,
  afterBackoff.toISOString(),
);

const stillRunning = decideConversationNurtureGate({
  lookup: closedLookup,
  currentOmniHash: "new-hash",
  prior: awaitingRescore,
  postConversationScoreReady: false,
  rescoreInFlight: true,
  now: afterBackoff,
});
assert.equal(stillRunning.action, "wait");
assert.equal(blocked(stillRunning).reason, "awaiting_post_conversation_score");

const summaryMissing = decideConversationNurtureGate({
  lookup: closedLookup,
  currentOmniHash: null,
  prior: awaitingRescore,
  postConversationScoreReady: false,
  now: afterBackoff,
});
assert.equal(summaryMissing.action, "wait");
assert.equal(blocked(summaryMissing).reason, "awaiting_omni_summary");
assert.notEqual(blocked(summaryMissing).state.phase, "awaiting_rescore");

const unseen = decideConversationNurtureGate({
  lookup: closedLookup,
  currentOmniHash: "existing-hash",
  prior: null,
  postConversationScoreReady: false,
  now,
});
assert.equal(
  unseen.action,
  "allow",
  "every channel false continues nurture without waiting for a conversation",
);

const stuckWaiting = decideConversationNurtureGate({
  lookup: closedLookup,
  currentOmniHash: null,
  prior: {
    phase: "awaiting_conversation",
    lastCheckedAt: "2026-10-12T11:51:36.516Z",
  },
  postConversationScoreReady: false,
  now,
});
assert.equal(stuckWaiting.action, "allow");

const stillOpen = decideConversationNurtureGate({
  lookup: openLookup,
  currentOmniHash: "mid-chat-hash",
  prior: liveState,
  postConversationScoreReady: false,
  now,
});
assert.equal(stillOpen.action, "wait");
assert.equal(blocked(stillOpen).state.baselineOmniHash, "mid-chat-hash");
assert.equal(
  decideConversationNurtureGate({
    lookup: closedLookup,
    currentOmniHash: "mid-chat-hash",
    prior: blocked(stillOpen).state,
    postConversationScoreReady: false,
    now,
  }).action,
  "wait",
  "the summary captured while the chat was open does not release nurture",
);

const failed = decideConversationNurtureGate({
  lookup: { ok: false, error: "network_down" },
  currentOmniHash: null,
  prior: null,
  postConversationScoreReady: false,
  now,
});
assert.equal(failed.action, "wait");
assert.equal(
  blocked(failed).reason,
  "live_conversation_api_unavailable",
);

const lookupDownFor = decideConversationNurtureGate({
  lookup: { ok: false, error: "network_down" },
  currentOmniHash: null,
  prior: blocked(failed).state,
  postConversationScoreReady: false,
  now: new Date(now.getTime() + GATE_RELEASE_MS),
});
assert.equal(
  lookupDownFor.action,
  "allow",
  "a live-conversation lookup that stays down releases nurture",
);

const summaryNeverArrives = decideConversationNurtureGate({
  lookup: closedLookup,
  currentOmniHash: "old-hash",
  prior: liveState,
  postConversationScoreReady: false,
  now: new Date(now.getTime() + GATE_RELEASE_MS),
});
assert.equal(
  summaryNeverArrives.action,
  "allow",
  "a chat that ended without a new summary releases nurture",
);

const stillTalking = decideConversationNurtureGate({
  lookup: openLookup,
  currentOmniHash: "old-hash",
  prior: liveState,
  postConversationScoreReady: false,
  now: new Date(now.getTime() + GATE_RELEASE_MS),
});
assert.equal(stillTalking.action, "wait");
assert.equal(blocked(stillTalking).reason, "live_conversation");

console.log("nurture-conversation-gate.test.ts ok");
