import assert from "node:assert/strict";
import test from "node:test";

import {
  CCAAS_HUB_CLIENT_ID,
  HUB_A2A_SERVER_NAME,
  upsertHubOutboundTokenSchema,
} from "./a2a-hub-tokens.js";

test("defaults to dedicated CCaaS Hub client identity", () => {
  assert.equal(HUB_A2A_SERVER_NAME, "worktual-hub");
  assert.equal(CCAAS_HUB_CLIENT_ID, "worktual-ccaas-hub");
});

test("validates outbound token upsert payload", () => {
  const parsed = upsertHubOutboundTokenSchema.parse({
    organizationId: "1000",
    accessToken: "a".repeat(32),
    accessExpiresAt: "2026-08-29T12:00:00.000Z",
    refreshToken: "b".repeat(32),
    refreshExpiresAt: "2026-09-29T12:00:00.000Z",
    skillVersion: "1.0.0",
  });
  assert.equal(parsed.clientId, "worktual-ccaas-hub");
  assert.equal(parsed.a2aServerName, "worktual-hub");
});
