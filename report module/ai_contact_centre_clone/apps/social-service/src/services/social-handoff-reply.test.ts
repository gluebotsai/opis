import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENTS_BUSY_MESSAGE,
  HANDOFF_HOLD_MESSAGE,
  resolveSocialHandoffReply,
} from "./social-handoff-reply.js";

test("resolveSocialHandoffReply returns connecting message when routed", () => {
  const result = resolveSocialHandoffReply({
    handoff: { queued: true, assignment: null },
    handoffMessage: "Please wait.",
  });
  assert.equal(result.text, "Please wait.");
  assert.equal(result.routed, true);
});

test("resolveSocialHandoffReply uses default hold message when routed without copy", () => {
  const result = resolveSocialHandoffReply({
    handoff: { queued: true, assignment: null },
  });
  assert.equal(result.text, HANDOFF_HOLD_MESSAGE);
  assert.equal(result.routed, true);
});

test("resolveSocialHandoffReply returns busy message when not routed", () => {
  const result = resolveSocialHandoffReply({
    handoff: {
      queued: false,
      assignment: null,
      systemMessage: { body: AGENTS_BUSY_MESSAGE },
    },
  });
  assert.equal(result.text, AGENTS_BUSY_MESSAGE);
  assert.equal(result.routed, false);
});

test("resolveSocialHandoffReply falls back to busy message when handoff is null", () => {
  const result = resolveSocialHandoffReply({ handoff: null });
  assert.equal(result.text, AGENTS_BUSY_MESSAGE);
  assert.equal(result.routed, false);
});
