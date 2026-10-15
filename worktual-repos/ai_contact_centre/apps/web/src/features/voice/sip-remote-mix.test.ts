import assert from "node:assert/strict";
import test from "node:test";

import { shouldKeepConsultPlayback, shouldPlayCustomerConferenceTrack } from "./sip-remote-mix";

test("customer conference audio plays only after that track is receiving", () => {
  assert.equal(shouldPlayCustomerConferenceTrack({ merged: true, muted: true, ended: false }), false);
  assert.equal(shouldPlayCustomerConferenceTrack({ merged: true, muted: false, ended: false }), true);
  assert.equal(shouldPlayCustomerConferenceTrack({ merged: false, muted: false, ended: false }), false);
  assert.equal(shouldPlayCustomerConferenceTrack({ merged: true, muted: false, ended: true }), false);
});

test("consult playback ignores the held customer leg until merge", () => {
  assert.equal(
    shouldKeepConsultPlayback({ leg: "customer", merged: false, consultActive: true }),
    true,
  );
  assert.equal(
    shouldKeepConsultPlayback({ leg: "consult", merged: false, consultActive: true }),
    false,
  );
  assert.equal(
    shouldKeepConsultPlayback({ leg: "customer", merged: true, consultActive: true }),
    false,
  );
  assert.equal(
    shouldKeepConsultPlayback({ leg: "customer", merged: false, consultActive: false }),
    false,
  );
});
