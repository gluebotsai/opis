import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inboundAnswerOwnsCachedSession,
  isAcceptedAcdCallEvent,
  isAcdAgentRingEvent,
  isTerminalAcdCallEvent,
  parseInboundCallEvent,
  parseInboundCallInit,
  redisStreamMessage,
  sameAcdCallSession,
  terminalVoiceFinalizeReason,
  voiceFinalizeDisposition,
} from "./umn-call-session.js";

const here = dirname(fileURLToPath(import.meta.url));

const acdInit = {
  session_id: "20046fcaf78-9a2a-123f-1bad-bc2411a27116",
  acd_event: 2,
  domain_name: "12653.call.worktual.co.uk",
  domain_id: "7851",
  cli: "200",
  ddi: "919551209927",
  pd: 0,
  req_type: "UPDATE",
  sessionStartTime: 1773480198033,
  call_type: "outbound",
  call_state: "init",
  device_type: "CCAAS:BROWSER",
  auto_attendant: 0,
  virtual_agent: 0,
};

test("workspace recovery recognizes an open consult target without reassigning", () => {
  const source = readFileSync(join(here, "umn-call-session.ts"), "utf8");
  assert.match(source, /getOpenVoiceConsultForUser/);
  assert.match(source, /transfer\.requested_agent_id, transfer\.offered_agent_id/);
  assert.match(source, /transfer\.state IN \('offered', 'accepted'\)/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("async function getOpenVoiceConsultForUser"),
      source.indexOf("export async function getActiveVoiceCallForUser"),
    ),
    /persistCallWorkspace/,
  );
});

test("parses ACD CCAAS_CALL_SUB init payload", () => {
  const parsed = parseInboundCallInit(JSON.stringify(acdInit));
  assert.equal(parsed?.sessionId, "20046fcaf78-9a2a-123f-1bad-bc2411a27116");
  assert.equal(parsed?.domainId, "7851");
  assert.equal(parsed?.ext, "200");
  assert.equal(parsed?.dnis, "919551209927");
  assert.equal(parsed?.ani, "919551209927");
  assert.equal(parsed?.direction, "outbound");
  assert.equal(parsed?.deviceType, "CCAAS:BROWSER");
  assert.equal(parsed?.callState, "init");
});

test("ignores non-init and non-browser ACD messages", () => {
  assert.equal(
    parseInboundCallInit(JSON.stringify({ ...acdInit, call_state: "connected" })),
    null,
  );
  assert.equal(
    parseInboundCallInit(JSON.stringify({ ...acdInit, device_type: "SIP-PHONE" })),
    null,
  );
});

test("ACD workspace opens only on accepted or connected, not init", () => {
  assert.equal(isAcceptedAcdCallEvent({ status: "", callState: "init" }), false);
  assert.equal(isAcceptedAcdCallEvent({ status: "accepted", callState: "init" }), true);
  assert.equal(isAcceptedAcdCallEvent({ status: "Accepted", callState: "init" }), true);
  assert.equal(isAcceptedAcdCallEvent({ status: "connected", callState: "" }), true);
  assert.equal(isAcceptedAcdCallEvent({ status: "", callState: "accepted" }), true);
  assert.equal(isAcceptedAcdCallEvent({ status: "user accepted", callState: "init" }), true);
  assert.equal(isAcceptedAcdCallEvent({ status: "user_accepted", callState: "" }), true);
  assert.equal(isAcceptedAcdCallEvent({ status: "ringing", callState: "init" }), false);
});

test("accepted and connected session variants resolve to one ACD call", () => {
  const uuid = "62d2693c-2c36-1240-7397-bc2411477a90";
  assert.equal(sameAcdCallSession(uuid, `+919150911820${uuid}`), true);
  assert.equal(sameAcdCallSession(uuid, "different-session"), false);
  assert.equal(sameAcdCallSession(null, uuid), false);
});

test("parses connected ACD event without opening on init semantics", () => {
  const connected = parseInboundCallEvent(
    JSON.stringify({
      ...acdInit,
      call_state: undefined,
      status: "connected",
      acd_event: 15,
      ext: "200",
      qid: "9",
      agentConnectTime: 1773480209033,
    }),
  );
  assert.equal(connected?.sessionId, acdInit.session_id);
  assert.equal(connected?.status, "connected");
  assert.equal(connected?.quId, "9");
  assert.equal(parseInboundCallInit(JSON.stringify({ ...acdInit, status: "connected", call_state: undefined })), null);
});

test("inbound INIT stores the session and leaves the agent empty", () => {
  const inbound = parseInboundCallEvent(
    JSON.stringify({
      session_id: "+91915091182031513797-31d4-1240-0093-bc2411477a90",
      domain_id: "1000",
      cli: "+919150911820",
      ddi: "914440004417",
      call_type: "inbound",
      call_state: "init",
      req_type: "UPDATE",
      device_type: "",
      acd_event: 2,
    }),
  );
  assert.equal(inbound?.sessionId, "+91915091182031513797-31d4-1240-0093-bc2411477a90");
  assert.equal(inbound?.ext, "");
  assert.equal(inbound?.ani, "+919150911820");
  assert.equal(inbound?.direction, "inbound");
});

