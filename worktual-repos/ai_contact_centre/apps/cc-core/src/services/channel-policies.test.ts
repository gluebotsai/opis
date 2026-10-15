import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_POLICY } from "./channel-policies.js";
import { IllegalTransitionError } from "./conversation-transitions.js";

describe("channel policies defaults", () => {
  it("defaults to bot enabled and live agent enabled", () => {
    assert.equal(DEFAULT_POLICY.botEnabled, true);
    assert.equal(DEFAULT_POLICY.liveAgentEnabled, true);
    assert.equal(DEFAULT_POLICY.automationMode, "auto_send");
    assert.equal(DEFAULT_POLICY.confidenceThreshold, 0.85);
  });
});

describe("conversation transitions", () => {
  it("IllegalTransitionError includes event and status", () => {
    const err = new IllegalTransitionError("accept", "bot_active", "conv-1");
    assert.equal(err.event, "accept");
    assert.equal(err.currentStatus, "bot_active");
    assert.equal(err.conversationId, "conv-1");
  });
});
