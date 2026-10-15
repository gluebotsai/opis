import assert from "node:assert/strict";
import test from "node:test";

import {
  inboundAcdContext,
  acdSessionIdFromSdp,
  acdSessionIdFromSipMessage,
  inboundAcdSessionFromSession,
  inboundInviteCancelledBeforeConnect,
  queueInviteReadyAfterDisposition,
  shouldPublishInboundBusy,
  shouldRestoreReadyAfterCancelledRing,
  inboundCallerFromSession,
  inboundVoiceTransferFromSession,
  inboundSipBusyOptions,
  inboundSipRejectionOptions,
  presenceAfterVoiceMediaEnded,
  shouldAcceptIncomingInvite,
  shouldLockAgentPresence,
  voiceEndedNeedsDisposition,
} from "./sip-inbound.ts";

test("a cancelled ring does not become a connected call", () => {
  assert.equal(
    inboundInviteCancelledBeforeConnect({
      direction: "inbound",
      connectedAt: null,
      cause: "Request Terminated",
    }),
    true,
  );
  assert.equal(
    inboundInviteCancelledBeforeConnect({
      direction: "inbound",
      connectedAt: 1,
      cause: "Request Terminated",
    }),
    false,
  );
  assert.equal(queueInviteReadyAfterDisposition("ready"), true);
  assert.equal(queueInviteReadyAfterDisposition("not_ready"), false);
});

test("inbound Busy waits until the SIP answer is sent", () => {
  assert.equal(shouldPublishInboundBusy({ event: "accept-click" }), false);
  assert.equal(shouldPublishInboundBusy({ event: "sip-accepted" }), true);
});

test("a cancelled ring restores Ready only while the offer is still showing", () => {
  assert.equal(
    shouldRestoreReadyAfterCancelledRing({
      presenceState: "ready",
      inboundOffer: true,
      connectedAt: null,
    }),
    true,
  );
  assert.equal(
    shouldRestoreReadyAfterCancelledRing({
      presenceState: "ready",
      inboundOffer: false,
      connectedAt: null,
    }),
    false,
  );
  assert.equal(
    shouldRestoreReadyAfterCancelledRing({
      presenceState: "busy",
      inboundOffer: true,
      connectedAt: null,
    }),
    false,
  );
  assert.equal(
    shouldRestoreReadyAfterCancelledRing({
      presenceState: "ready",
      inboundOffer: true,
      connectedAt: 1,
    }),
    false,
  );
});

test("wrap-up does not publish Ready; a call with no disposition still does", () => {
  assert.equal(presenceAfterVoiceMediaEnded(true), null);
  assert.equal(presenceAfterVoiceMediaEnded(false), "ready");
});

test("missed ring does not require wrap-up", () => {
  assert.equal(
    voiceEndedNeedsDisposition({ conversationId: "102119", connectedAt: null }),
    false,
  );
  assert.equal(
    voiceEndedNeedsDisposition({ conversationId: "102119", connectedAt: 1 }),
    true,
  );
  assert.equal(
    voiceEndedNeedsDisposition({
      conversationId: "102119",
      connectedAt: 1,
      consultOnlySecondary: true,
    }),
    false,
  );
});

test("Away after a missed offer does not lock the presence picker", () => {
  assert.equal(
    shouldLockAgentPresence({
      callState: "idle",
      awaitingDisposition: true,
      presenceState: "away",
    }),
    false,
  );
  assert.equal(
    shouldLockAgentPresence({
      callState: "ringing",
      awaitingDisposition: false,
      presenceState: "away",
    }),
    false,
  );
  assert.equal(
    shouldLockAgentPresence({
      callState: "idle",
      awaitingDisposition: true,
      presenceState: "busy",
    }),
    true,
  );
  assert.equal(
    shouldLockAgentPresence({
      callState: "active",
      awaitingDisposition: false,
      presenceState: "away",
    }),
    true,
  );
});

test("shouldAcceptIncomingInvite only when idle and not wrapping up", () => {
  assert.equal(
    shouldAcceptIncomingInvite({
      hasActiveSession: false,
      callState: "idle",
      awaitingDisposition: false,
      presenceReady: true,
    }),
    true,
  );
  assert.equal(
    shouldAcceptIncomingInvite({
      hasActiveSession: true,
      callState: "idle",
      awaitingDisposition: false,
      presenceReady: true,
    }),
    false,
  );
  assert.equal(
    shouldAcceptIncomingInvite({
      hasActiveSession: false,
      callState: "active",
      awaitingDisposition: false,
      presenceReady: true,
    }),
    false,
  );
  assert.equal(
    shouldAcceptIncomingInvite({
      hasActiveSession: false,
      callState: "idle",
      awaitingDisposition: true,
      presenceReady: true,
    }),
    false,
  );
  assert.equal(
    shouldAcceptIncomingInvite({
      hasActiveSession: false,
      callState: "idle",
      awaitingDisposition: false,
      presenceReady: false,
    }),
    false,
  );
});

test("transfer INVITE can ring after ACD has already marked B Busy", () => {
  assert.equal(
    shouldAcceptIncomingInvite({
      hasActiveSession: false,
      callState: "idle",
      awaitingDisposition: false,
      presenceReady: false,
      isTransferOffer: true,
    }),
    true,
  );
  assert.equal(
    shouldAcceptIncomingInvite({
      hasActiveSession: true,
      callState: "active",
      awaitingDisposition: false,
      presenceReady: false,
      isTransferOffer: true,
    }),
    false,
  );
  assert.equal(
    shouldAcceptIncomingInvite({
      hasActiveSession: false,
      callState: "idle",
      awaitingDisposition: true,
      presenceReady: false,
      isTransferOffer: true,
    }),
    false,
  );
});

