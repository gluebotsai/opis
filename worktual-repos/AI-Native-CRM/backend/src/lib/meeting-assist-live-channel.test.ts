/**
 * run: npx tsx src/lib/meeting-assist-live-channel.test.ts
 */
import { meetingAssistLiveChannel } from "./redis";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  meetingAssistLiveChannel("sess-1") === "meeting-assist:live:sess-1:*",
  "broadcast default viewer key",
);
assert(
  meetingAssistLiveChannel("sess-1", "user-42") ===
    "meeting-assist:live:sess-1:user-42",
  "partitioned viewer channel",
);

console.log("meeting-assist-live-channel.test.ts ok");
