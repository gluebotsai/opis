/**
 * run: npx tsx --tsconfig tsconfig.json src/service/voice/agent-presence.test.ts
 */
import assert from "node:assert/strict";
import {
  buildPresencePayload,
  forcedPresenceCode,
  parseInboundPresence,
  presenceRedisUrl,
  toPresenceState,
  toStatusName,
} from "./agent-presence";

const user = {
  id: "31366",
  organizationId: "20556",
  ext: "203",
  email: "agent@example.com",
  firstName: "Sivaraman",
  lastName: "R",
};

assert.equal(forcedPresenceCode("login", "not_ready"), 3);
assert.equal(forcedPresenceCode("voice", "ready"), 2);
assert.equal(forcedPresenceCode("toolbar", "ready"), 0);
assert.equal(toStatusName("not_ready"), "Not Ready");
assert.equal(toPresenceState("Not Ready"), "not_ready");
assert.equal(toPresenceState("Busy"), "busy");
assert.equal(toPresenceState("Lunch"), null);

const payload = buildPresencePayload({
  user,
  queue: {
    id: "2788",
    name: "Pothys Support",
    handlesInbound: true,
    handlesOutboundCampaign: false,
  },
  state: "ready",
  source: "login",
});

assert.equal(payload.isCrm, 1);
assert.equal("is_crm" in payload, false);
assert.equal(payload.isVoice, 1);
assert.equal(payload.forced_presence, 3);
assert.equal(payload.statusName, "Ready");
assert.equal(payload.domainId, 20556);
assert.equal(payload.quId, "2788");
assert.equal(payload.queueName, "Pothys Support");
assert.equal(payload.inboundCall, 1);
assert.equal(payload.outboundCampaignCall, 0);
assert.equal("password" in payload, false);

const away = buildPresencePayload({ user, queue: null, state: "away", source: "toolbar" });
assert.equal(away.isVoice, 0);
assert.equal(away.isCrm, 1);
assert.equal("is_crm" in away, false);
const notReady = buildPresencePayload({ user, queue: null, state: "not_ready", source: "toolbar" });
assert.equal(notReady.isCrm, 1);
assert.equal(notReady.isVoice, 0);
assert.equal(away.quId, "");
assert.equal(away.forced_presence, 0);

const inbound = parseInboundPresence(
  JSON.stringify({
    domainId: 20556,
    statusName: "Ready",
    ext: "203",
    email: "agent@example.com",
  }),
);
assert.deepEqual(inbound, {
  domainId: "20556",
  statusName: "Ready",
  ext: "203",
  email: "agent@example.com",
});
assert.equal(parseInboundPresence("{"), null);
assert.equal(parseInboundPresence(JSON.stringify({ ext: "1" })), null);

const previousTranscriptRedis = process.env.TRANSCRIPT_REDIS_URL;
const previousRedis = process.env.REDIS_URL;
process.env.TRANSCRIPT_REDIS_URL = "redis://10.180.1.101:6379/0";
process.env.REDIS_URL = "redis://redis:6379/0";
assert.equal(presenceRedisUrl(), "redis://10.180.1.101:6379/0");
delete process.env.TRANSCRIPT_REDIS_URL;
assert.equal(presenceRedisUrl(), "redis://redis:6379/0");
if (previousTranscriptRedis === undefined) delete process.env.TRANSCRIPT_REDIS_URL;
else process.env.TRANSCRIPT_REDIS_URL = previousTranscriptRedis;
if (previousRedis === undefined) delete process.env.REDIS_URL;
else process.env.REDIS_URL = previousRedis;

console.log("agent-presence.test.ts ok");
