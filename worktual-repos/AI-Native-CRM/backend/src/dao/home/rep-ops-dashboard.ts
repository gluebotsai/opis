import {
  formatContactDisplayName,
  formatContactListLabel,
  hasActionableContactIdentity,
} from "@/lib/contact-name";
import { prisma } from "@/dao/db/prisma";
import { getCurrentOrganizationId, getCurrentUserRole } from "@/service/auth/require-role";
import { listContacts } from "@/dao/contacts/contact-service";
import { listDeals } from "@/dao/sales/deal-service";
import { DEAL_STAGE_LABELS } from "@/service/sales/stages";
import { listAssignableUsers } from "@/service/account/user-directory";
import { canAssignTaskAssignee } from "@/service/auth/rbac";
import type { DealStage } from "@prisma/client";
import {
  defaultMonthMetricsBounds,
  getSalesMetricsDashboard,
  type SalesMetricsData,
} from "@/dao/home/sales-metrics-dashboard";
import {
  getRepWeeklyScorecard,
  type RepWeeklyScorecardData,
} from "@/dao/home/sales-weekly-scorecard-dashboard";

export type RepOpsData = {
  meetingsToday: Array<{
    id: string;
    subject: string;
    dueAt: string;
    contactId: string;
    contactName: string;
  }>;
  tasksToday: Array<{
    id: string;
    subject: string;
    dueAt: string;
    overdue: boolean;
    contactId: string;
    contactName: string;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    subject: string;
    createdAt: string;
    contactId: string;
    contactName: string;
  }>;
  myLeads: Array<{
    id: string;
    displayName: string;
    email: string;
    updatedAt: string;
    ageHours: number;
    untouched: boolean;
  }>;
  /** Contacts flagged by lifecycle for human input. */
  needsReview: Array<{
    id: string;
    displayName: string;
    email: string;
    reason: string | null;
  }>;
  quickActionContacts: Array<{
    id: string;
    displayName: string;
    email: string;
  }>;
  assignableUsers: Array<{ id: string; label: string }>;
  currentUserId: string;
  canAssignTaskAssignee: boolean;
  openDeals: Array<{
    id: string;
    title: string;
    stage: string;
    stageLabel: string;
    amount: string | null;
    companyName: string;
  }>;
  closedDeals: Array<{
    id: string;
    title: string;
    stage: string;
    stageLabel: string;
    amount: string | null;
    companyName: string;
    closedAt: string | null;
  }>;
  totals: {
    open: number;
    closedWon: number;
    closedLost: number;
    total: number;
  };
  /** Owner-scoped sales analytics (same formulas as manager dashboard). */
  salesMetrics: SalesMetricsData;
  /** Personal weekly quote or SQM scorecard. */
  myWeek: RepWeeklyScorecardData | null;
};

function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

async function contactNamesByIds(
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { getPeopleByIds } = await import("@/dao/account/account-repository");
  const people = await getPeopleByIds(unique);
  for (const person of people) {
    map.set(
      person.id,
      formatContactDisplayName(person.firstName, person.lastName),
    );
  }
  return map;
}

