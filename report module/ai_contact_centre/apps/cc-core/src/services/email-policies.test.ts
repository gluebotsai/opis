import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveMailboxPolicyFromCcaasHandler,
  upsertEmailMailboxPolicySchema,
  upsertQueueRoutingProfileSchema,
} from "./email-policies.js";

test("mailbox policy defaults are safe for staged rollout", () => {
  const policy = upsertEmailMailboxPolicySchema.parse({
    connectionId: "1008",
    accountEmail: "support@example.com",
  });
  assert.equal(policy.botEnabled, false);
  assert.equal(policy.autoSendEnabled, false);
  assert.equal(policy.shadowMode, true);
  assert.equal(policy.liveAgentEnabled, true);
});

test("mailbox policy rejects invalid confidence and queue identifiers", () => {
  assert.throws(() =>
    upsertEmailMailboxPolicySchema.parse({
      connectionId: "not-a-numeric-id",
      accountEmail: "support@example.com",
      confidenceThreshold: 1.1,
    }),
  );
});

test("queue profile requires bounded approved classifier metadata", () => {
  const profile = upsertQueueRoutingProfileSchema.parse({
    description: "Handles billing and invoice questions",
    supportedIntents: ["billing"],
    examplePhrases: ["Where is my invoice?"],
    skillMapping: { billing: ["billing"] },
  });
  assert.deepEqual(profile.languageCodes, ["en"]);
  assert.equal(profile.classifierVersion, "v1");
});

test("ccaas_handler human routes to live agent only", () => {
  const policy = deriveMailboxPolicyFromCcaasHandler({
    organizationId: "1000",
    connectionId: "1008",
    accountEmail: "support@example.com",
    ccaasHandler: "human",
  });
  assert.equal(policy.botEnabled, false);
  assert.equal(policy.liveAgentEnabled, true);
});

test("ccaas_handler bot enables auto-send with live-agent handoff fallback", () => {
  const policy = deriveMailboxPolicyFromCcaasHandler({
    organizationId: "1000",
    connectionId: "1008",
    accountEmail: "support@example.com",
    ccaasHandler: "bot",
  });
  assert.equal(policy.botEnabled, true);
  assert.equal(policy.liveAgentEnabled, true);
  assert.equal(policy.autoSendEnabled, true);
  assert.equal(policy.shadowMode, false);
});

test("deriveMailboxPolicyFromCcaasHandler stringifies bigint connectionId", () => {
  const policy = deriveMailboxPolicyFromCcaasHandler({
    organizationId: "1000",
    connectionId: 1008n,
    accountEmail: "support@example.com",
    ccaasHandler: "bot",
  });
  assert.equal(policy.connectionId, "1008");
});

test("ccaas_handler bot_then_human defaults to shadow audit mode", () => {
  const policy = deriveMailboxPolicyFromCcaasHandler({
    organizationId: "1000",
    connectionId: "1008",
    accountEmail: "support@example.com",
    ccaasHandler: "bot_then_human",
  });
  assert.equal(policy.botEnabled, true);
  assert.equal(policy.liveAgentEnabled, true);
  assert.equal(policy.shadowMode, true);
  assert.equal(policy.autoSendEnabled, false);
});
