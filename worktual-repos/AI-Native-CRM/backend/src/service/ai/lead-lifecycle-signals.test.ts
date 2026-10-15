/**
 * Lifecycle signal noise + customer-voice guards.
 * Run: npx tsx src/service/ai/lead-lifecycle-signals.test.ts
 */
import assert from "node:assert/strict";
import {
  extractSignals,
  isInternalNoiseActivity,
} from "./lead-lifecycle-signals";

{
  assert.equal(
    isInternalNoiseActivity({
      type: "email",
      subject: "Meeting Miss: Demo with Krishna Test (Tesla)",
    }),
    true,
    "meeting miss is noise",
  );
  assert.equal(
    isInternalNoiseActivity({
      type: "note",
      subject: "Lifecycle agent: Lead status qualifying → qualified",
    }),
    true,
    "lifecycle notes are noise",
  );
  assert.equal(
    isInternalNoiseActivity({
      type: "email",
      subject: "Looking forward to our demo next week",
      body: "See you Thursday",
    }),
    false,
    "real booking language is not noise",
  );
}

{
  const signals = extractSignals([
    {
      type: "email",
      subject: "Meeting Miss: Demo discovery walkthrough",
      body: "Escalation Required — no capture evidence",
      emailDirection: "outbound",
      createdAt: new Date().toISOString(),
    },
  ]);
  assert.equal(signals.meetingBooked, false, "noise must not set meetingBooked");
  assert.equal(signals.discoveryDone, false, "noise must not set discoveryDone");
  assert.equal(signals.inboundReply, false);
}

{
  const signals = extractSignals([
    {
      type: "email",
      subject: "Re: discovery call",
      body: "We booked a demo for Thursday and covered requirements",
      emailDirection: "inbound",
      createdAt: new Date().toISOString(),
    },
  ]);
  assert.equal(signals.inboundReply, true);
  assert.equal(signals.meetingBooked, true, "inbound booking language counts");
  assert.equal(signals.discoveryDone, true, "inbound discovery counts");
}

{
  const signals = extractSignals([
    {
      type: "email",
      subject: "Quick follow-up on discovery / pricing",
      body: "Looking forward to our demo",
      emailDirection: "outbound",
      createdAt: new Date().toISOString(),
    },
  ]);
  assert.equal(
    signals.meetingBooked,
    false,
    "outbound sales copy must not set meetingBooked",
  );
  assert.equal(
    signals.discoveryDone,
    false,
    "outbound sales copy must not set discoveryDone",
  );
  assert.equal(signals.pricingInterest, false);
}

console.log("lead-lifecycle-signals.test.ts: ok");
