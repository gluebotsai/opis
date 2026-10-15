/**
 * run: npx tsx src/service/ai/nurture-voice-intent.test.ts
 */
import assert from "node:assert/strict";
import { assessNurtureVoiceIntent } from "./nurture-voice-intent";

assert.equal(
  assessNurtureVoiceIntent([
    {
      type: "email",
      subject: "Re: demo",
      body: "Yes, schedule a call next week",
      emailDirection: "inbound",
      createdAt: new Date().toISOString(),
    },
  ]).blocked,
  true,
);

assert.equal(
  assessNurtureVoiceIntent([
    {
      type: "meeting",
      subject: "Product demo",
      body: "Calendar hold",
      emailDirection: null,
      createdAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    },
  ]).blocked,
  true,
);

assert.equal(
  assessNurtureVoiceIntent([
    {
      type: "email",
      subject: "Thanks",
      body: "Got your note.",
      emailDirection: "inbound",
      createdAt: new Date().toISOString(),
    },
  ]).blocked,
  false,
);

console.log("nurture-voice-intent.test.ts ok");
