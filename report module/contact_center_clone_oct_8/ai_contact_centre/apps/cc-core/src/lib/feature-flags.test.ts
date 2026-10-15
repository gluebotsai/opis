import assert from "node:assert/strict";
import test from "node:test";

import { createTenantFeatureFlagResolver } from "./feature-flags.js";

test("tenant feature flags default off", () => {
  const flags = createTenantFeatureFlagResolver({});

  assert.deepEqual(flags.snapshot("100"), {
    "dialog-routing": false,
    "presence-db-read": false,
    "publish-only-presence": false,
    "offer-snapshot": false,
  });
});

test("tenant feature flags isolate organization allowlists", () => {
  const flags = createTenantFeatureFlagResolver({
    CCAAS_DIALOG_ROUTING_ORGANIZATIONS: "100, 300",
    CCAAS_PRESENCE_DB_READ_ORGANIZATIONS: "200",
  });

  assert.equal(flags.isEnabled("dialog-routing", "100"), true);
  assert.equal(flags.isEnabled("dialog-routing", "200"), false);
  assert.equal(flags.isEnabled("presence-db-read", "100"), false);
  assert.equal(flags.isEnabled("presence-db-read", "200"), true);
});

test("tenant feature flag lookups reject an absent organization scope", () => {
  const flags = createTenantFeatureFlagResolver({
    CCAAS_DIALOG_ROUTING_ORGANIZATIONS: "100",
  });

  assert.throws(() => flags.isEnabled("dialog-routing", " "), /organizationId is required/);
});