export async function getRepOpsDashboard(userId: string): Promise<RepOpsData> {
  const orgId = await getCurrentOrganizationId();
  const dayStart = startOfLocalDay();
  const dayEnd = endOfLocalDay();
  const now = new Date();

  const ownedProfiles = await prisma.contactProfile.findMany({
    where: { ownerUserId: userId, status: "active" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { accountContactId: true },
  });
  const ownedContactIds = ownedProfiles.map((r) => r.accountContactId);

  const meetingOr: Array<
    | { createdByUserId: string }
    | { assigneeUserId: string }
    | { contactId: { in: string[] } }
  > = [{ createdByUserId: userId }, { assigneeUserId: userId }];
  if (ownedContactIds.length > 0) {
    meetingOr.push({ contactId: { in: ownedContactIds } });
  }

  const [meetings, tasks, recent, leadsResult, dealsPage, stageGroups, assignable, role, salesMetrics, myWeek] =
    await Promise.all([
      prisma.contactActivity.findMany({
        where: {
          organizationId: orgId,
          type: "meeting",
          folder: { not: "trash" },
          dueAt: { gte: dayStart, lt: dayEnd },
          OR: meetingOr,
        },
        orderBy: { dueAt: "asc" },
        take: 20,
        select: {
          id: true,
          subject: true,
          dueAt: true,
          contactId: true,
          createdByUserId: true,
        },
      }),
      prisma.contactActivity.findMany({
        where: {
          organizationId: orgId,
          type: "task",
          folder: { not: "trash" },
          taskStatus: { not: "completed" },
          dueAt: { not: null, lt: dayEnd },
          OR: meetingOr,
        },
        orderBy: { dueAt: "asc" },
        take: 20,
        select: {
          id: true,
          subject: true,
          dueAt: true,
          contactId: true,
        },
      }),
      prisma.contactActivity.findMany({
        where: {
          organizationId: orgId,
          folder: { not: "trash" },
          dueAt: null,
          type: { in: ["call", "email", "sms"] },
          createdByUserId: userId,
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          type: true,
          subject: true,
          createdAt: true,
          contactId: true,
        },
      }),
      listContacts({
        page: 1,
        pageSize: 40,
        contactType: "lead",
        ownerUserId: userId,
      }),
      listDeals({ page: 1, pageSize: 50, ownerUserId: userId }),
      prisma.deal.groupBy({
        by: ["stage"],
        where: { organizationId: orgId, ownerUserId: userId },
        _count: { _all: true },
      }),
      listAssignableUsers(orgId),
      getCurrentUserRole(),
      getSalesMetricsDashboard(defaultMonthMetricsBounds(now), {
        organizationId: orgId,
        ownerUserId: userId,
      }),
      getRepWeeklyScorecard(orgId, userId),
    ]);

  const meetingRows = meetings;

  const nameIds = [
    ...meetingRows.map((m) => m.contactId),
    ...tasks.map((t) => t.contactId),
    ...recent.map((r) => r.contactId),
  ];
  const names = await contactNamesByIds(nameIds);

  const openDeals = dealsPage.items
    .filter((d) => d.stage !== "closed_won" && d.stage !== "closed_lost")
    .slice(0, 10)
    .map((d) => ({
      id: d.id,
      title: d.title,
      stage: d.stage,
      stageLabel: DEAL_STAGE_LABELS[d.stage as DealStage] ?? d.stage,
      amount: d.amount?.toString() ?? null,
      companyName: d.company.name,
    }));

  const closedDeals = dealsPage.items
    .filter((d) => d.stage === "closed_won")
    .slice(0, 10)
    .map((d) => ({
      id: d.id,
      title: d.title,
      stage: d.stage,
      stageLabel: DEAL_STAGE_LABELS[d.stage as DealStage] ?? d.stage,
      amount: d.amount?.toString() ?? null,
      companyName: d.company.name,
      closedAt: d.closedAt?.toISOString() ?? null,
    }));

  const openCount = stageGroups
    .filter((g) => g.stage !== "closed_won" && g.stage !== "closed_lost")
    .reduce((s, g) => s + g._count._all, 0);
  const closedWon =
    stageGroups.find((g) => g.stage === "closed_won")?._count._all ?? 0;
  const closedLost =
    stageGroups.find((g) => g.stage === "closed_lost")?._count._all ?? 0;

  const nowMs = now.getTime();
  const myLeads = leadsResult.items
    .map((c) => {
      const updatedAt = c.person.updatedAt;
      const ageHours = Math.max(
        0,
        Math.round((nowMs - updatedAt.getTime()) / (60 * 60 * 1000)),
      );
      return {
        id: c.id,
        displayName: c.displayName,
        email: c.person.email,
        updatedAt: updatedAt.toISOString(),
        ageHours,
        untouched: ageHours >= 24,
      };
    })
    .sort((a, b) => {
      if (a.untouched !== b.untouched) return a.untouched ? -1 : 1;
      return b.ageHours - a.ageHours;
    })
    .slice(0, 12);

  let needsReview: RepOpsData["needsReview"] = [];
  try {
    const flagged = await prisma.contactProfile.findMany({
      where: {
        organizationId: orgId,
        ownerUserId: userId,
        flaggedForReview: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 15,
      select: {
        accountContactId: true,
        flagReason: true,
      },
    });
    const flaggedIds = flagged.map((f) => f.accountContactId);
    const { getPeopleByIds } = await import("@/dao/account/account-repository");
    const people = await getPeopleByIds(flaggedIds);
    const byId = new Map(people.map((p) => [p.id, p]));
    needsReview = flagged
      .map((f) => {
        const person = byId.get(f.accountContactId);
        if (!person) return null;
        if (
          !hasActionableContactIdentity(
            person.firstName,
            person.lastName,
            person.email,
            person.phone,
          )
        ) {
          return null;
        }
        return {
          id: f.accountContactId,
          displayName: formatContactListLabel(
            person.firstName,
            person.lastName,
            person.email,
            person.phone,
          ),
          email: person.email,
          reason: f.flagReason,
        };
      })
      .filter(Boolean) as RepOpsData["needsReview"];
  } catch {
    needsReview = [];
  }

  const quickActionContacts = [
    ...myLeads.map((l) => ({
      id: l.id,
      displayName: l.displayName,
      email: l.email,
    })),
  ];
  // Fill picker with other owned contacts if needed
  if (quickActionContacts.length < 30) {
    const more = await listContacts({
      page: 1,
      pageSize: 40,
      ownerUserId: userId,
    });
    const seen = new Set(quickActionContacts.map((c) => c.id));
    for (const c of more.items) {
      if (seen.has(c.id)) continue;
      quickActionContacts.push({
        id: c.id,
        displayName: c.displayName,
        email: c.person.email,
      });
      seen.add(c.id);
      if (quickActionContacts.length >= 40) break;
    }
  }

  return {
    meetingsToday: meetingRows.map((m) => ({
      id: m.id,
      subject: m.subject,
      dueAt: m.dueAt!.toISOString(),
      contactId: m.contactId,
      contactName: names.get(m.contactId) ?? "Contact",
    })),
    tasksToday: tasks.map((t) => ({
      id: t.id,
      subject: t.subject,
      dueAt: t.dueAt!.toISOString(),
      overdue: t.dueAt!.getTime() < dayStart.getTime(),
      contactId: t.contactId,
      contactName: names.get(t.contactId) ?? "Contact",
    })),
    recentActivity: recent.map((r) => ({
      id: r.id,
      type: r.type,
      subject: r.subject,
      createdAt: r.createdAt.toISOString(),
      contactId: r.contactId,
      contactName: names.get(r.contactId) ?? "Contact",
    })),
    myLeads,
    needsReview,
    quickActionContacts,
    assignableUsers: assignable.map((u) => ({ id: u.id, label: u.label })),
    currentUserId: userId,
    canAssignTaskAssignee: canAssignTaskAssignee(role),
    openDeals,
    closedDeals,
    totals: {
      open: openCount,
      closedWon,
      closedLost,
      total: openCount + closedWon + closedLost,
    },
    salesMetrics,
    myWeek,
  };
}