test("inbound INVITE preserves an ACD binding received before SIP", () => {
  const sessionId = "+919150911820e9b9b759-2ed9-1240-0093-bc2411477a90";
  assert.deepEqual(
    inboundAcdContext({
      acdSessionId: "e9b9b759-2ed9-1240-0093-bc2411477a90",
      conversationId: "102119",
    }, sessionId),
    {
      acdSessionId: sessionId,
      conversationId: "102119",
    },
  );
});

test("inbound INVITE replaces stale ACD context with its iuid", () => {
  const currentSessionId = "+919150911820e9b9b759-2ed9-1240-0093-bc2411477a90";
  assert.deepEqual(
    inboundAcdContext(
      {
        acdSessionId: "+9173580214080986ac55-2ed8-1240-0093-bc2411477a90",
        conversationId: "13833",
      },
      currentSessionId,
    ),
    {
      acdSessionId: currentSessionId,
      conversationId: null,
    },
  );
});

test("inboundAcdSessionFromSession reads the gateway iuid header", () => {
  assert.equal(inboundAcdSessionFromSession({}), null);
  assert.equal(
    inboundAcdSessionFromSession({
      request: {
        getHeader: (name) =>
          name.toLowerCase() === "iuid"
            ? " +919150911820e9b9b759-2ed9-1240-0093-bc2411477a90 "
            : undefined,
      },
    }),
    "+919150911820e9b9b759-2ed9-1240-0093-bc2411477a90",
  );
  assert.equal(
    inboundAcdSessionFromSession({
      request: {
        getHeader: (name) =>
          name.toLowerCase() === "ccaas-session-id"
            ? "+918056113197437435e7-2ee8-1240-548c-bc2411a168a2"
            : undefined,
      },
    }),
    "+918056113197437435e7-2ee8-1240-548c-bc2411a168a2",
  );
  assert.equal(
    inboundAcdSessionFromSession({
      request: {
        body: [
          "v=0",
          "a=iuid:+9191509118201fe4f4dd-3108-1240-0093-bc2411477a90",
          "m=audio 30408 RTP/AVP 0",
        ].join("\r\n"),
      },
    }),
    "+9191509118201fe4f4dd-3108-1240-0093-bc2411477a90",
  );
});

test("queue INVITE session id is iuid before the SDP", () => {
  const raw = [
    "INVITE sip:103@worktual.local SIP/2.0",
    "From: <sip:+919150911820@worktual.local>",
    "iuid: +91915091182031513797-31d4-1240-0093-bc2411477a90",
    "Call-ID: 11724dc8-31ce-1240-0093-bc2411477a90",
    "Content-Type: application/sdp",
    "",
    "v=0",
    "m=audio 30408 RTP/AVP 0",
  ].join("\r\n");
  assert.equal(
    acdSessionIdFromSipMessage(raw),
    "+91915091182031513797-31d4-1240-0093-bc2411477a90",
  );
  assert.equal(
    inboundAcdSessionFromSession({ _request: { data: raw } }),
    "+91915091182031513797-31d4-1240-0093-bc2411477a90",
  );
});

test("transfer INVITE session id is CCAAS-SESSION-ID inside ExtraRemote-Info", () => {
  const raw = [
    "INVITE sip:104@worktual.local SIP/2.0",
    "iuid: +919150911820ignored",
    "ExtraRemote-Info: CCAAS-FEATURE-REQ: TRANSFER",
    "CCAAS-SESSION-ID: +91915091182031513797-31d4-1240-0093-bc2411477a90",
    "",
    "v=0",
  ].join("\r\n");
  assert.equal(
    inboundAcdSessionFromSession({ _request: { data: raw } }),
    "+91915091182031513797-31d4-1240-0093-bc2411477a90",
  );
  assert.equal(inboundVoiceTransferFromSession({ _request: { data: raw } }), true);
});

test("acdSessionIdFromSdp reads a=iuid and ignores other lines", () => {
  assert.equal(acdSessionIdFromSdp(null), null);
  assert.equal(
    acdSessionIdFromSdp("a=rtpmap:0 PCMU/8000\r\na=iuid:+9180session\r\n"),
    "+9180session",
  );
});

test("inboundVoiceTransferFromSession reads CCAAS-FEATURE-REQ", () => {
  assert.equal(inboundVoiceTransferFromSession({}), false);
  assert.equal(
    inboundVoiceTransferFromSession({
      request: {
        getHeader: (name) =>
          name.toLowerCase() === "ccaas-feature-req" ? "TRANSFER" : undefined,
      },
    }),
    true,
  );
  assert.equal(
    inboundVoiceTransferFromSession({
      request: {
        getHeader: (name) =>
          name.toLowerCase() === "ccaas-transfer-type" ? "AGENT" : undefined,
      },
    }),
    true,
  );
});

test("inboundCallerFromSession reads remote SIP user", () => {
  assert.equal(inboundCallerFromSession({}), null);
  assert.equal(
    inboundCallerFromSession({ remote_identity: { uri: { user: "91915009118200" } } }),
    "91915009118200",
  );
});

test("rejecting an unanswered inbound INVITE sends 486 Busy Here", () => {
  assert.deepEqual(inboundSipRejectionOptions(), {
    status_code: 486,
    reason_phrase: "Busy Here",
  });
});

test("refusing a busy or duplicate inbound INVITE sends 600 Busy Everywhere", () => {
  assert.deepEqual(inboundSipBusyOptions(), {
    status_code: 600,
    reason_phrase: "Busy Everywhere",
  });
});
