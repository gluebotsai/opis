import { describe, expect, it } from "vitest";
import { buildAnonymousScopeProfile } from "../utils/guestUserProfile.js";
import {
  pickLiveSessionCdpProfile,
  profileDisplayLabel,
  type VisitorCdpProfile,
} from "../utils/visitorCdpProfile.js";
import { pickLiveSessionIdForVisitor, sessionDisplayMapKey, sessionDisplayProfileOrAnonymous } from "./sessionDisplayIdentity.js";

function knownProfile(userId: string, name: string): VisitorCdpProfile {
  return {
    cdp_id: `wt:1:${userId}`,
    contact_type: "User",
    display_name: name,
    first_name: name.split(" ")[0] ?? name,
    last_name: name.split(" ").slice(1).join(" "),
    primary_email: "",
    primary_phone: "",
    company: "",
    acquisition_channel: "",
    webtracking_user_id: userId,
    is_cdp_known: true,
    identity_label: "User",
    linked_visitor_ids_count: 1,
    linked_visitor_ids: ["v1"],
    other_linked_visitor_ids: [],
  };
}

describe("sessionDisplayProfileOrAnonymous", () => {
  it("returns Anonymous when session row has no cdp_id", () => {
    const profile = sessionDisplayProfileOrAnonymous({ cdp_id: "", webtracking_user_id: "" }, "v1");
    expect(profile.is_cdp_known).toBe(false);
    expect(profileDisplayLabel(profile)).toBe("Anonymous");
  });
});

describe("pickLiveSessionIdForVisitor", () => {
  it("keeps first session per visitor", () => {
    const map = pickLiveSessionIdForVisitor([
      { session_id: "s1", visitor_id: "v1" },
      { session_id: "s2", visitor_id: "v1" },
    ]);
    expect(map.get("v1")).toBe("s1");
  });
});

describe("sessionDisplayMapKey", () => {
  it("pairs session and visitor", () => {
    expect(sessionDisplayMapKey({ session_id: "s", visitor_id: "v" })).toContain("s");
    expect(sessionDisplayMapKey({ session_id: "s", visitor_id: "v" })).toContain("v");
  });
});

describe("pickLiveSessionCdpProfile", () => {
  it("does not fall back to visitor latest known", () => {
    const session = buildAnonymousScopeProfile();
    const visitor = knownProfile("u-old", "Guru");
    expect(pickLiveSessionCdpProfile(session, visitor)).toBe(session);
    expect(profileDisplayLabel(pickLiveSessionCdpProfile(session, visitor))).toBe("Anonymous");
  });
});
