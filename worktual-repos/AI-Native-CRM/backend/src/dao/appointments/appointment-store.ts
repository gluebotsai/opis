import type {
  AppointmentSource,
  AppointmentStatus,
  MeetingAssistProvider,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/dao/db/prisma";

export type AppointmentView = {
  id: string;
  organizationId: string;
  contactId: string;
  hostUserId: string;
  activityId: string | null;
  source: AppointmentSource;
  status: AppointmentStatus;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  provider: MeetingAssistProvider;
  joinUrl: string | null;
  calendarEventId: string | null;
  guestEmails: string[];
  assignmentReason: string | null;
  canceledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function guestEmailsFromJson(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function toView(row: {
  id: string;
  organizationId: bigint;
  contactId: string;
  hostUserId: bigint;
  activityId: string | null;
  source: AppointmentSource;
  status: AppointmentStatus;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  provider: MeetingAssistProvider;
  joinUrl: string | null;
  calendarEventId: string | null;
  guestEmails: Prisma.JsonValue;
  assignmentReason: string | null;
  canceledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AppointmentView {
  return {
    id: row.id,
    organizationId: String(row.organizationId),
    contactId: row.contactId,
    hostUserId: String(row.hostUserId),
    activityId: row.activityId,
    source: row.source,
    status: row.status,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: row.timezone,
    provider: row.provider,
    joinUrl: row.joinUrl,
    calendarEventId: row.calendarEventId,
    guestEmails: guestEmailsFromJson(row.guestEmails),
    assignmentReason: row.assignmentReason,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

let appointmentsTableReady: boolean | null = null;

/** False until `crm.appointments` migration is applied — lets legacy meeting flows continue. */
export async function isAppointmentsTableReady(): Promise<boolean> {
  if (appointmentsTableReady !== null) return appointmentsTableReady;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'crm' AND table_name = 'appointments') AS exists",
    );
    appointmentsTableReady = Boolean(rows[0]?.exists);
  } catch (err) {
    console.error("appointments table probe failed", err);
    appointmentsTableReady = false;
  }
  return appointmentsTableReady;
}

/** Scheduled future booking for this contact (appointments SoR). */
export async function findLiveAppointmentForContact(
  organizationId: string,
  contactId: string,
): Promise<AppointmentView | null> {
  if (!(await isAppointmentsTableReady())) return null;
  const now = new Date();
  const row = await prisma.appointment.findFirst({
    where: {
      organizationId: BigInt(organizationId),
      contactId,
      status: "scheduled",
      startsAt: { gt: now },
    },
    orderBy: { startsAt: "asc" },
  });
  return row ? toView(row) : null;
}

export async function findAppointmentById(
  organizationId: string,
  appointmentId: string,
): Promise<AppointmentView | null> {
  if (!(await isAppointmentsTableReady())) return null;
  const row = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      organizationId: BigInt(organizationId),
    },
  });
  return row ? toView(row) : null;
}

export async function findLiveAppointmentById(
  organizationId: string,
  appointmentId: string,
): Promise<AppointmentView | null> {
  if (!(await isAppointmentsTableReady())) return null;
  const now = new Date();
  const row = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      organizationId: BigInt(organizationId),
      status: "scheduled",
      startsAt: { gt: now },
    },
  });
  return row ? toView(row) : null;
}

export async function createAppointment(input: {
  organizationId: string;
  contactId: string;
  hostUserId: string;
  activityId?: string | null;
  source: AppointmentSource;
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  provider?: MeetingAssistProvider;
  joinUrl?: string | null;
  calendarEventId?: string | null;
  guestEmails?: string[];
  assignmentReason?: string | null;
}): Promise<AppointmentView> {
  if (!(await isAppointmentsTableReady())) {
    throw new Error("crm.appointments is not migrated yet.");
  }
  const row = await prisma.appointment.create({
    data: {
      organizationId: BigInt(input.organizationId),
      contactId: input.contactId,
      hostUserId: BigInt(input.hostUserId),
      activityId: input.activityId ?? null,
      source: input.source,
      status: "scheduled",
      title: input.title.trim(),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone.trim(),
      provider: input.provider ?? "google_meet",
      joinUrl: input.joinUrl ?? null,
      calendarEventId: input.calendarEventId ?? null,
      guestEmails: input.guestEmails ?? [],
      assignmentReason: input.assignmentReason ?? null,
    },
  });
  return toView(row);
}

export async function linkAppointmentActivity(
  appointmentId: string,
  activityId: string,
): Promise<AppointmentView> {
  const row = await prisma.appointment.update({
    where: { id: appointmentId },
    data: { activityId },
  });
  return toView(row);
}

export async function updateAppointmentSchedule(
  appointmentId: string,
  input: {
    title?: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    joinUrl?: string | null;
    calendarEventId?: string | null;
    guestEmails?: string[];
  },
): Promise<AppointmentView> {
  const row = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone.trim(),
      ...(input.joinUrl !== undefined ? { joinUrl: input.joinUrl } : {}),
      ...(input.calendarEventId !== undefined
        ? { calendarEventId: input.calendarEventId }
        : {}),
      ...(input.guestEmails !== undefined
        ? { guestEmails: input.guestEmails }
        : {}),
    },
  });
  return toView(row);
}

export async function cancelAppointment(
  appointmentId: string,
): Promise<AppointmentView> {
  const now = new Date();
  const row = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: "canceled",
      canceledAt: now,
    },
  });
  return toView(row);
}

export async function completeAppointment(
  appointmentId: string,
): Promise<AppointmentView> {
  const now = new Date();
  const row = await prisma.appointment.update({
    where: { id: appointmentId },
    data: {
      status: "completed",
      completedAt: now,
    },
  });
  return toView(row);
}

export function isAppointmentExistsError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
