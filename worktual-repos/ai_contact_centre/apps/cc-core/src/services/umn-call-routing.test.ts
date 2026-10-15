import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAcdAgentResponse,
  buildAcdQueueResponse,
  fallbackQueueId,
  nlpCallPublishChannel,
  nlpCallSubscribeStream,
  orderedCandidateIndexes,
  orderedUntriedCandidateIndexes,
  parseAcdRoutingRequest,
  shouldPublishAcdRoutingReply,
  shouldSkipDidQueueRouting,
  shouldUseLlmQueuePick,
  type VoiceQueueCandidate,
} from "./umn-call-routing.js";

const eventOne = {
  session_id: "+918778429069358a97c1-2d2d-1240-2dad-bc2411a9e1a6",
  domain_id: "20556",
  event_id: 1,
  cli: "918778429069",
  ddi: "917338833821",
};

test("ACD inbound is a stream and outbound replies are pub/sub", () => {
  assert.equal(nlpCallSubscribeStream(), "NLP_CALL_SUB");
  assert.equal(nlpCallPublishChannel(), "NLP_CALL_PUB");
});

test("cached stream entries do not publish again on NLP_CALL_PUB", () => {
  assert.equal(shouldPublishAcdRoutingReply(null), true);
  assert.equal(shouldPublishAcdRoutingReply(JSON.stringify({ event_id: 2 })), false);
  assert.equal(shouldPublishAcdRoutingReply("__skip__"), false);
});

test("parses ACD queue and agent routing requests only", () => {
  const queueRequest = parseAcdRoutingRequest(JSON.stringify(eventOne));
  assert.equal(queueRequest?.eventId, 1);
  assert.equal(queueRequest?.ddi, "917338833821");

  const agentRequest = parseAcdRoutingRequest(
    JSON.stringify({ ...eventOne, event_id: 5, queue_id: "2788" }),
  );
  assert.equal(agentRequest?.eventId, 5);
  assert.equal(agentRequest?.queueId, "2788");
  assert.equal(parseAcdRoutingRequest(JSON.stringify({ ...eventOne, event_id: 3 })), null);
});

test("builds the exact event 2 and event 6 ACD envelopes", () => {
  const queueRequest = parseAcdRoutingRequest(JSON.stringify(eventOne))!;
  assert.deepEqual(buildAcdQueueResponse(queueRequest, "2788"), {
    ...eventOne,
    event_id: 2,
    queue_id: "2788",
  });

  const agentRequest = parseAcdRoutingRequest(
    JSON.stringify({ ...eventOne, event_id: 5, queue_id: "2788" }),
  )!;
  assert.deepEqual(
    buildAcdAgentResponse(agentRequest, {
      agentId: "1009",
      userId: "11483",
      email: "dehajat219@limtu.com",
      extension: 200,
      name: "dehajat limtu",
    }),
    {
      ...eventOne,
      event_id: 6,
      queue_id: "2788",
      agent_email: "dehajat219@limtu.com",
      agent_userId: "11483",
      agent_extn: 200,
      agent_name: "dehajat limtu",
    },
  );
  assert.deepEqual(buildAcdAgentResponse(agentRequest, null), {
    ...eventOne,
    event_id: 6,
    queue_id: "2788",
    agent_email: "",
    agent_userId: "0",
    agent_extn: 0,
    agent_name: "",
  });
});

test("direct user DIDs stay with ACD while queue DIDs continue", () => {
  assert.equal(shouldSkipDidQueueRouting([{ routingUserId: "11483" }]), true);
  assert.equal(shouldSkipDidQueueRouting([{ routingUserId: null }]), false);
});

test("LLM queue selection requires both skill profile and transcript", () => {
  assert.equal(shouldUseLlmQueuePick("skill", "customer: billing issue"), true);
  assert.equal(shouldUseLlmQueuePick("skill", ""), false);
  assert.equal(shouldUseLlmQueuePick("long_wait", "customer: billing issue"), false);
});

test("no-transcript routing uses the first mapped queue", () => {
  const queues: VoiceQueueCandidate[] = [
    {
      runtimeQueueId: "1001",
      setupQueueId: "2788",
      name: "Support",
      description: "Support",
      intents: [],
      skills: [],
    },
    {
      runtimeQueueId: "1002",
      setupQueueId: "2789",
      name: "Billing",
      description: "Billing",
      intents: ["billing"],
      skills: ["billing"],
    },
  ];
  assert.equal(fallbackQueueId(queues), "2788");
});

test("round robin starts at the cursor and advances past rejected agents", () => {
  assert.deepEqual(orderedCandidateIndexes(3, 0), [0, 1, 2]);
  assert.deepEqual(orderedCandidateIndexes(3, 1), [1, 2, 0]);
  assert.deepEqual(orderedCandidateIndexes(3, 4), [1, 2, 0]);
  const candidates = [{ agentId: "A" }, { agentId: "B" }, { agentId: "C" }];
  assert.deepEqual(
    orderedUntriedCandidateIndexes(candidates, 1, new Set(["A"])),
    [1, 2],
  );
  assert.deepEqual(
    orderedUntriedCandidateIndexes(candidates, 2, new Set(["A", "B"])),
    [2],
  );
});
