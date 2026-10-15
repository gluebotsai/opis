import assert from "node:assert/strict";
import test from "node:test";

import {
  CALLBACK_OUTREACH_CHANNELS,
  pickBestOutreachChannel,
} from "./preferred-channel.js";

test("pickBestOutreachChannel prefers WhatsApp when multiple channels exist", () => {
  const resolved = pickBestOutreachChannel({
    activityChannels: ["email", "instagram", "whatsapp"],
    reachableChannels: new Set(["email", "instagram", "whatsapp"]),
  });
  assert.equal(resolved, "whatsapp");
});

test("pickBestOutreachChannel falls back to email when only email exists", () => {
  const resolved = pickBestOutreachChannel({
    activityChannels: ["email"],
    reachableChannels: new Set(["email"]),
  });
  assert.equal(resolved, "email");
});

test("pickBestOutreachChannel includes reachable hint channel in ranking", () => {
  const resolved = pickBestOutreachChannel({
    activityChannels: [],
    reachableChannels: new Set(["facebook"]),
    hintChannel: "facebook",
  });
  assert.equal(resolved, "facebook");
});

test("pickBestOutreachChannel ignores unreachable hint channel", () => {
  const resolved = pickBestOutreachChannel({
    activityChannels: ["webchat"],
    reachableChannels: new Set(),
    hintChannel: "whatsapp",
  });
  assert.equal(resolved, null);
});

test("pickBestOutreachChannel ignores activity-only outreach without identity", () => {
  const resolved = pickBestOutreachChannel({
    activityChannels: ["whatsapp", "email"],
    reachableChannels: new Set(),
  });
  assert.equal(resolved, null);
});

test("pickBestOutreachChannel returns null when no outreach channel is available", () => {
  const resolved = pickBestOutreachChannel({
    activityChannels: ["voice", "webchat"],
    reachableChannels: new Set(),
  });
  assert.equal(resolved, null);
});

test("callback outreach priority ordering is stable", () => {
  assert.deepEqual(CALLBACK_OUTREACH_CHANNELS, [
    "whatsapp",
    "instagram",
    "facebook",
    "email",
  ]);
});
