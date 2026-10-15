/**
 * Lightweight unit checks (run: npx tsx src/service/transcripts/meeting-capture.test.ts)
 */
import {
  captureUsesAdHocJoin,
  computeCaptureJoinAt,
  captureJoinAtMismatch,
  formatRecallTranscriptPayload,
  shouldReuseExistingCaptureBot,
} from "./meeting-capture";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const recallList = [
  {
    participant: { name: "Sivaji Official" },
    words: [{ text: "Good evening." }, { text: "Yes, it's fine." }],
  },
  {
    participant: { name: "Worktual Notetaker" },
    words: [{ text: "Thanks for joining." }],
  },
];

const formatted = formatRecallTranscriptPayload(recallList);
assert(formatted?.includes("Sivaji Official: Good evening. Yes, it's fine."), "speaker lines");
assert(formatted?.includes("Worktual Notetaker: Thanks for joining."), "second speaker");
assert(formatRecallTranscriptPayload({ transcript: recallList }) === formatted, "wrapped transcript");
assert(formatRecallTranscriptPayload("") === null, "empty string");
assert(formatRecallTranscriptPayload(null) === null, "null");

const futureDue = new Date("2026-08-21T15:00:00.000Z");
const joinAt = computeCaptureJoinAt(futureDue, futureDue.getTime() - 30 * 60_000);
assert(joinAt === "2026-08-21T14:55:00.000Z", "join_at 5 min before due");

assert(
  shouldReuseExistingCaptureBot({
    existing: {
      status: "scheduled",
      botId: "bot-1",
      joinAt: "2026-08-21T14:00:00.000Z",
      updatedAt: "2026-08-21T12:00:00.000Z",
    },
  }),
  "reuse scheduled bot",
);
assert(
  !shouldReuseExistingCaptureBot({
    forceReschedule: true,
    existing: {
      status: "scheduled",
      botId: "bot-1",
      joinAt: "2026-08-21T14:00:00.000Z",
      updatedAt: "2026-08-21T12:00:00.000Z",
    },
  }),
  "force reschedule skips reuse",
);
assert(
  !shouldReuseExistingCaptureBot({
    existing: {
      status: "failed",
      botId: null,
      error: "Capture bot create failed",
      updatedAt: "2026-08-21T12:00:00.000Z",
    },
  }),
  "failed capture is not reused",
);

const soonDue = new Date("2026-08-21T09:09:00.000Z");
assert(
  captureUsesAdHocJoin(soonDue, soonDue.getTime() - 5 * 60_000),
  "ad-hoc when under 10 min",
);
assert(
  !captureUsesAdHocJoin(soonDue, soonDue.getTime() - 15 * 60_000),
  "scheduled when 15 min out",
);

assert(
  captureJoinAtMismatch(
    {
      status: "scheduled",
      botId: "bot-1",
      joinAt: "2026-09-09T15:29:00.000Z",
      updatedAt: "2026-09-08T10:36:00.000Z",
    },
    new Date("2026-09-08T12:00:00.000Z"),
    new Date("2026-09-08T11:00:00.000Z").getTime(),
  ),
  "detect stale joinAt after demo reschedule",
);
assert(
  !captureJoinAtMismatch(
    {
      status: "scheduled",
      botId: "bot-1",
      joinAt: computeCaptureJoinAt(
        new Date("2026-09-08T12:00:00.000Z"),
        new Date("2026-09-08T11:00:00.000Z").getTime(),
      ),
      updatedAt: "2026-09-08T10:36:00.000Z",
    },
    new Date("2026-09-08T12:00:00.000Z"),
    new Date("2026-09-08T11:00:00.000Z").getTime(),
  ),
  "aligned joinAt is not stale",
);

assert(
  !captureJoinAtMismatch(
    {
      status: "scheduled",
      botId: "bot-1",
      joinAt: "2026-08-21T09:04:00.000Z",
      updatedAt: "2026-08-21T09:00:00.000Z",
    },
    new Date("2026-08-21T09:09:00.000Z"),
    new Date("2026-08-21T09:05:00.000Z").getTime(),
  ),
  "ad-hoc window does not treat joinAt drift as stale",
);

console.log("meeting-capture.test.ts ok");
