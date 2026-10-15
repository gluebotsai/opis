import assert from "node:assert/strict";
import test from "node:test";

import { channelConfigIdFromMailbox } from "./channel-config-id.js";

test("channelConfigIdFromMailbox mirrors mailbox_connection_id when present", () => {
  assert.equal(channelConfigIdFromMailbox("1005"), "1005");
  assert.equal(channelConfigIdFromMailbox(" 1022 "), "1022");
  assert.equal(channelConfigIdFromMailbox(null), null);
  assert.equal(channelConfigIdFromMailbox(undefined), null);
  assert.equal(channelConfigIdFromMailbox(""), null);
  assert.equal(channelConfigIdFromMailbox("   "), null);
});
