/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/meeting-assist-transcript-dedupe.test.ts
 */
import assert from "node:assert/strict";
import {
  dedupeSpeakerTextTranscript,
  liveUtteranceSyncKey,
} from "./meeting-assist-transcript-dedupe";

assert.equal(
  liveUtteranceSyncKey("Lucifer", "What are the products you have"),
  liveUtteranceSyncKey("lucifer", "What  are the products you have"),
);

assert.notEqual(
  liveUtteranceSyncKey("lucifer", "Hello"),
  liveUtteranceSyncKey("lucifer", "Goodbye"),
);

const raw = [
  "lucifer: What are the products you have",
  "lucifer: What are the products you have",
  "lucifer: Can you tell about CRM",
  "lucifer: Can you tell about CRM",
].join("\n");
assert.equal(
  dedupeSpeakerTextTranscript(raw),
  [
    "lucifer: What are the products you have",
    "lucifer: Can you tell about CRM",
  ].join("\n"),
);

console.log("meeting-assist-transcript-dedupe.test.ts ok");
