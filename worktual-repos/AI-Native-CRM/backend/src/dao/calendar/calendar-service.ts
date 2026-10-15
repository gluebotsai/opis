import { prisma } from "@/dao/db/prisma";
import { isAppointmentsTableReady } from "@/dao/appointments/appointment-store";
import { applySameDayRescheduleDisplay } from "@/lib/calendar-reschedule-display";
import {
  isMeetingMarkedRescheduled,
  parseMeetingLinkFromBody,
  parsePreviousDueAtFromMeetingBody,
} from "@/lib/meeting-body";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import { resolveRecordOwnerScope } from "@/service/auth/ownership-scope";
import { canViewAllRecords } from "@/service/auth/rbac";

export type CalendarEventSource = "crm";

export type UnifiedCalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  source: CalendarEventSource;
  sources: CalendarEventSource[];
  meetLink: string | null;
  htmlLink: string | null;
  contactId: string | null;
  contactName: string | null;
  location: string | null;
  rescheduled: boolean;
  superseded: boolean;
  previousStartAt: string | null;
};

export type CalendarOwnerScope = "mine" | "all";

function startMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function extractMeetLink(text: string | null | undefined): string | null {
  return parseMeetingLinkFromBody(text);
}

/**
 * CRM meetings for the calendar grid.
 * Shows booked meetings in the visible range (including past/completed).
 * Canceled appointments are omitted. Managers/admins may request `all`.
 */
