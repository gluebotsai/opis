/**
 * Run: npx tsx backend/src/service/transcripts/speaker-resolve.test.ts
 */
import {
  resolveSpeakerLabel,
  type SpeakerRoster,
} from "./speaker-resolve";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const roster: SpeakerRoster = new Map([
  [
    "yaswanthmg345@gmail.com",
    { label: "Yaswanth M G", role: "rep", source: "host" },
  ],
  [
    "yaswanthguna2001@gmail.com",
    { label: "Indhrajith R", role: "customer", source: "contact" },
  ],
]);

assert(
  resolveSpeakerLabel({
    roster,
    speakerEmail: "yaswanthmg345@gmail.com",
    speakerName: "yaswanth345",
  }) === "Yaswanth M G",
  "rep resolved by email",
);

assert(
  resolveSpeakerLabel({
    roster,
    speakerEmail: "yaswanthguna2001@gmail.com",
    speakerName: "Guest",
  }) === "Indhrajith R",
  "customer resolved by email",
);

assert(
  resolveSpeakerLabel({
    roster,
    speakerEmail: null,
    speakerName: "Indhrajith R",
  }) === "Indhrajith R",
  "customer resolved by display name overlap",
);

assert(
  resolveSpeakerLabel({
    roster,
    speakerEmail: null,
    speakerName: "Yaswanth M G",
    isHost: false,
    customerFallback: "Indhrajith R",
    repFallback: "Yaswanth M G",
  }) === "Indhrajith R",
  "Meet duplicate host name → guest uses isHost=false",
);

assert(
  resolveSpeakerLabel({
    roster,
    speakerEmail: null,
    speakerName: "Yaswanth M G",
    isHost: true,
    customerFallback: "Indhrajith R",
    repFallback: "Yaswanth M G",
  }) === "Yaswanth M G",
  "Meet duplicate host name → host uses isHost=true",
);

console.log("speaker-resolve.test.ts: ok");
