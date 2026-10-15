/**
 * Verify appointments layer against remote DB (no local assumptions).
 * Run: npx tsx backend/scripts/verify-appointments-remote.ts
 */
import { prisma } from "../src/dao/db/prisma.js";
import {
  findLiveAppointmentForContact,
  isAppointmentsTableReady,
} from "../src/dao/appointments/appointment-store.js";
import {
  resolveUpcomingMeetingForContact,
  syncAppointmentForMeetingActivity,
} from "../src/service/appointments/appointment-service.js";

async function main() {
  const ready = await isAppointmentsTableReady();
  console.log("isAppointmentsTableReady:", ready);
  if (!ready) {
    process.exitCode = 1;
    return;
  }

  const count = await prisma.appointment.count();
  console.log("appointment rows:", count);

  const sampleMeeting = await prisma.contactActivity.findFirst({
    where: {
      type: "meeting",
      completedAt: null,
      dueAt: { gt: new Date() },
    },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      contactId: true,
      organizationId: true,
      subject: true,
      dueAt: true,
      createdByUserId: true,
      body: true,
      providerMessageId: true,
    },
  });

  if (!sampleMeeting?.dueAt || !sampleMeeting.createdByUserId) {
    console.log("no future open meeting activities to exercise sync — table OK, nothing to backfill");
    return;
  }

  const orgId = String(sampleMeeting.organizationId);
  console.log("sample meeting activity:", sampleMeeting.id, "contact:", sampleMeeting.contactId);

  const beforeLive = await findLiveAppointmentForContact(orgId, sampleMeeting.contactId);
  console.log("live appointment before sync:", beforeLive?.id ?? null);

  const resolved = await resolveUpcomingMeetingForContact(orgId, sampleMeeting.contactId);
  console.log(
    "resolveUpcomingMeetingForContact:",
    resolved?.id ?? null,
    resolved?.id === sampleMeeting.id ? "(matches activity)" : "(mismatch)",
  );

  if (!beforeLive) {
    const endsAt = new Date(sampleMeeting.dueAt.getTime() + 30 * 60_000);
    const synced = await syncAppointmentForMeetingActivity({
      organizationId: orgId,
      contactId: sampleMeeting.contactId,
      hostUserId: String(sampleMeeting.createdByUserId),
      activityId: sampleMeeting.id,
      source: "crm_ui",
      title: sampleMeeting.subject,
      startsAt: sampleMeeting.dueAt,
      endsAt,
      timezone: "UTC",
      provider: "google_meet",
      isReschedule: false,
    });
    console.log("syncAppointmentForMeetingActivity:", synced?.id ?? null);
  }

  const afterLive = await findLiveAppointmentForContact(orgId, sampleMeeting.contactId);
  console.log("live appointment after:", afterLive?.id ?? null, "activityId:", afterLive?.activityId ?? null);

  const resolvedAfter = await resolveUpcomingMeetingForContact(orgId, sampleMeeting.contactId);
  console.log(
    "resolveUpcoming after sync:",
    resolvedAfter?.id ?? null,
    resolvedAfter?.id === sampleMeeting.id ? "(still resolves via appointment link)" : "",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
