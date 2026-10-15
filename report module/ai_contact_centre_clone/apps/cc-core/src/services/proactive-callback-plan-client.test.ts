import assert from "node:assert/strict";
import test from "node:test";

import { deterministicProactivePlan } from "./proactive-callback-plan-client.js";

const basePayload = {
  organizationId: "1000",
  missedContactId: "1",
  conversationId: "2",
  contactId: "3",
  queueId: "4",
  reason: "offer_timeout",
  missedAt: new Date().toISOString(),
  customerName: "Visitor",
  queueName: "support",
  queueDescription: "support",
  queueSkills: [] as string[],
  queueCloseTime: null as string | null,
  eligibleAgents: [
    {
      setupUserId: "10",
      agentId: "20",
      displayName: "Agent",
      skills: [] as string[],
      openCallbackCount: 0,
      skillScore: 1,
    },
  ],
};

test("deterministicProactivePlan skips webchat misses", () => {
  const plan = deterministicProactivePlan({
    ...basePayload,
    channel: "webchat",
  });
  assert.equal("skip" in plan && plan.skip, true);
});

test("deterministicProactivePlan skips chat alias", () => {
  const plan = deterministicProactivePlan({
    ...basePayload,
    channel: "chat",
  });
  assert.equal("skip" in plan && plan.skip, true);
});

test("deterministicProactivePlan keeps whatsapp outreach", () => {
  const plan = deterministicProactivePlan({
    ...basePayload,
    channel: "whatsapp",
  });
  assert.equal("skip" in plan, false);
  if (!("skip" in plan)) {
    assert.equal(plan.channel, "whatsapp");
  }
});
