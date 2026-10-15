import assert from "node:assert/strict";
import test from "node:test";

import { CALL_CHANNEL, isCallChannel } from "./channels.js";

test("call is the stored telephony channel", () => {
  assert.equal(CALL_CHANNEL, "call");
  assert.equal(isCallChannel("call"), true);
  assert.equal(isCallChannel("voice"), true);
  assert.equal(isCallChannel("phone"), true);
  assert.equal(isCallChannel("webchat"), false);
});
