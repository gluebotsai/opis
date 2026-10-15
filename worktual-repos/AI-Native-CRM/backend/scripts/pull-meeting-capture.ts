/**
 * Pull transcript from meeting-service / Recall into CRM for a meeting activity.
 * Run: npx tsx scripts/pull-meeting-capture.ts <activityId>
 * (loads DATABASE_URL from repo root `.env` automatically)
 */
import "./load-repo-env.js";
import { prisma } from "../src/dao/db/prisma.js";
import {
  readCaptureBotMeta,
  reconcileMeetingCapture,
} from "../src/service/transcripts/meeting-capture.js";

const activityId = process.argv[2];
if (!activityId) {
  console.error("Usage: npx tsx scripts/pull-meeting-capture.ts <activityId>");
  process.exit(1);
}

async function main() {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      subject: true,
      dueAt: true,
      transcriptText: true,
      transcriptSource: true,
    },
  });
  if (!activity) throw new Error(`Activity not found: ${activityId}`);

  const session = await prisma.meetingAssistSession.findUnique({
    where: { activityId },
    select: { id: true, meta: true },
  });
  const capture = session ? readCaptureBotMeta(session.meta) : null;

  console.log("activity", activity.id, activity.subject);
  console.log("dueAt", activity.dueAt?.toISOString());
  console.log("capture meta", capture);
  console.log("transcript chars before", activity.transcriptText?.length || 0);

  const ok = await reconcileMeetingCapture(activityId);
  console.log("reconcile", ok ? "OK" : "no transcript yet");

  const after = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: { transcriptText: true, transcriptSource: true },
  });
  console.log("transcript chars after", after?.transcriptText?.length || 0);
  console.log("transcript source", after?.transcriptSource || null);
  if (after?.transcriptText?.trim()) {
    console.log("preview:", after.transcriptText.slice(0, 400));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
