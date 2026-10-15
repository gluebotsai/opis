/**
 * shouldAutoAssistFromChunk now checks nothing but `attendeeRole` — no
 * name, no email, no contact-record string matching. See the comment on
 * that function in meeting-assist-speakers.ts for why: Google Meet's live
 * caption stream never exposes a verified per-utterance email, so any
 * "email-based" check on that data is really a name guess in disguise,
 * and a CRM contact record that happens to share a name/email with an
 * internal person can no longer turn the rep's own speech into "customer".
 *
 * run: npx tsx --tsconfig tsconfig.json src/lib/meeting-assist-speakers.test.ts
 */
import assert from "node:assert/strict";
import {
  isMicOrLocalSttSource,
  nameOverlap,
  pickLatestNonHostHeard,
  shouldAutoAssistFromChunk,
  shouldPublishLiveHeard,
} from "./meeting-assist-speakers";

process.env.MEET_CHANNEL_BINDINGS = "0";

// Only a confidently-locked "customer" or "other" role coaches.
assert.equal(shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: "customer" }), true);
assert.equal(shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: "other" }), true);

// Host (rep/pre-sales) never coaches, no matter what.
assert.equal(shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: "host" }), false);

// Unresolved / unlocked / missing role never coaches — Assist stays silent
// until the channel resolves via explicit tap or elimination, rather than
// guessing from a name or email string.
assert.equal(shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: "unknown" }), false);
assert.equal(shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: null }), false);
assert.equal(shouldAutoAssistFromChunk({ source: "live_pcm" }), false);

// Local Chrome-mic / browser capture is always rejected, even for a
// confidently-locked customer channel — it mixes sales + room audio.
assert.equal(shouldAutoAssistFromChunk({ source: "chrome_mic", attendeeRole: "customer" }), false);
assert.equal(shouldAutoAssistFromChunk({ source: "browser_mic", attendeeRole: "customer" }), false);
assert.equal(shouldAutoAssistFromChunk({ source: "worktual_stt", attendeeRole: "customer" }), false);
assert.equal(shouldAutoAssistFromChunk({ source: "live_pcm", attendeeRole: "customer" }), true);

assert.equal(isMicOrLocalSttSource("chrome_mic"), true);
assert.equal(isMicOrLocalSttSource("live_pcm"), false);
assert.equal(isMicOrLocalSttSource(null), false);

// nameOverlap is still exported/used by classifyAttendeeTurn to link a Meet
// caption name to the verified internal/host identity — sanity-check it
// directly since it's the one name comparison this system still relies on.
assert.equal(nameOverlap("Yaswanth M G", "Yaswanth M G"), true);
assert.equal(nameOverlap("Yaswanth", "Yaswanth M G"), true);
assert.equal(nameOverlap("Ravi Kumar", "Yaswanth M G"), false);
assert.equal(nameOverlap("", "Yaswanth M G"), false);

assert.equal(shouldPublishLiveHeard({ speaker: "lucifer", attendeeRole: "unknown" }), true);
assert.equal(shouldPublishLiveHeard({ speaker: "lucifer", attendeeRole: "customer" }), true);
assert.equal(shouldPublishLiveHeard({ speaker: "Yaswanth M G", attendeeRole: "host" }), false);
assert.equal(shouldPublishLiveHeard({ speaker: "Worktual Notetaker", attendeeRole: "unknown" }), false);

assert.deepEqual(
  pickLatestNonHostHeard(
    [
      { speaker: "Worktual Notetaker", text: "joining" },
      { speaker: "lucifer", text: "what is the pricing" },
      { speaker: "Yaswanth M G", text: "can you hear me" },
    ],
    ["Yaswanth M G"],
  ),
  { speaker: "lucifer", text: "what is the pricing" },
);

console.log("meeting-assist-speakers.test.ts ok");
