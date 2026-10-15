import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSFER_ACTION_TRANSFEREE_LEAVE,
  TRANSFER_ACTION_TRANSFEROR_CANCEL,
  TRANSFER_ACTION_TRANSFEROR_ENDALL,
  TRANSFER_ACTION_TRANSFEROR_LEAVE,
  TRANSFER_ACTION_TRANSFEROR_MERGE,
  TRANSFER_ACTION_TRANSFEROR_TRANSFER,
  acdActionForVoiceHangup,
  hangupTeardownOrder,
  canShowVoiceConsultCompleteActions,
  canShowVoiceConsultLeave,
  shouldShowConsultSpeakingBanner,
  canStartVoiceConsultInvite,
  injectVoiceTransferHeaders,
  isVoiceConsultInviteForExt,
  isVoiceConsultRinging,
  isSupervisorListenInvite,
  isVoiceTransferFeatureReq,
  voiceSupervisorListenHeaders,
  voiceTransferInviteHeaders,
} from "./sip-transfer.ts";

test("locked TRANSFER_ACTION integers match ACD samples", () => {
  assert.equal(TRANSFER_ACTION_TRANSFEROR_MERGE, 1);
  assert.equal(TRANSFER_ACTION_TRANSFEROR_TRANSFER, 2);
  assert.equal(TRANSFER_ACTION_TRANSFEROR_CANCEL, 3);
  assert.equal(TRANSFER_ACTION_TRANSFEROR_LEAVE, 4);
  assert.equal(TRANSFER_ACTION_TRANSFEREE_LEAVE, 6);
});

test("hang up publishes the correct ACD action for each consult role", () => {
  assert.equal(
    acdActionForVoiceHangup({
      merged: false,
      transferConsultRole: "secondary",
      consultState: "idle",
      secondaryConsultOnly: true,
    }),
    TRANSFER_ACTION_TRANSFEREE_LEAVE,
  );
  assert.equal(
    acdActionForVoiceHangup({
      merged: false,
      transferConsultRole: "secondary",
      consultState: "idle",
      secondaryConsultOnly: false,
    }),
    null,
  );
  assert.equal(
    acdActionForVoiceHangup({
      merged: true,
      transferConsultRole: "secondary",
      consultState: "active",
      secondaryConsultOnly: false,
    }),
    TRANSFER_ACTION_TRANSFEREE_LEAVE,
  );
  assert.equal(
    acdActionForVoiceHangup({
      merged: true,
      transferConsultRole: "primary",
      consultState: "active",
      secondaryConsultOnly: false,
    }),
    TRANSFER_ACTION_TRANSFEROR_ENDALL,
  );
  assert.equal(
    acdActionForVoiceHangup({
      merged: false,
      transferConsultRole: "primary",
      consultState: "ringing",
      secondaryConsultOnly: false,
    }),
    TRANSFER_ACTION_TRANSFEROR_CANCEL,
  );
  assert.equal(
    acdActionForVoiceHangup({
      merged: false,
      transferConsultRole: null,
      consultState: "idle",
      secondaryConsultOnly: false,
    }),
    null,
  );
});

test("consult hangup closes the consult before the customer leg", () => {
  assert.equal(hangupTeardownOrder(TRANSFER_ACTION_TRANSFEROR_CANCEL), "consult-then-customer");
  assert.equal(hangupTeardownOrder(TRANSFER_ACTION_TRANSFEROR_ENDALL), "after-ack");
  assert.equal(hangupTeardownOrder(TRANSFER_ACTION_TRANSFEREE_LEAVE), "after-ack");
  assert.equal(hangupTeardownOrder(null), "sip-bye");
});

test("consult complete actions appear only after B answers", () => {
  assert.equal(canShowVoiceConsultCompleteActions("idle"), false);
  assert.equal(canShowVoiceConsultCompleteActions("dialing"), false);
  assert.equal(canShowVoiceConsultCompleteActions("ringing"), false);
  assert.equal(canShowVoiceConsultCompleteActions("active"), true);
  assert.equal(isVoiceConsultRinging("dialing"), true);
  assert.equal(isVoiceConsultRinging("ringing"), true);
  assert.equal(isVoiceConsultRinging("active"), false);
  assert.equal(canShowVoiceConsultLeave({ merged: false, transferConsultRole: "primary" }), false);
  assert.equal(canShowVoiceConsultLeave({ merged: true, transferConsultRole: "primary" }), true);
  assert.equal(canShowVoiceConsultLeave({ merged: true, transferConsultRole: "secondary" }), true);
});

