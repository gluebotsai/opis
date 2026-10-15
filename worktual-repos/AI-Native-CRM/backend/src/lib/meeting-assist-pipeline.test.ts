/**
 * End-to-end proof that the live Assist gate — as actually wired through
 * AssistLiveContext.people / classifyAttendeeTurn / shouldAutoAssistFromChunk
 * — coaches ONLY genuine customer/external speech and NEVER the sales rep
 * or pre-sales side, across full simulated call turn sequences, using
 * nothing but the channel/turn lock (`attendeeRole`) — no name or email
 * string comparison anywhere in the coaching decision itself.
 *
 * run: npx tsx --tsconfig tsconfig.json src/lib/meeting-assist-pipeline.test.ts
 */
import assert from "node:assert/strict";
import {
  buildAttendeePeople,
  classifyAttendeeTurn,
  type AttendeeLock,
  type AttendeePerson,
} from "./meeting-attendee-identity";
import { shouldAutoAssistFromChunk } from "./meeting-assist-speakers";

process.env.MEET_CHANNEL_BINDINGS = "0";

/** Mirrors loadAssistLiveContext's per-turn channel locking, in memory. */
function makeCallSimulator(people: AttendeePerson[], hostMeetName: string | null, hostEmail: string | null) {
  const locks = new Map<string, AttendeeLock>();
  return {
    speak(speakerKey: string, displayName: string | null): AttendeeLock {
      const channel = speakerKey.split(":")[0]!;
      const existing = locks.get(channel) ?? null;
      const next = classifyAttendeeTurn({
        sessionId: "sess-sim",
        speakerKey,
        displayName,
        people,
        hostMeetName,
        hostEmail,
        locks: [...locks.values()].filter((l) => l.id !== existing?.id),
        existing,
      });
      locks.set(channel, next);
      return next;
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario A: rep testing SOLO against a misconfigured "ravi r" contact
// whose CRM email is literally the rep's own Gmail (the exact real-world
// bug report). There is no second person on this call at all.
// ---------------------------------------------------------------------------
{
  const sharedEmail = "yaswanthmg345@gmail.com";
  const hostMeetName = "Yaswanth M G";
  const contactName = "ravi r"; // CRM contact display name — unrelated text
  const contactEmail = sharedEmail; // but same mailbox as the rep

  // This is exactly what buildAttendeePeople produces in loadAssistLiveContext:
  // customer put first, then host put with the SAME email — the host entry
  // wins, so there is only one seat on this call and it is "host".
  const people = buildAttendeePeople({
    roster: [],
    customerEmail: contactEmail,
    customerName: contactName,
    hostEmail: sharedEmail,
    hostName: hostMeetName,
  });
  assert.equal(people.length, 1, "shared mailbox must collapse to a single seat");
  assert.equal(people[0]!.role, "host", "the shared seat must resolve to host, not customer");

  const sim = makeCallSimulator(people, hostMeetName, sharedEmail);

  // The rep talks on the same mic for 8 turns (a real solo test call).
  const lines = [
    "Yes, that's great",
    "Do you hear me",
    "Yes I can hear you clearly",
    "Let's get started with the agenda",
    "Can you see my screen",
    "I also have a friend",
    "Okay perfect",
    "Let's continue then",
  ];
  let anyCoached = false;
  for (const _text of lines) {
    const lock = sim.speak("ch-0:1", hostMeetName);
    assert.equal(lock.role, "host", "solo rep channel must lock as host");
    const coach = shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: lock.role });
    if (coach) anyCoached = true;
  }
  assert.equal(anyCoached, false, "SCENARIO A FAILED: rep-solo call must never get Assist coaching");

  // Also prove it stays false for a stray line arriving with a stale /
  // unresolved "unknown" role (e.g. before the first classify pass lands).
  assert.equal(shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: "unknown" }), false);

  console.log("Scenario A (rep solo, shared mailbox contact) — no coaching: OK");
}

