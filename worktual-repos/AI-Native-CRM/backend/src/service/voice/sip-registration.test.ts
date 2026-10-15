/**
 * run: npx tsx --tsconfig tsconfig.json src/service/voice/sip-registration.test.ts
 */
import assert from "node:assert/strict";
import { buildSipUaSession, iceServersFromEnv } from "./sip-session";
import {
  isFullSipRegistrarPayload,
  selectOutboundCallerId,
  sipRegistrarRedisUrl,
  sipRegistrationKey,
  sipRegistrationPayload,
  sipUriFor,
} from "./sip-registration";

const core = {
  ext: "200",
  organizationId: "12657",
  sipLoginId: "13699",
  sipPassword: "secret",
  callerName: "Agent",
  redisKey: "200@12657.call.worktual.com",
  redisRegistered: true,
  sipUri: "sip:200@12657.call.worktual.com:5060",
  registrarUri: "sip:12657.call.worktual.com:5060",
  realm: "12657.call.worktual.com",
  outboundCallerId: "+919003003819",
};

assert.equal(
  sipRegistrationKey("205", "20643", null),
  `205@20643.${process.env.SIP_REGISTRATION_DOMAIN?.trim() || "call.worktual.com"}`,
);
assert.equal(
  sipRegistrationKey("205", "20643", "pothys.call.worktual.com"),
  "205@pothys.call.worktual.com",
);
assert.equal(sipUriFor("205", "20643", null).startsWith("sip:205@"), true);

const payload = sipRegistrationPayload({
  ext: "205",
  organizationId: "20643",
  sipPassword: "secret",
  callerName: "Hema",
  sipLoginId: "999",
});
assert.equal(isFullSipRegistrarPayload(payload), true);
assert.equal(isFullSipRegistrarPayload('{"password":"only"}'), false);

const previousWss = process.env.SIP_WSS_URL;
const previousTurn = process.env.CALL_SERVER_TURN_URL;
const previousUser = process.env.CALL_SERVER_TURN_USERNAME;
const previousCred = process.env.CALL_SERVER_TURN_CREDENTIAL;
delete process.env.SIP_WSS_URL;
delete process.env.CALL_SERVER_TURN_URL;
delete process.env.CALL_SERVER_TURN_USERNAME;
delete process.env.CALL_SERVER_TURN_CREDENTIAL;

const session = buildSipUaSession(core);
assert.equal(session.userAgent, "CCAAS:BROWSER");
assert.equal(session.displayName, " ");
assert.equal(session.expires, 600);
assert.equal(session.authorizationUser, "200");
assert.equal(session.outboundCallerId, "+919003003819");

const dids = [
  { phoneNumber: "+914440004407", routingUserId: "1001", routingQueueId: "1001" },
  { phoneNumber: "+914440004417", routingUserId: null, routingQueueId: "1001" },
  { phoneNumber: "+919003003819", routingUserId: "1000", routingQueueId: null },
];
assert.equal(selectOutboundCallerId(dids, "1000", []), "+919003003819");
assert.equal(selectOutboundCallerId(dids, "1001", ["1001"]), "+914440004407");
assert.equal(selectOutboundCallerId(dids, "1003", ["1001"]), "+914440004407");
assert.equal(
  selectOutboundCallerId(
    [{ phoneNumber: "+914440004417", routingUserId: null, routingQueueId: "1001" }],
    "1003",
    ["1001"],
  ),
  "+914440004417",
);
assert.equal(selectOutboundCallerId(dids, "1002", []), null);

const previousTranscriptRedis = process.env.TRANSCRIPT_REDIS_URL;
const previousRedis = process.env.REDIS_URL;
process.env.TRANSCRIPT_REDIS_URL = "redis://10.180.1.101:6379/0";
process.env.REDIS_URL = "redis://redis:6379/0";
assert.equal(sipRegistrarRedisUrl(), "redis://10.180.1.101:6379/0");
delete process.env.TRANSCRIPT_REDIS_URL;
assert.equal(sipRegistrarRedisUrl(), "redis://redis:6379/0");
if (previousTranscriptRedis === undefined) delete process.env.TRANSCRIPT_REDIS_URL;
else process.env.TRANSCRIPT_REDIS_URL = previousTranscriptRedis;
if (previousRedis === undefined) delete process.env.REDIS_URL;
else process.env.REDIS_URL = previousRedis;
assert.equal(session.wssUrl, "wss://nlp-audiosgw.worktual.co.uk:57344");
assert.deepEqual(iceServersFromEnv(), [
  { urls: "stun:audioturnv4.worktual.co.uk:443" },
  {
    urls: "turn:audioturnv4.worktual.co.uk:443",
    username: "admin",
    credential: "system123",
  },
]);

if (previousWss === undefined) delete process.env.SIP_WSS_URL;
else process.env.SIP_WSS_URL = previousWss;
if (previousTurn === undefined) delete process.env.CALL_SERVER_TURN_URL;
else process.env.CALL_SERVER_TURN_URL = previousTurn;
if (previousUser === undefined) delete process.env.CALL_SERVER_TURN_USERNAME;
else process.env.CALL_SERVER_TURN_USERNAME = previousUser;
if (previousCred === undefined) delete process.env.CALL_SERVER_TURN_CREDENTIAL;
else process.env.CALL_SERVER_TURN_CREDENTIAL = previousCred;

console.log("sip-registration.test.ts ok");
