import "./load-repo-env.js";
import { prisma } from "../src/dao/db/prisma.js";
import { ensureAssistSessionForMeeting } from "../src/service/ai/meeting-assist.js";
import { parseMeetingLinkFromBody } from "../src/lib/meeting-body.js";
import {
  cancelStaleMeetingCaptureBots,
  dispatchMeetingCaptureBot,
} from "../src/service/transcripts/meeting-capture.js";

const activityId = process.argv[2] || "cmt2ptmeg00001aq86l5t4qbq";

async function main() {
  const activity = await prisma.contactActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      contactId: true,
      type: true,
      body: true,
      dueAt: true,
      organizationId: true,
    },
  });
  if (!activity || activity.type !== "meeting") {
    throw new Error(`Meeting activity not found: ${activityId}`);
  }

  const joinUrl = parseMeetingLinkFromBody(activity.body);
  console.log("activity", activity.id, "dueAt", activity.dueAt?.toISOString());
  console.log("joinUrl", joinUrl);

  await cancelStaleMeetingCaptureBots(activity.contactId, activity.id);
  await ensureAssistSessionForMeeting({
    activityId: activity.id,
    contactId: activity.contactId,
    organizationId: activity.organizationId,
    provider: "google_meet",
    joinUrl,
  });

  const result = await dispatchMeetingCaptureBot({
    activityId: activity.id,
    forceReschedule: true,
  });
  console.log("dispatch", JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
