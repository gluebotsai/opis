import { prisma } from "../src/dao/db/prisma.js";
import { isMeetingBotConfigured } from "../src/service/meeting-assist/meeting-bot.js";
import { readCaptureBotMeta } from "../src/service/transcripts/meeting-capture.js";
import { parseMeetingLinkFromBody } from "../src/lib/meeting-body.js";

const contactId = process.argv[2] || "723c9f6a-4b90-4221-9411-3d17835144e0";

async function main() {
  console.log("MEETING_BOT configured:", isMeetingBotConfigured());
  console.log(
    "CAPTURE enabled:",
    (process.env.MEETING_CAPTURE_BOT_ENABLED || "true").trim(),
  );
  console.log(
    "WEBHOOK base:",
    process.env.MEETING_BOT_WEBHOOK_BASE_URL?.trim() || "(unset)",
  );
  console.log(
    "Recall region:",
    process.env.MEETING_BOT_API_BASE_URL?.trim() || "(default us-east-1)",
  );

  const count = await prisma.contactActivity.count({
    where: { contactId, type: "meeting" },
  });
  console.log("meeting count for contact:", count);

  const meetings = await prisma.contactActivity.findMany({
    where: { contactId, type: "meeting" },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      id: true,
      subject: true,
      dueAt: true,
      completedAt: true,
      providerMessageId: true,
      body: true,
      updatedAt: true,
    },
  });

  for (const m of meetings) {
    const session = await prisma.meetingAssistSession.findUnique({
      where: { activityId: m.id },
      select: { id: true, joinUrl: true, status: true, meta: true },
    });
    const capture = session ? readCaptureBotMeta(session.meta) : null;
    console.log(
      JSON.stringify(
        {
          activityId: m.id,
          subject: m.subject,
          dueAt: m.dueAt?.toISOString() ?? null,
          completedAt: m.completedAt?.toISOString() ?? null,
          updatedAt: m.updatedAt.toISOString(),
          meetLink: parseMeetingLinkFromBody(m.body),
          providerMessageId: m.providerMessageId,
          session: session
            ? {
                id: session.id,
                status: session.status,
                joinUrl: session.joinUrl,
                captureBot: capture,
              }
            : null,
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
