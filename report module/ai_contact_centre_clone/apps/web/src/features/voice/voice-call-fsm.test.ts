import assert from "node:assert/strict";
import test from "node:test";

import { canTransitionVoiceCall, transitionVoiceCall } from "./voice-call-fsm";

test("supports consult, merge, transfer and wrap-up paths", () => {
  assert.equal(canTransitionVoiceCall("established", "consult_pending"), true);
  assert.equal(canTransitionVoiceCall("consult_pending", "consult_active"), true);
  assert.equal(canTransitionVoiceCall("consult_active", "merge_requested"), true);
  assert.equal(canTransitionVoiceCall("merge_requested", "conferenced"), true);
  assert.equal(canTransitionVoiceCall("consult_active", "transfer_requested"), true);
  assert.equal(canTransitionVoiceCall("transfer_requested", "transferred"), true);
  assert.equal(canTransitionVoiceCall("transferred", "wrap_up"), true);
});

test("rejects topology jumps", () => {
  assert.equal(canTransitionVoiceCall("ringing", "conferenced"), false);
  assert.throws(
    () => transitionVoiceCall("ringing", "conferenced"),
    /Invalid voice call transition/,
  );
});
