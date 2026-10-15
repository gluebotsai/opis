import {
  deriveActivityStatus,
  listUserActivities,
} from "@/dao/activities/activity-feed-service";
import { prisma } from "@/dao/db/prisma";
import { isAppointmentsTableReady } from "@/dao/appointments/appointment-store";
import { listInvoices } from "@/dao/finance/invoice-service";
import {
  findContactIdsByContactType,
  getPeopleByIds,
} from "@/dao/account/account-repository";
import { formatContactDisplayName } from "@/lib/contact-name";
import type { AppRole } from "@/service/auth/rbac";

/** Bump when spoken context/prompt changes so unplayed rows regenerate. */
export const DAILY_BRIEFING_CONTEXT_VERSION = 11;

export const DAILY_BRIEFING_ROLES: readonly AppRole[] = [
  "admin",
  "sales_manager",
  "sales_rep",
  "finance",
];

export function isDailyBriefingRole(role: AppRole): boolean {
  return (DAILY_BRIEFING_ROLES as readonly string[]).includes(role);
}

/** IST has no DST — prefer fixed UTC+5:30 so Docker images without tzdata stay correct. */
function istWallClock(now = new Date()): Date {
  return new Date(now.getTime() + (5 * 60 + 30) * 60_000);
}

export function istCalendarDate(now = new Date()): string {
  const ist = istWallClock(now);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function istHour(now = new Date()): number {
  return istWallClock(now).getUTCHours();
}

export function greetingBandForHour(
  hour: number,
): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export function greetingForIstHour(hour: number, firstName: string): string {
  const name = firstName.trim() || "there";
  const band = greetingBandForHour(hour);
  if (band === "morning") return `Good morning, ${name}.`;
  if (band === "afternoon") return `Good afternoon, ${name}.`;
  return `Good evening, ${name}.`;
}

/** Keep the spoken greeting aligned with the listener's current IST hour. */
export function withCurrentGreeting(
  script: string,
  firstName: string,
  hour: number,
): string {
  const band = greetingBandForHour(hour);
  let body = String(script || "")
    .replace(/^Good (morning|afternoon|evening),\s+[^.\n]+\.\s*/i, "")
    .trim();
  // Drop LLM closers that name a different part of day than the greeting.
  body = body
    .split(/\n+/)
    .filter((line) => {
      const m = line.match(/\b(morning|afternoon|evening)\b/i);
      if (!m) return true;
      if (!/have a|smooth|good (morning|afternoon|evening)/i.test(line)) {
        return true;
      }
      return m[1]!.toLowerCase() === band;
    })
    .join("\n")
    .trim();
  const greeting = greetingForIstHour(hour, firstName);
  if (!body) return greeting;
  return `${greeting}\n${body}`.replace(/\n{3,}/g, "\n").trim();
}

function formatIstClock(due: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(due);
}

function istDayBounds(now = new Date()): { start: Date; end: Date; date: string } {
  const date = istCalendarDate(now);
  return {
    date,
    start: new Date(`${date}T00:00:00+05:30`),
    end: new Date(`${date}T23:59:59.999+05:30`),
  };
}

export type DailyBriefingItem = {
  id: string;
  kind: "meeting" | "task" | "follow_up" | "invoice";
  title: string;
  contactName?: string;
  companyName?: string;
  when?: string;
};

export type DailyBriefingPulse = {
  openDeals: number;
  untouchedLeads: number;
  needsReview: number;
  overdueInvoices: number;
  meetingsToday: number;
  overdueTasks: number;
};

export type DailyBriefingContext = {
  role: AppRole;
  firstName: string;
  hourIst: number;
  briefingDate: string;
  meetings: Array<{
    id: string;
    title: string;
    contactName: string;
    when: string;
  }>;
  tasks: Array<{
    id: string;
    subject: string;
    contactName: string;
    overdue: boolean;
  }>;
  followUps: Array<{
    id: string;
    subject: string;
    contactName: string;
  }>;
  invoices: Array<{ id: string; number: string; companyName: string }>;
  pulse: DailyBriefingPulse;
  items: DailyBriefingItem[];
  storedItems: {
    version: number;
    pulse: DailyBriefingPulse;
    refs: DailyBriefingItem[];
  };
};

export async function loadDailyBriefingContext(input: {
  userId: string;
  role: AppRole;
  organizationId: string;
  firstName: string;
}): Promise<DailyBriefingContext> {
  const now = new Date();
  const { start, end, date } = istDayBounds(now);
  const hourIst = istHour(now);

  const [activities, appointments] = await Promise.all([
    listUserActivities({ userId: input.userId, page: 1, pageSize: 80 }),
    loadTodayAppointments({
      organizationId: input.organizationId,
      userId: input.userId,
      start,
      end,
    }),
  ]);

  const meetings: DailyBriefingContext["meetings"] = [];
  const tasks: DailyBriefingContext["tasks"] = [];
  const followUps: DailyBriefingContext["followUps"] = [];
  const items: DailyBriefingItem[] = [];

  for (const appt of appointments) {
    const when = formatIstClock(new Date(appt.startsAt));
    meetings.push({
      id: appt.id,
      title: appt.title,
      contactName: appt.contactName,
      when,
    });
    items.push({
      id: appt.id,
      kind: "meeting",
      title: appt.title,
      contactName: appt.contactName,
      when,
    });
  }

  for (const row of activities.items) {
    const due = row.dueAt ? new Date(row.dueAt) : null;
    const status = deriveActivityStatus(due, now, {
      type: row.type,
      taskStatus: row.taskStatus,
    });
    const dueToday = due != null && due >= start && due <= end;
    const overdue = status === "overdue";
    const when = due ? formatIstClock(due) : "";

    if (row.type === "meeting" && dueToday) {
      if (meetings.some((m) => m.id === row.id)) continue;
      meetings.push({
        id: row.id,
        title: row.subject,
        contactName: row.contactName,
        when,
      });
      items.push({
        id: row.id,
        kind: "meeting",
        title: row.subject,
        contactName: row.contactName,
        when,
      });
      continue;
    }

    if (row.type === "task" && row.taskStatus !== "completed" && (dueToday || overdue)) {
      tasks.push({
        id: row.id,
        subject: row.subject,
        contactName: row.contactName,
        overdue,
      });
      items.push({
        id: row.id,
        kind: "task",
        title: row.subject,
        contactName: row.contactName,
      });
      continue;
    }

    if (
      (row.type === "call" || row.type === "sms") &&
      (dueToday || overdue)
    ) {
      followUps.push({
        id: row.id,
        subject: row.subject,
        contactName: row.contactName,
      });
      items.push({
        id: row.id,
        kind: "follow_up",
        title: row.subject,
        contactName: row.contactName,
      });
    }
  }

  const invoices: DailyBriefingContext["invoices"] = [];
  const includeOrgInvoices =
    input.role === "finance" ||
    input.role === "admin" ||
    input.role === "sales_manager";
  if (includeOrgInvoices) {
    const listed = await listInvoices({
      page: 1,
      pageSize: 20,
      status: "overdue",
      organizationId: input.organizationId,
    });
    for (const inv of listed.items) {
      invoices.push({
        id: inv.id,
        number: inv.number,
        companyName: inv.company?.name ?? "a customer",
      });
      items.push({
        id: inv.id,
        kind: "invoice",
        title: inv.number,
        companyName: inv.company?.name ?? undefined,
      });
    }
  }

  const pulse = await loadPulse({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
    start,
    end,
    personalMeetingsToday: meetings.length,
    personalOverdueTasks: tasks.length,
    overdueInvoices: invoices.length,
  });

  const slicedItems = items.slice(0, 40);
  return {
    role: input.role,
    firstName: input.firstName,
    hourIst,
    briefingDate: date,
    meetings: meetings.slice(0, 16),
    tasks: tasks.slice(0, 16),
    followUps: followUps.slice(0, 16),
    invoices: invoices.slice(0, 12),
    pulse,
    items: slicedItems,
    storedItems: {
      version: DAILY_BRIEFING_CONTEXT_VERSION,
      pulse,
      refs: slicedItems,
    },
  };
}

async function loadPulse(input: {
  organizationId: string;
  userId: string;
  role: AppRole;
  start: Date;
  end: Date;
  personalMeetingsToday: number;
  personalOverdueTasks: number;
  overdueInvoices: number;
}): Promise<DailyBriefingPulse> {
  const orgScope = input.role !== "sales_rep";
  const dealWhere = {
    organizationId: input.organizationId,
    stage: { notIn: ["closed_won" as const, "closed_lost" as const] },
    ...(orgScope ? {} : { ownerUserId: input.userId }),
  };
  const reviewWhere = {
    organizationId: input.organizationId,
    flaggedForReview: true,
    status: "active",
    ...(orgScope ? {} : { ownerUserId: input.userId }),
  };

  const [openDeals, needsReview, untouchedLeads, orgMeetings, orgOverdueTasks] =
    await Promise.all([
      prisma.deal.count({ where: dealWhere }),
      prisma.contactProfile.count({ where: reviewWhere }),
      countUntouchedLeads({
        organizationId: input.organizationId,
        ownerUserId: orgScope ? null : input.userId,
      }),
      orgScope
        ? prisma.contactActivity.count({
            where: {
              organizationId: input.organizationId,
              type: "meeting",
              folder: { not: "trash" },
              dueAt: { gte: input.start, lte: input.end },
            },
          })
        : Promise.resolve(input.personalMeetingsToday),
      orgScope
        ? prisma.contactActivity.count({
            where: {
              organizationId: input.organizationId,
              type: "task",
              folder: { not: "trash" },
              taskStatus: { not: "completed" },
              dueAt: { lt: input.start },
            },
          })
        : Promise.resolve(input.personalOverdueTasks),
    ]);

  return {
    openDeals,
    untouchedLeads,
    needsReview,
    overdueInvoices: input.overdueInvoices,
    meetingsToday: orgMeetings,
    overdueTasks: orgOverdueTasks,
  };
}

async function countUntouchedLeads(input: {
  organizationId: string;
  ownerUserId: string | null;
}): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const leadIds = await findContactIdsByContactType("lead", {
    organizationId: input.organizationId,
  });
  if (leadIds.length === 0) return 0;
  return prisma.contactProfile.count({
    where: {
      organizationId: input.organizationId,
      accountContactId: { in: leadIds },
      leadStatus: { notIn: ["converted", "disqualified"] },
      updatedAt: { lt: cutoff },
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
    },
  });
}

async function loadTodayAppointments(input: {
  organizationId: string;
  userId: string;
  start: Date;
  end: Date;
}): Promise<Array<{ id: string; title: string; contactName: string; startsAt: Date }>> {
  if (!(await isAppointmentsTableReady())) return [];
  const rows = await prisma.appointment.findMany({
    where: {
      organizationId: BigInt(input.organizationId),
      hostUserId: BigInt(input.userId),
      status: "scheduled",
      startsAt: { gte: input.start, lte: input.end },
    },
    orderBy: { startsAt: "asc" },
    take: 16,
    select: { id: true, title: true, contactId: true, startsAt: true },
  });
  if (rows.length === 0) return [];
  const people = await getPeopleByIds(rows.map((r) => r.contactId));
  const names = new Map(
    people.map((p) => [
      p.id.trim().toLowerCase(),
      formatContactDisplayName(p.firstName, p.lastName) || "a contact",
    ]),
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    contactName: names.get(r.contactId.trim().toLowerCase()) ?? "a contact",
    startsAt: r.startsAt,
  }));
}
