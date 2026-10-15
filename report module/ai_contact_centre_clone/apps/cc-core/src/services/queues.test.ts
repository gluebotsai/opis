import assert from "node:assert/strict";
import test from "node:test";

import { queueAgentSchema } from "./queues.js";
import {
  asStringArray,
  callDirectionFlagsFromAgent,
  isContactCenterStaffRole,
  mergeAgentSkillsForQueue,
  skillsOverlap,
} from "./queues-helpers.js";

test("isContactCenterStaffRole accepts Agent and Admin only", () => {
  assert.equal(isContactCenterStaffRole("Agent"), true);
  assert.equal(isContactCenterStaffRole("admin"), true);
  assert.equal(isContactCenterStaffRole(" Admin "), true);
  assert.equal(isContactCenterStaffRole("Admin/Manager"), false);
  assert.equal(isContactCenterStaffRole("Marketing"), false);
  assert.equal(isContactCenterStaffRole(""), false);
});

test("asStringArray parses json arrays", () => {
  assert.deepEqual(asStringArray(["a", "b"]), ["a", "b"]);
  assert.deepEqual(asStringArray('["x","y"]'), ["x", "y"]);
  assert.deepEqual(asStringArray("a, b"), ["a", "b"]);
});

test("skillsOverlap requires intersection when queue has skills", () => {
  assert.equal(skillsOverlap(["Billing"], ["billing", "chat"]), true);
  assert.equal(skillsOverlap(["Billing"], ["chat"]), false);
  assert.equal(skillsOverlap([], ["chat"]), true);
});

test("mergeAgentSkillsForQueue adds missing queue skills on assignment", () => {
  assert.deepEqual(mergeAgentSkillsForQueue(["chat"], ["english"]), ["chat", "english"]);
  assert.deepEqual(mergeAgentSkillsForQueue(["English"], ["english"]), ["English"]);
  assert.deepEqual(mergeAgentSkillsForQueue(["chat"], []), ["chat"]);
});

test("callDirectionFlagsFromAgent satisfies setup_ccaas_queue_agents_call_flags_chk", () => {
  assert.deepEqual(callDirectionFlagsFromAgent(false, "both"), {
    handlesInbound: false,
    handlesOutbound: false,
    handlesOutboundCampaign: false,
  });
  assert.deepEqual(callDirectionFlagsFromAgent(true, "inbound"), {
    handlesInbound: true,
    handlesOutbound: false,
    handlesOutboundCampaign: false,
  });
  assert.deepEqual(callDirectionFlagsFromAgent(true, "outbound"), {
    handlesInbound: false,
    handlesOutbound: true,
    handlesOutboundCampaign: false,
  });
  assert.deepEqual(callDirectionFlagsFromAgent(true, "both"), {
    handlesInbound: true,
    handlesOutbound: true,
    handlesOutboundCampaign: false,
  });
});

test("queue agent assignment requires a shift", () => {
  const parsed = queueAgentSchema.safeParse({
    userId: "1",
    handlesCalls: true,
    handlesEmail: false,
    handlesChat: true,
    handlesWhatsapp: false,
    handlesInstagram: false,
    handlesFacebook: false,
    chatConcurrency: 1,
    emailConcurrency: 1,
    socialConcurrency: 1,
    whatsappConcurrency: 1,
    instagramConcurrency: 1,
    facebookConcurrency: 1,
    callType: "both",
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((issue) => issue.path[0] === "shiftType"));
  }
});