// ---------------------------------------------------------------------------
// Scenario B: a REAL customer call — rep + a genuine external customer with
// a distinct email, alternating turns. Rep lines must never coach; customer
// lines must always coach, including through a Meet caption glitch that
// repeats the host's name on the customer's own (already-locked) channel.
// ---------------------------------------------------------------------------
{
  const hostMeetName = "Yaswanth M G";
  const hostEmail = "yaswanth@worktual.io";
  const contactName = "Ravi Kumar";
  const contactEmail = "ravi@customer.com";

  const people = buildAttendeePeople({
    roster: [],
    customerEmail: contactEmail,
    customerName: contactName,
    hostEmail,
    hostName: hostMeetName,
  });
  assert.equal(people.length, 2);

  const sim = makeCallSimulator(people, hostMeetName, hostEmail);

  const script: Array<{ channel: string; name: string; text: string }> = [
    { channel: "ch-0:1", name: hostMeetName, text: "Hi Ravi, thanks for joining today." },
    { channel: "ch-1:1", name: "Ravi Kumar", text: "Thanks, glad to be here." },
    { channel: "ch-0:2", name: hostMeetName, text: "Let me share the proposal." },
    { channel: "ch-1:2", name: "Ravi Kumar", text: "What's the pricing for the enterprise tier?" },
    { channel: "ch-0:3", name: hostMeetName, text: "Great question, let me pull that up." },
    // Meet caption glitch: customer's already-locked channel briefly
    // repeats the host's name. The sticky lock must be trusted anyway.
    { channel: "ch-1:3", name: hostMeetName, text: "Sorry, can you repeat that?" },
    { channel: "ch-1:4", name: "Ravi Kumar", text: "Also, when can we start onboarding?" },
  ];

  const results: Array<{ text: string; role: string; coached: boolean }> = [];
  for (const line of script) {
    const lock = sim.speak(line.channel, line.name);
    const coached = shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: lock.role });
    results.push({ text: line.text, role: lock.role, coached });
  }

  for (const [i, line] of script.entries()) {
    if (line.channel.startsWith("ch-0")) {
      assert.equal(
        results[i]!.coached,
        false,
        `SCENARIO B FAILED: rep line coached — "${line.text}"`,
      );
    }
  }
  for (const [i, line] of script.entries()) {
    if (line.channel.startsWith("ch-1")) {
      assert.equal(
        results[i]!.coached,
        true,
        `SCENARIO B FAILED: customer line not coached — "${line.text}" (role=${results[i]!.role})`,
      );
    }
  }

  console.log("Scenario B (real rep + real customer, alternating) — gate matches speaker exactly: OK");
}

// ---------------------------------------------------------------------------
// Scenario C: pre-sales joins the same call as a second internal voice
// (their own distinct email, signed into the panel) — must also never be
// coached, even though they are not the primary "host". Both internal
// people speak before the customer, which is how elimination resolves the
// customer's very first line without ever comparing their name/email.
// ---------------------------------------------------------------------------
{
  const hostMeetName = "Yaswanth M G";
  const hostEmail = "yaswanth@worktual.io";
  const preSalesName = "Pre Sales Priya";
  const preSalesEmail = "priya@worktual.io";
  const contactName = "Ravi Kumar";
  const contactEmail = "ravi@customer.com";

  const people = buildAttendeePeople({
    roster: [{ email: preSalesEmail, name: preSalesName, role: "rep" }],
    customerEmail: contactEmail,
    customerName: contactName,
    hostEmail,
    hostName: hostMeetName,
  });
  assert.equal(people.length, 3);

  const sim = makeCallSimulator(people, hostMeetName, hostEmail);

  const hostLock = sim.speak("ch-0:1", hostMeetName);
  assert.equal(hostLock.role, "host");
  assert.equal(
    shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: hostLock.role }),
    false,
    "SCENARIO C FAILED: rep speech must never coach",
  );

  const preSalesLock = sim.speak("ch-2:1", preSalesName);
  assert.equal(preSalesLock.role, "host");
  assert.equal(
    shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: preSalesLock.role }),
    false,
    "SCENARIO C FAILED: pre-sales speech must never coach",
  );

  // Both internal seats are now locked — the customer's very first line
  // resolves purely by elimination (one seat left in a 3-person roster).
  const customerLock = sim.speak("ch-1:1", "Ravi Kumar");
  assert.equal(customerLock.role, "customer");
  assert.equal(
    shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: customerLock.role }),
    true,
    "SCENARIO C FAILED: customer speech must still coach",
  );

  console.log("Scenario C (pre-sales + host + customer) — only customer coached: OK");
}

console.log("meeting-assist-pipeline.test.ts ok");
