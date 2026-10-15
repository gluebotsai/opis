import assert from "node:assert/strict";
import test from "node:test";

import {
  embeddedUmnPresenceWriterEnabled,
  parseEmbeddedPresenceIntent,
} from "./presence-umn-writer.js";

test("this process never commits presence; UMN owns the table", () => {
  assert.equal(embeddedUmnPresenceWriterEnabled({}), false);
  assert.equal(embeddedUmnPresenceWriterEnabled({ CCAAS_EXTERNAL_UMN_PRESENCE: "1" }), false);
  assert.equal(embeddedUmnPresenceWriterEnabled({ CCAAS_EXTERNAL_UMN_PRESENCE: "true" }), false);
});

test("presence intent keeps the authenticated organization and exact state", () => {
  const intent = parseEmbeddedPresenceIntent(
    JSON.stringify({
      domainId: 1000,
      ccaasOrganizationId: "1000",
      userId: "42",
      ccaasState: "not_ready",
      ccaasReasonCode: "login_default",
      ccaasSource: "login",
      statusName: "Not Ready",
      ext: "205",
      email: "agent@example.com",
    }),
  );
  assert.deepEqual(intent, {
    organizationId: "1000",
    userId: "42",
    state: "not_ready",
    reasonCode: "login_default",
    source: "login",
    ext: "205",
    email: "agent@example.com",
    statusName: "Not Ready",
  });
});

test("a publish without a CCaaS state is not committed from statusName alone", () => {
  assert.equal(
    parseEmbeddedPresenceIntent(
      JSON.stringify({ domainId: "1000", userId: "42", statusName: "Away" }),
    ),
    null,
  );
});