export async function listUnifiedCalendarEvents(input: {
  userId: string | null;
  timeMin: Date;
  timeMax: Date;
  ownerScope?: CalendarOwnerScope;
}): Promise<{
  events: UnifiedCalendarEvent[];
  googleConnected: boolean;
  googleEmail: string | null;
  googleError: string | null;
  ownerScope: CalendarOwnerScope;
  canViewTeam: boolean;
}> {
  const scope = await resolveRecordOwnerScope();
  const canViewTeam = canViewAllRecords(scope.role);
  const requested = input.ownerScope ?? "mine";
  const ownerScope: CalendarOwnerScope =
    requested === "all" && canViewTeam ? "all" : "mine";

  const organizationId = BigInt(await getCurrentOrganizationId());

  const actorId = input.userId ?? scope.userId;
  const ownedIds =
    ownerScope === "mine" && actorId
      ? await prisma.contactProfile.findMany({
          where: { ownerUserId: actorId, status: { not: "archived" } },
          take: 2000,
          select: { accountContactId: true },
        })
      : [];
  const ownedContactIds = ownedIds.map((r) => r.accountContactId);

  const ownerFilter =
    ownerScope === "mine" && actorId
      ? {
          OR: [
            { createdByUserId: actorId },
            { assigneeUserId: actorId },
            ...(ownedContactIds.length
              ? [{ contactId: { in: ownedContactIds } }]
              : []),
          ],
        }
      : {};

  const appointmentOwnerFilter =
    ownerScope === "mine" && actorId
      ? {
          OR: [
            { hostUserId: BigInt(actorId) },
            ...(ownedContactIds.length
              ? [{ contactId: { in: ownedContactIds } }]
              : []),
          ],
        }
      : {};

  const canceledActivityIds = new Set<string>();
  const tableReady = await isAppointmentsTableReady();
  if (tableReady) {
    const canceled = await prisma.appointment.findMany({
      where: {
        organizationId,
        status: "canceled",
        startsAt: { gte: input.timeMin, lt: input.timeMax },
        activityId: { not: null },
      },
      select: { activityId: true },
    });
    for (const row of canceled) {
      if (row.activityId) canceledActivityIds.add(row.activityId);
    }
  }

  const rows = await prisma.contactActivity.findMany({
    where: {
      organizationId,
      dueAt: { gte: input.timeMin, lt: input.timeMax },
      AND: [
        ownerFilter,
        {
          OR: [
            // Superseded (completed) meetings stay out — strike-off is the
            // `:previous` ghost synthesized from Rescheduled / Previous DueAt.
            { type: "meeting", completedAt: null },
            { type: "task", taskStatus: { not: "completed" } },
          ],
        },
      ],
    },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      contactId: true,
      type: true,
      subject: true,
      body: true,
      dueAt: true,
    },
  });

  const withDue = rows.filter(
    (r) => r.dueAt != null && !canceledActivityIds.has(r.id),
  );
  const activityIds = new Set(withDue.map((r) => r.id));

  const appointmentRows = tableReady
    ? await prisma.appointment.findMany({
        where: {
          organizationId,
          status: { in: ["scheduled", "completed"] },
          startsAt: { gte: input.timeMin, lt: input.timeMax },
          ...(Object.keys(appointmentOwnerFilter).length
            ? appointmentOwnerFilter
            : {}),
        },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          activityId: true,
          contactId: true,
          title: true,
          startsAt: true,
          endsAt: true,
          joinUrl: true,
          calendarEventId: true,
        },
      })
    : [];

  const unmatchedAppointments = appointmentRows.filter(
    (a) => !a.activityId || !activityIds.has(a.activityId),
  );

  const contactIds = [
    ...new Set([
      ...withDue.map((r) => r.contactId),
      ...unmatchedAppointments.map((a) => a.contactId),
    ]),
  ];

  const byId = new Map<string, string | null>();
  if (contactIds.length > 0) {
    const { getPeopleByIds } = await import("@/dao/account/account-repository");
    const people = await getPeopleByIds(contactIds);
    for (const p of people) {
      byId.set(p.id, `${p.firstName} ${p.lastName}`.trim() || null);
    }
  }

  const events: UnifiedCalendarEvent[] = [];

  for (const r of withDue) {
    const dueAt = r.dueAt!;
    const isTask = r.type === "task";
    const previousDue = isTask ? null : parsePreviousDueAtFromMeetingBody(r.body);
    const rescheduled =
      !isTask &&
      (isMeetingMarkedRescheduled(r.body) || previousDue != null);
    const base = {
      title: isTask
        ? r.subject
        : r.subject.replace(/^Meeting:\s*/i, "").trim() || r.subject,
      description: r.body,
      allDay: false,
      source: "crm" as const,
      sources: ["crm" as const],
      meetLink: isTask ? null : extractMeetLink(r.body),
      htmlLink: null,
      contactId: r.contactId,
      contactName: byId.get(r.contactId) ?? null,
      location: null,
    };
    events.push({
      ...base,
      id: `crm:${r.id}`,
      startAt: dueAt.toISOString(),
      endAt: new Date(dueAt.getTime() + 30 * 60_000).toISOString(),
      rescheduled,
      superseded: false,
      previousStartAt: previousDue ? previousDue.toISOString() : null,
    });
    if (
      previousDue &&
      previousDue.getTime() >= input.timeMin.getTime() &&
      previousDue.getTime() < input.timeMax.getTime() &&
      Math.abs(previousDue.getTime() - dueAt.getTime()) > 60_000
    ) {
      events.push({
        ...base,
        id: `crm:${r.id}:previous`,
        startAt: previousDue.toISOString(),
        endAt: new Date(previousDue.getTime() + 30 * 60_000).toISOString(),
        meetLink: null,
        rescheduled: false,
        superseded: true,
        previousStartAt: null,
      });
    }
  }

  for (const a of unmatchedAppointments) {
    events.push({
      id: `appt:${a.id}`,
      title: a.title.trim() || "Meeting",
      description: null,
      startAt: a.startsAt.toISOString(),
      endAt: a.endsAt.toISOString(),
      allDay: false,
      source: "crm",
      sources: ["crm"],
      meetLink: a.joinUrl,
      htmlLink: a.calendarEventId
        ? `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(a.calendarEventId)}`
        : null,
      contactId: a.contactId,
      contactName: byId.get(a.contactId) ?? null,
      location: null,
      rescheduled: false,
      superseded: false,
      previousStartAt: null,
    });
  }

  events.sort((a, b) => startMs(a.startAt) - startMs(b.startAt));
  const displayed = applySameDayRescheduleDisplay(events);

  return {
    events: displayed,
    googleConnected: false,
    googleEmail: null,
    googleError: null,
    ownerScope,
    canViewTeam,
  };
}
