import { prisma } from "../src/dao/db/prisma.js";

const dealId = process.argv[2] || "cmt418888003u1acurh3mw7f3";

async function main() {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      title: true,
      ownerUserId: true,
      contactId: true,
      stage: true,
    },
  });
  console.log("DEAL", deal);

  if (!deal?.contactId) return;

  const activities = await prisma.contactActivity.findMany({
    where: { contactId: deal.contactId, type: "meeting" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      id: true,
      subject: true,
      createdByUserId: true,
      transcriptText: true,
      transcriptSource: true,
    },
  });

  for (const a of activities) {
    console.log(
      "ACTIVITY",
      a.id,
      a.subject,
      "createdBy",
      a.createdByUserId?.toString(),
      "source",
      a.transcriptSource,
    );
    console.log("TRANSCRIPT_HEAD", a.transcriptText?.slice(0, 500));

    const chunks = await prisma.meetingTranscriptChunk.findMany({
      where: { activityId: a.id },
      take: 8,
      orderBy: { seq: "asc" },
      select: {
        speaker: true,
        speakerEmail: true,
        source: true,
        text: true,
      },
    });
    console.log("CHUNKS", JSON.stringify(chunks, null, 2));

    const session = await prisma.meetingAssistSession.findFirst({
      where: { activityId: a.id },
      select: { id: true, hostUserId: true, meta: true },
    });
    console.log("SESSION", session);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