test("ACD ring event names the agent and does not open the call", () => {
  assert.equal(
    isAcdAgentRingEvent({
      reqType: "INVITE",
      acdEvent: 43,
      ext: "103",
      callState: "",
      status: "",
    }),
    true,
  );
  assert.equal(
    isAcdAgentRingEvent({
      reqType: "UPDATE",
      acdEvent: 2,
      ext: "",
      callState: "init",
      status: "",
    }),
    false,
  );
  assert.equal(
    isAcdAgentRingEvent({
      reqType: "UPDATE",
      acdEvent: 15,
      ext: "103",
      callState: "",
      status: "connected",
    }),
    false,
  );
  assert.equal(
    isAcdAgentRingEvent({
      reqType: "UPDATE",
      acdEvent: 10,
      ext: "103",
      callState: "rejected",
      status: "rejected",
    }),
    false,
  );
});

test("the agent who accepts an unbound inbound session owns it", () => {
  assert.equal(
    inboundAnswerOwnsCachedSession({
      direction: "inbound",
      cachedUserId: null,
      requestedSessionId: "+91915091182031513797-31d4-1240-0093-bc2411477a90",
      userId: "1003",
    }),
    true,
  );
  assert.equal(
    inboundAnswerOwnsCachedSession({
      direction: "inbound",
      cachedUserId: "1001",
      requestedSessionId: "+91915091182031513797-31d4-1240-0093-bc2411477a90",
      userId: "1003",
    }),
    false,
  );
  assert.equal(
    inboundAnswerOwnsCachedSession({
      direction: "outbound",
      cachedUserId: null,
      requestedSessionId: "20046fcaf78-9a2a-123f-1bad-bc2411a27116",
      userId: "1003",
    }),
    false,
  );
});

test("inbound ACD event uses ext for the agent and cli for the caller", () => {
  const inbound = parseInboundCallEvent(
    JSON.stringify({
      ...acdInit,
      session_id: "+9191509118203611ab89-2e0f-1240-0093-bc2411477a90",
      cli: "+919150911820",
      ddi: "914440004407",
      ext: "101",
      qid: "1001",
      call_type: "inbound",
      call_state: undefined,
      status: "connected",
      acd_event: 15,
    }),
  );
  assert.equal(inbound?.ext, "101");
  assert.equal(inbound?.ani, "+919150911820");
  assert.equal(inbound?.dnis, "914440004407");
  assert.equal(inbound?.direction, "inbound");
});

test("connected ACD event infers inbound when call_type is omitted", () => {
  const inbound = parseInboundCallEvent(
    JSON.stringify({
      ...acdInit,
      session_id: "+9173580214080986ac55-2ed8-1240-0093-bc2411477a90",
      cli: "+917358021408",
      ext: "101",
      call_type: undefined,
      call_state: undefined,
      status: "connected",
    }),
  );
  assert.equal(inbound?.ext, "101");
  assert.equal(inbound?.ani, "+917358021408");
  assert.equal(inbound?.direction, "inbound");
  assert.equal(inbound?.directionProvided, false);
});

test("reads ACD JSON from the Redis Stream message field", () => {
  assert.equal(
    redisStreamMessage(["message", JSON.stringify(acdInit)]),
    JSON.stringify(acdInit),
  );
  assert.equal(redisStreamMessage(["other", "value"]), null);
});

test("ACD disconnected and rejected events are terminal", () => {
  assert.equal(isTerminalAcdCallEvent({ status: "disconnected", callState: "" }), true);
  assert.equal(isTerminalAcdCallEvent({ status: "", callState: "rejected" }), true);
  assert.equal(isTerminalAcdCallEvent({ status: "abandoned", callState: "init" }), true);
  assert.equal(isTerminalAcdCallEvent({ status: "accepted", callState: "connected" }), false);
  assert.equal(isAcceptedAcdCallEvent({ status: "disconnected", callState: "" }), false);
});

test("terminal voice events map to system dispositions", () => {
  assert.equal(terminalVoiceFinalizeReason({ status: "rejected", callState: "" }), "agent_declined");
  assert.equal(terminalVoiceFinalizeReason({ status: "disconnected", callState: "" }), "customer_disconnected");
  assert.equal(terminalVoiceFinalizeReason({ status: "", callState: "abandoned" }), "abandoned");
  assert.equal(voiceFinalizeDisposition("agent_declined").code, "agent_declined");
  assert.equal(voiceFinalizeDisposition("browser_disconnected").code, "browser_disconnected");
  const disconnected = voiceFinalizeDisposition("customer_disconnected");
  assert.equal(disconnected.code, "customer_disconnected");
  assert.equal(
    disconnected.summary,
    "Customer disconnected before the agent completed wrap-up.",
  );
  assert.deepEqual(disconnected.resolution, {
    code: "customer_disconnected",
    summary: disconnected.summary,
  });
});
