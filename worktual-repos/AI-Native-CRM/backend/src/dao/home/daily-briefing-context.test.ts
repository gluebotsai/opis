/**
 * run: npx tsx --tsconfig tsconfig.json src/dao/home/daily-briefing-context.test.ts
 */
import {
  greetingBandForHour,
  greetingForIstHour,
  isDailyBriefingRole,
  istCalendarDate,
  withCurrentGreeting,
} from "@/dao/home/daily-briefing-context";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(greetingForIstHour(8, "Aravind") === "Good morning, Aravind.", "morning");
assert(greetingForIstHour(14, "Yaswanth") === "Good afternoon, Yaswanth.", "afternoon");
assert(greetingForIstHour(19, "there") === "Good evening, there.", "evening");
assert(greetingBandForHour(11) === "morning", "band morning");
assert(greetingBandForHour(12) === "afternoon", "band afternoon");
assert(greetingBandForHour(17) === "evening", "band evening");
assert(
  withCurrentGreeting("Good morning, Aravind.\nYou have two meetings.", "Aravind", 15) ===
    "Good afternoon, Aravind.\nYou have two meetings.",
  "refresh morning→afternoon",
);
assert(
  withCurrentGreeting(
    "Good morning, Aravind.\nYou have two meetings.\nHave a smooth afternoon.\nTake care today.",
    "Aravind",
    15,
  ) ===
    "Good afternoon, Aravind.\nYou have two meetings.\nHave a smooth afternoon.\nTake care today.",
  "refresh morning→afternoon keeps matching closer",
);
assert(
  withCurrentGreeting(
    "Good morning, Aravind.\nYou have two meetings.\nHave a smooth afternoon.\nTake care today.",
    "Aravind",
    9,
  ) ===
    "Good morning, Aravind.\nYou have two meetings.\nTake care today.",
  "refresh drops mismatched daypart closer",
);
assert(isDailyBriefingRole("sales_rep"), "rep enabled");
assert(isDailyBriefingRole("finance"), "finance enabled");
assert(!isDailyBriefingRole("marketing"), "marketing skipped");
assert(!isDailyBriefingRole("viewer"), "viewer skipped");
assert(/^\d{4}-\d{2}-\d{2}$/.test(istCalendarDate()), "ist date format");

import { digitsToSpokenText, integerToSpokenWords } from "@/lib/spoken-numbers";
assert(integerToSpokenWords(188) === "one hundred and eighty eight", "188 words");
assert(integerToSpokenWords(2) === "two", "two");
assert(
  digitsToSpokenText("188 leads and 2 tasks") ===
    "one hundred and eighty eight leads and two tasks",
  "script digits",
);
assert(
  digitsToSpokenText("Meet at 10:30 am with two people.") ===
    "Meet at 10:30 am with two people.",
  "keep clock times",
);

import { pcm16leMonoToWav } from "@/lib/pcm-wav";

const pcm = Buffer.alloc(8);
pcm.writeInt16LE(1000, 0);
pcm.writeInt16LE(-1000, 2);
pcm.writeInt16LE(2000, 4);
pcm.writeInt16LE(-2000, 6);
const wav = pcm16leMonoToWav(pcm, 22050);
assert(wav.toString("ascii", 0, 4) === "RIFF", "wav riff");
assert(wav.toString("ascii", 8, 12) === "WAVE", "wav wave");
assert(wav.length === 52, "wav size");
assert(wav.readUInt32LE(24) === 22050, "sample rate");

console.log("daily-briefing-context ok");
