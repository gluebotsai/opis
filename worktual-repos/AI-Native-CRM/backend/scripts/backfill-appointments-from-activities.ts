/**
 * Backfill crm.appointments from legacy future meeting contact_activities.
 *
 * Usage:
 *   npx tsx backend/scripts/backfill-appointments-from-activities.ts [--dry-run]
 */

import { prisma } from "../src/dao/db/prisma.js";
import {
  parseGoogleEventIdFromMeetingBody,
  parseGcalProviderMessageId,
  parseGuestsFromMeetingBody,
  parseMeetingLinkFromBody,
  parseProviderFromMeetingBody,
} from "../src/lib/meeting-body.js";

const dryRun = process.argv.includes("--dry-run");

function meetingProviderToDb(
  provider: ReturnType<typeof parseProviderFromMeetingBody>,
): "google_meet" | "zoom" | "teams" | "other" {
  if (provider === "zoom") return "zoom";
  if (provider === "teams") return "teams";
  if (provider === "google_meet") return "google_meet";
  return "other";
}

async function main() {
  const now = new Date();
  const rows = await prisma.contactActivity.findMany({
    where: {
      type: "meeting",
      completedAt: null,
      missEscalatedAt: null,
      dueAt: { gt: now },
    },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      organizationId: true,
      contactId: true,
      subject: true,
      body: true,
      dueAt: true,
      createdByUserId: true,
      providerMessageId: true,
    },
  });

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const existing = await prisma.appointment.findFirst({
      where: { activityId: row.id },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const live = await prisma.appointment.findFirst({
      where: {
        organizationId: row.organizationId,
        contactId: row.contactId,
        status: "scheduled",
      },
    });
    if (live) {
      skipped += 1;
      continue;
    }

    if (!row.dueAt || !row.createdByUserId) {
      skipped += 1;
      continue;
    }

    const provider = meetingProviderToDb(parseProviderFromMeetingBody(row.body));
    const googleEventId =
      parseGoogleEventIdFromMeetingBody(row.body) ||
      parseGcalProviderMessageId(row.providerMessageId);
    const joinUrl = parseMeetingLinkFromBody(row.body);
    const guestEmails = parseGuestsFromMeetingBody(row.body);
    const endsAt = new Date(row.dueAt.getTime() + 30 * 60_000);

    if (dryRun) {
      console.log("[dry-run] would create appointment", {
        activityId: row.id,
        contactId: row.contactId,
        organizationId: String(row.organizationId),
        subject: row.subject,
        dueAt: row.dueAt.toISOString(),
      });
      created += 1;
      continue;
    }

    await prisma.appointment.create({
      data: {
        organizationId: row.organizationId,
        contactId: row.contactId,
        hostUserId: row.createdByUserId,
        activityId: row.id,
        source: "crm_ui",
        status: "scheduled",
        title: row.subject,
        startsAt: row.dueAt,
        endsAt,
        timezone: "UTC",
        provider,
        joinUrl,
        calendarEventId: googleEventId,
        guestEmails,
      },
    });
    created += 1;
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scanned: rows.length,
        created,
        skipped,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
