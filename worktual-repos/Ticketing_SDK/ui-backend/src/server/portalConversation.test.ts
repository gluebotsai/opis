import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isStoredPortalConversationNote } from "./portalConversation.js";

describe("isStoredPortalConversationNote", () => {
  it("keeps portal chat and CSAT lines", () => {
    assert.equal(isStoredPortalConversationNote("VPN is down on my laptop"), true);
    assert.equal(isStoredPortalConversationNote("CSAT 5/5 — fast help"), true);
  });

  it("leaves email dumps and outbound mail copies in ticket notes", () => {
    assert.equal(
      isStoredPortalConversationNote("Email reply from Ada:\nStill broken"),
      false
    );
    assert.equal(
      isStoredPortalConversationNote("[#120] We received your request\n\nThanks"),
      false
    );
    assert.equal(
      isStoredPortalConversationNote("Re: VPN down\n\nFollowing up"),
      false
    );
  });
});
