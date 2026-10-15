import type { CalendarMeetCaptureStatus } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";

export type CalendarMeetCaptureRow = {
  id: string;
  organizationId: string;
  userId: string;
  googleEventId: string;
  meetUrl: string | null;
  meetCode: string | null;
  summary: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: CalendarMeetCaptureStatus;
  contactId: string | null;
  activityId: string | null;
  meetingServiceId: string | null;
  lastError: string | null;
};

function mapRow(row: {
  id: string;
  organizationId: bigint;
  userId: bigint;
  googleEventId: string;
  meetUrl: string | null;
  meetCode: string | null;
  summary: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: CalendarMeetCaptureStatus;
  contactId: string | null;
  activityId: string | null;
  meetingServiceId: string | null;
  lastError: string | null;
}): CalendarMeetCaptureRow {
  return {
    id: row.id,
    organizationId: row.organizationId.toString(),
    userId: row.userId.toString(),
    googleEventId: row.googleEventId,
    meetUrl: row.meetUrl,
    meetCode: row.meetCode,
    summary: row.summary,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    contactId: row.contactId,
    activityId: row.activityId,
    meetingServiceId: row.meetingServiceId,
    lastError: row.lastError,
  };
}

export async function findCalendarMeetCapture(
  userId: string,
  googleEventId: string,
): Promise<CalendarMeetCaptureRow | null> {
  const row = await prisma.calendarMeetCapture.findUnique({
    where: {
      userId_googleEventId: {
        userId: BigInt(userId),
        googleEventId,
      },
    },
  });
  return row ? mapRow(row) : null;
}

export async function findActiveCaptureByMeetCode(input: {
  organizationId: string;
  meetCode: string;
  excludeId?: string;
}): Promise<CalendarMeetCaptureRow | null> {
  const code = input.meetCode.trim().toLowerCase();
  if (!code) return null;
  const row = await prisma.calendarMeetCapture.findFirst({
    where: {
      organizationId: BigInt(input.organizationId),
      meetCode: code,
      status: { in: ["pending", "dispatched"] },
      meetingServiceId: { not: null },
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  return row ? mapRow(row) : null;
}

export async function upsertCalendarMeetCapture(input: {
  organizationId: string;
  userId: string;
  googleEventId: string;
  meetUrl?: string | null;
  meetCode?: string | null;
  summary?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  status?: CalendarMeetCaptureStatus;
  contactId?: string | null;
  activityId?: string | null;
  meetingServiceId?: string | null;
  lastError?: string | null;
}): Promise<CalendarMeetCaptureRow> {
  const userId = BigInt(input.userId);
  const organizationId = BigInt(input.organizationId);
  const row = await prisma.calendarMeetCapture.upsert({
    where: {
      userId_googleEventId: {
        userId,
        googleEventId: input.googleEventId,
      },
    },
    create: {
      organizationId,
      userId,
      googleEventId: input.googleEventId,
      meetUrl: input.meetUrl ?? null,
      meetCode: input.meetCode?.toLowerCase() ?? null,
      summary: input.summary ?? null,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      status: input.status ?? "pending",
      contactId: input.contactId ?? null,
      activityId: input.activityId ?? null,
      meetingServiceId: input.meetingServiceId ?? null,
      lastError: input.lastError ?? null,
    },
    update: {
      meetUrl: input.meetUrl ?? undefined,
      meetCode: input.meetCode?.toLowerCase() ?? undefined,
      summary: input.summary ?? undefined,
      startAt: input.startAt ?? undefined,
      endAt: input.endAt ?? undefined,
      status: input.status ?? undefined,
      contactId: input.contactId ?? undefined,
      activityId: input.activityId ?? undefined,
      meetingServiceId: input.meetingServiceId ?? undefined,
      lastError: input.lastError === undefined ? undefined : input.lastError,
    },
  });
  return mapRow(row);
}
