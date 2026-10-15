import assert from "node:assert/strict";
import test from "node:test";

import {
  selectVoiceConversation,
  subscriberPhonesMatch,
  voiceCallMatchesMobile,
  voiceSessionUuid,
} from "./voice-omni-summary.js";

test("voice call matches the same mobile with or without a country code", () => {
  assert.equal(voiceCallMatchesMobile(null, "919150911820"), true);
  assert.equal(voiceCallMatchesMobile("", "+91 9150911820"), true);
  assert.equal(voiceCallMatchesMobile("919150911820", "9150911820"), true);
  assert.equal(voiceCallMatchesMobile("+91 91509 11820", "9150911820"), true);
  assert.equal(voiceCallMatchesMobile("9150911820", "00919150911820"), true);
  assert.equal(voiceCallMatchesMobile("+1 (415) 555-2671", "4155552671"), true);
  assert.equal(voiceCallMatchesMobile("07911123456", "+44 7911 123456"), true);
  assert.equal(voiceCallMatchesMobile("02079460958", "+44 20 7946 0958"), true);
  assert.equal(voiceCallMatchesMobile("919150911820", "918778828184"), false);
  assert.equal(subscriberPhonesMatch("99999150911820", "9150911820"), false);
});

test("voice session uuid is the full call id", () => {
  assert.equal(
    voiceSessionUuid("ea54ca84-dbee-4f49-8f7b-3985c7c90b7b"),
    "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
  );
  assert.equal(voiceSessionUuid("sip-inbound:919150911820"), "");
});

test("voice conversation is chosen by the session id", () => {
  const rows = [
    {
      id: "1",
      contact_id: null,
      visitor_id: "919150911820",
      external_thread_id: "other-session",
      provider_thread_id: "other-session",
    },
    {
      id: "2",
      contact_id: null,
      visitor_id: "919150911820",
      external_thread_id: "prefix_ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
      provider_thread_id: "prefix_ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
    },
  ];
  assert.equal(
    selectVoiceConversation(rows, "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b")?.id,
    "2",
  );
  assert.equal(selectVoiceConversation(rows, "missing-session"), null);
});
