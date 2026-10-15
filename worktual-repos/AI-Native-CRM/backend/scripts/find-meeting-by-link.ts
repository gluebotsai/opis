/**
 * Run: npx tsx scripts/find-meeting-by-link.ts <meet-code-fragment>
 */
import "./load-repo-env.js";
import { prisma } from "../src/dao/db/prisma.js";
import { readCaptureBotMeta } from "../src/service/transcripts/meeting-capture.js";
import { parseMeetingLinkFromBody } from "../src/lib/meeting-body.js";
import {
  getMeetingServiceMeeting,
  fetchMeetingServiceTranscript,
  mapMeetingServiceStatus,
} from "../src/service/meeting-service/client.js";
import { isMeetingServiceConfigured } from "../src/service/meeting-service/config.js";

const needle = process.argv[2] || "gcg-xzci-jes";

async function main() {
  console.log("MEETING_SERVICE configured:", isMeetingServiceConfigured());
  const acts = await prisma.contactActivity.findMany({
    where: { type: "meeting", body: { contains: needle } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      subject: true,
      dueAt: true,
      transcriptText: true,
      transcriptSource: true,
      organizationId: true,
      body: true,
    },
  });
  if (acts.length === 0) {
    console.log("No meeting activity with link fragment:", needle);
    return;
  }
  for (const a of acts) {
    const session = await prisma.meetingAssistSession.findUnique({
      where: { activityId: a.id },
      select: {
        id: true,
        hostUserId: true,
        organizationId: true,
        meta: true,
        status: true,
      },
    });
    const cap = session ? readCaptureBotMeta(session.meta) : null;
    console.log("\n---");
    console.log({
      activityId: a.id,
      subject: a.subject,
      dueAt: a.dueAt?.toISOString(),
      link: parseMeetingLinkFromBody(a.body),
      transcriptChars: a.transcriptText?.length ?? 0,
      transcriptSource: a.transcriptSource,
      captureBot: cap,
    });
    if (
      cap?.botId &&
      cap.provider === "vexa" &&
      session?.hostUserId &&
      isMeetingServiceConfigured()
    ) {
      const org = String(session.organizationId);
      const user = String(session.hostUserId);
      const remote = await getMeetingServiceMeeting({
        organizationId: org,
        userId: user,
        meetingId: cap.botId,
      });
      console.log("meeting-service GET:", remote.ok ? remote.meeting : remote.error);
      if (remote.ok) {
        console.log("mapped CRM status:", mapMeetingServiceStatus(remote.meeting.status));
        const tr = await fetchMeetingServiceTranscript({
          organizationId: org,
          userId: user,
          meetingId: cap.botId,
        });
        console.log(
          "transcript pull:",
          tr.ok ? `${tr.text.length} chars, ${tr.segments.length} segments` : tr.error,
        );
        if (tr.ok && tr.text.trim()) {
          console.log("preview:", tr.text.slice(0, 300));
        }
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
