import { prisma } from "../src/dao/db/prisma.js";
import { getContact } from "../src/dao/contacts/contact-service.js";
import { readCaptureBotMeta } from "../src/service/transcripts/meeting-capture.js";
import { parseMeetingLinkFromBody } from "../src/lib/meeting-body.js";

const contactId = process.argv[2] || "723c9f6a-4b90-4221-9411-3d17835144e0";

async function main() {
  const contact = await getContact(contactId);
  if (!contact) {
    console.log(JSON.stringify({ error: "contact not found", contactId }));
    return;
  }

  const profile = await prisma.contactProfile.findUnique({
    where: { accountContactId: contactId },
    select: {
      ownerUserId: true,
      status: true,
      lifecycleLastAction: true,
      lifecycleLastReason: true,
      nurtureStatus: true,
      nurtureSequenceStep: true,
      nurtureLastTouchAt: true,
      flaggedForReview: true,
      flagReason: true,
      createdAt: true,
    },
  });

  const activities = await prisma.contactActivity.findMany({
    where: { contactId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      subject: true,
      body: true,
      folder: true,
      dueAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      providerMessageId: true,
      threadId: true,
      createdByUserId: true,
    },
  });

  const autoReplyJobs = await prisma.emailAutoReplyJob.findMany({
    where: { contactId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      nextRetryAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      inboundActivityId: true,
    },
  });

  const sessions = await prisma.meetingAssistSession.findMany({
    where: { contactId },
    select: {
      id: true,
      activityId: true,
      joinUrl: true,
      status: true,
      meta: true,
      startedAt: true,
    },
  });

  const out = {
    contact: {
      id: contactId,
      displayName: contact.displayName,
      email: contact.person.email,
      contactType: contact.person.contactType,
      leadStatus: contact.person.leadStatus,
      company: contact.person.company?.name ?? null,
      companyId: contact.person.companyId,
      createdAt: contact.person.createdAt.toISOString(),
      crmOwnerUserId: contact.crm.ownerUserId,
      profile,
    },
    activityCount: activities.length,
    activities: activities.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject?.slice(0, 120) ?? null,
      folder: a.folder,
      dueAt: a.dueAt?.toISOString() ?? null,
      completedAt: a.completedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      threadId: a.threadId,
      providerMessageId: a.providerMessageId,
      meetLink:
        a.type === "meeting" ? parseMeetingLinkFromBody(a.body) : null,
      bodyPreview:
        a.type === "email"
          ? (a.body || "").replace(/\s+/g, " ").slice(0, 160)
          : a.type === "meeting"
            ? (a.body || "").split("\n").slice(0, 8).join(" | ")
            : (a.body || "").slice(0, 120),
    })),
    autoReplyJobs,
    meetingSessions: sessions.map((s) => ({
      activityId: s.activityId,
      joinUrl: s.joinUrl,
      status: s.status,
      captureBot: readCaptureBotMeta(s.meta),
    })),
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
