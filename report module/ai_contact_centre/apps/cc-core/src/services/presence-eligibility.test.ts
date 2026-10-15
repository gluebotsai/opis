import assert from "node:assert/strict";
import test from "node:test";

import {
  effectivePresenceState,
  isPresenceEligibleForChannel,
  type CachedAgentPresence,
} from "./presence-cache.js";
import {
  clientPresenceState,
  presenceAckIsCurrent,
  shouldRetryUnackedPresence,
} from "./presence.js";

test("effective presence treats expired ready lease as offline", () => {
  const presence: CachedAgentPresence = {
    organizationId: "org-1",
    agentId: "agent-1",
    userId: "user-1",
    state: "ready",
    reasonCode: null,
    heartbeatAt: new Date(0).toISOString(),
    leaseExpiresAt: new Date(0).toISOString(),
    updatedAt: new Date().toISOString(),
    source: "test",
  };
  assert.equal(effectivePresenceState(presence), "offline");
  assert.equal(isPresenceEligibleForChannel("chat", effectivePresenceState(presence)), false);
  assert.equal(isPresenceEligibleForChannel("email", effectivePresenceState(presence)), false);
});

test("busy presence is not eligible for any new channel assignment", () => {
  const presence: CachedAgentPresence = {
    organizationId: "org-1",
    agentId: "agent-1",
    userId: "user-1",
    state: "busy",
    reasonCode: null,
    heartbeatAt: new Date().toISOString(),
    leaseExpiresAt: null,
    updatedAt: new Date().toISOString(),
    source: "test",
  };
  assert.equal(effectivePresenceState(presence), "busy");
  assert.equal(isPresenceEligibleForChannel("chat", "busy"), false);
  assert.equal(isPresenceEligibleForChannel("email", "busy"), false);
});

test("unacked Ready keeps republishing until the stored row matches", () => {
  assert.equal(shouldRetryUnackedPresence({ requested: "ready", stored: "busy", attempt: 1 }), true);
  assert.equal(shouldRetryUnackedPresence({ requested: "ready", stored: "ready", attempt: 1 }), false);
  assert.equal(shouldRetryUnackedPresence({ requested: "ready", stored: "busy", attempt: 8 }), false);
});

test("an unacked publish is not shown, and a newer publish supersedes an older retry", () => {
  assert.equal(clientPresenceState({ requested: "ready", stored: "busy" }), "busy");
  assert.equal(clientPresenceState({ requested: "ready", stored: null }), null);
  assert.equal(presenceAckIsCurrent({ activeGeneration: 2, tickGeneration: 1 }), false);
  assert.equal(presenceAckIsCurrent({ activeGeneration: 2, tickGeneration: 2 }), true);
});