test("A and B speaking banner closes on cancel, transfer, and merge", () => {
  assert.equal(
    shouldShowConsultSpeakingBanner({
      consultState: "active",
      merged: false,
      transferConsultRole: "primary",
      callState: "active",
      secondaryConsultOnly: false,
    }),
    true,
  );
  assert.equal(
    shouldShowConsultSpeakingBanner({
      consultState: "idle",
      merged: false,
      transferConsultRole: "secondary",
      callState: "active",
      secondaryConsultOnly: true,
    }),
    true,
  );
  assert.equal(
    shouldShowConsultSpeakingBanner({
      consultState: "ringing",
      merged: false,
      transferConsultRole: "primary",
      callState: "active",
      secondaryConsultOnly: false,
    }),
    false,
  );
  assert.equal(
    shouldShowConsultSpeakingBanner({
      consultState: "idle",
      merged: false,
      transferConsultRole: "primary",
      callState: "active",
      secondaryConsultOnly: false,
    }),
    false,
  );
  assert.equal(
    shouldShowConsultSpeakingBanner({
      consultState: "active",
      merged: true,
      transferConsultRole: "primary",
      callState: "active",
      secondaryConsultOnly: false,
    }),
    false,
  );
});

test("consult INVITE to B is allowed while the customer leg is held", () => {
  assert.equal(
    canStartVoiceConsultInvite({
      hasCustomerSession: true,
      customerCallState: "active",
      consultState: "idle",
    }),
    true,
  );
  assert.equal(
    canStartVoiceConsultInvite({
      hasCustomerSession: true,
      customerCallState: "active",
      consultState: "ringing",
    }),
    false,
  );
  assert.equal(
    canStartVoiceConsultInvite({
      hasCustomerSession: false,
      customerCallState: "active",
      consultState: "idle",
    }),
    false,
  );
});

test("transfer INVITE headers use the customer session id", () => {
  assert.deepEqual(
    voiceTransferInviteHeaders(" +918056113197437435e7-2ee8-1240-548c-bc2411a168a2 "),
    [
      "CCAAS-SESSION-ID: +918056113197437435e7-2ee8-1240-548c-bc2411a168a2",
      "CCAAS-FEATURE-REQ: TRANSFER",
      "CCAAS-TRANSFER-TYPE: AGENT",
    ],
  );
  assert.deepEqual(voiceTransferInviteHeaders("  "), []);
  assert.equal(isVoiceTransferFeatureReq("TRANSFER"), true);
  assert.equal(isVoiceTransferFeatureReq("invite"), false);
});

test("transfer headers are scoped to B's INVITE, not the held customer re-INVITE", () => {
  assert.equal(
    isVoiceConsultInviteForExt(
      "INVITE sip:208@1000.call.worktual.com SIP/2.0\r\nContent-Length: 0\r\n\r\n",
      "208",
    ),
    true,
  );
  assert.equal(
    isVoiceConsultInviteForExt(
      "INVITE sip:919150911820@1000.call.worktual.com SIP/2.0\r\nContent-Length: 0\r\n\r\n",
      "208",
    ),
    false,
  );
  assert.equal(isVoiceConsultInviteForExt("UPDATE sip:208@example.com SIP/2.0", "208"), false);
});

test("injectVoiceTransferHeaders adds missing CCAAS headers before Content-Length", () => {
  const raw = [
    "INVITE sip:208@1000.call.worktual.com SIP/2.0",
    "Via: SIP/2.0/WSS 192.168.1.10;branch=z9hG4bK1",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");
  const next = injectVoiceTransferHeaders(
    raw,
    voiceTransferInviteHeaders("+918056113197437435e7-2ee8-1240-548c-bc2411a168a2"),
  );
  assert.match(next, /CCAAS-SESSION-ID: \+918056113197437435e7-2ee8-1240-548c-bc2411a168a2/);
  assert.match(next, /CCAAS-FEATURE-REQ: TRANSFER/);
  assert.match(next, /CCAAS-TRANSFER-TYPE: AGENT/);
  assert.ok(next.indexOf("CCAAS-FEATURE-REQ") < next.indexOf("Content-Length"));
  assert.equal(injectVoiceTransferHeaders(next, voiceTransferInviteHeaders("dup")), next);
});

test("supervisor listen INVITE uses LISTEN and SUPERVISOR on the live session", () => {
  const sessionId = "+918056113197a1e38958-2eeb-1240-548c-bc2411a168a2";
  assert.deepEqual(voiceSupervisorListenHeaders(` ${sessionId} `), [
    `CCAAS-SESSION-ID: ${sessionId}`,
    "CCAAS-FEATURE-REQ: LISTEN",
    "CCAAS-CALLER-TYPE: SUPERVISOR",
  ]);
  const raw = "INVITE sip:208@1000.call.worktual.com SIP/2.0\r\nContent-Length: 0\r\n\r\n";
  assert.equal(isSupervisorListenInvite(raw, "208"), true);
  assert.equal(isSupervisorListenInvite(raw, "103"), false);
  assert.equal(
    isSupervisorListenInvite(`INVITE sip:${sessionId}@1000.call.worktual.com SIP/2.0\r\n\r\n`, "208"),
    false,
  );
});
