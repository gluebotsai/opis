import assert from "node:assert/strict";
import test from "node:test";

import {
  isRealAcdSessionId,
  resolveInboundWorkspaceSession,
  sameVoiceSessionId,
  shouldApplyVoiceOpenedEvent,
  shouldHoldConsultWorkspace,
  shouldOpenWorkspaceOnAcdEvent,
  shouldRecoverVoiceDisposition,
} from "./voice-workspace-open.ts";

test("isRealAcdSessionId rejects placeholder inbound threads", () => {
  assert.equal(isRealAcdSessionId("acd-123"), true);
  assert.equal(isRealAcdSessionId("sip-inbound:91915009118200"), false);
  assert.equal(isRealAcdSessionId(null), false);
});

test("resolveInboundWorkspaceSession prefers a real SIP ACD id", () => {
  assert.equal(
    resolveInboundWorkspaceSession({
      sipSessionId: "sess-2",
      pendingSessionId: "sess-1",
    }),
    "sess-2",
  );
  assert.equal(
    resolveInboundWorkspaceSession({
      sipSessionId: null,
      pendingSessionId: "sess-1",
    }),
    "sess-1",
  );
  assert.equal(
    resolveInboundWorkspaceSession({
      sipSessionId: "sip-inbound:9191",
      pendingSessionId: null,
    }),
    null,
  );
});

test("sameVoiceSessionId matches full and UUID-only ACD session variants", () => {
  const uuid = "e9b9b759-2ed9-1240-0093-bc2411477a90";
  assert.equal(sameVoiceSessionId(`+919150911820${uuid}`, uuid), true);
  assert.equal(sameVoiceSessionId(`+919150911820${uuid}`, "different"), false);
  assert.equal(sameVoiceSessionId(null, uuid), false);
});

test("live calls reject delayed voice.opened events from another ACD session", () => {
  const current = "+919150911820e9b9b759-2ed9-1240-0093-bc2411477a90";
  assert.equal(
    shouldApplyVoiceOpenedEvent({
      callState: "active",
      currentSessionId: current,
      eventSessionId: "e9b9b759-2ed9-1240-0093-bc2411477a90",
    }),
    true,
  );
  assert.equal(
    shouldApplyVoiceOpenedEvent({
      callState: "ringing",
      currentSessionId: current,
      eventSessionId: "+9173580214080986ac55-2ed8-1240-0093-bc2411477a90",
    }),
    false,
  );
  assert.equal(
    shouldApplyVoiceOpenedEvent({
      callState: "idle",
      currentSessionId: null,
      eventSessionId: current,
    }),
    true,
  );
});

test("consult answer holds B's workspace until A clicks Transfer", () => {
  assert.equal(
    shouldHoldConsultWorkspace({ secondaryConsultOnly: true, consultAnswered: true }),
    true,
  );
  assert.equal(
    shouldHoldConsultWorkspace({ secondaryConsultOnly: true }),
    true,
  );
  assert.equal(
    shouldHoldConsultWorkspace({ secondaryConsultOnly: false, consultAnswered: true }),
    true,
  );
  assert.equal(
    shouldHoldConsultWorkspace({ secondaryConsultOnly: false }),
    false,
  );
});

test("inbound workspace opens after the agent accepts the offer", () => {
  assert.equal(
    shouldOpenWorkspaceOnAcdEvent({
      callState: "ringing",
      inboundOffer: false,
      direction: "inbound",
    }),
    true,
  );
  assert.equal(
    shouldOpenWorkspaceOnAcdEvent({
      callState: "ringing",
      inboundOffer: true,
      direction: "inbound",
    }),
    false,
  );
});

test("outbound workspace opens only on the ACD user-accepted event", () => {
  assert.equal(
    shouldOpenWorkspaceOnAcdEvent({
      callState: "active",
      inboundOffer: false,
      direction: "outbound",
    }),
    false,
  );
  assert.equal(
    shouldOpenWorkspaceOnAcdEvent({
      callState: "ringing",
      inboundOffer: false,
      direction: "outbound",
      acdUserAccepted: true,
    }),
    true,
  );
  assert.equal(
    shouldOpenWorkspaceOnAcdEvent({
      callState: "idle",
      inboundOffer: false,
      direction: "outbound",
    }),
    false,
  );
});

test("leftover voice conversations recover disposition only when SIP is idle", () => {
  assert.equal(
    shouldRecoverVoiceDisposition({
      callState: "idle",
      inboundOffer: false,
      awaitingDisposition: false,
    }),
    true,
  );
  assert.equal(
    shouldRecoverVoiceDisposition({
      callState: "idle",
      inboundOffer: false,
      awaitingDisposition: true,
    }),
    false,
  );
  assert.equal(
    shouldRecoverVoiceDisposition({
      callState: "active",
      inboundOffer: false,
      awaitingDisposition: false,
    }),
    false,
  );
});