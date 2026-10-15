import type { ActivityType, Prisma, TaskStatus } from "@prisma/client";
import {
  clampPage,
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  paginatedResult,
  type PaginatedResult,
} from "@/lib/pagination";
import { formatContactDisplayName } from "@/lib/contact-name";
import { htmlToPlainText, isHtmlEmailBody } from "@/lib/email-body";
import { prisma } from "@/dao/db/prisma";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import type {
  ActivityFeedItem,
  ActivityFeedStatus,
  ActivityStats,
} from "@/service/activities/types";

export type { ActivityFeedItem, ActivityFeedStatus, ActivityStats };

/** Completed tasks count as logged (not upcoming/overdue). */
const OPEN_TASK_CLAUSE: Prisma.ContactActivityWhereInput = {
  OR: [
    { type: { not: "task" } },
    { taskStatus: { not: "completed" } },
    { taskStatus: null },
  ],
};

const COMPLETED_TASK_CLAUSE: Prisma.ContactActivityWhereInput = {
  type: "task",
  taskStatus: "completed",
};

const MAX_OWNED_CONTACTS = 2000;
const BODY_PREVIEW_LEN = 160;

export type ActivityOwnerScope = "mine" | "all";

export type ListUserActivitiesFilters = {
  userId: string;
  /** When `all`, list org-wide (caller must enforce canViewAllRecords). */
  ownerScope?: ActivityOwnerScope;
  type?: ActivityType | "all";
  status?: ActivityFeedStatus | "all";
  search?: string;
  page?: number;
  pageSize?: number;
  organizationId?: string | null;
};

type PersonRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  company_name: string | null;
};

function previewBody(body: string | null): string | null {
  if (!body?.trim()) return null;
  let text = body.trim();
  if (isHtmlEmailBody(text) || /<[a-z][\s/>]/i.test(text) || /&lt;[a-z]/i.test(text)) {
    text = htmlToPlainText(text.replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"));
  }
  // Prefer text above the first quoted reply for list rows.
  const cut = text.search(/\n[ \t]*>?[ \t]*On[\s\S]{5,200}?\bwrote:/i);
  if (cut > 0) text = text.slice(0, cut);
  text = text
    .replace(/^[ \t]*>+[ \t]?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= BODY_PREVIEW_LEN) return text;
  return `${text.slice(0, BODY_PREVIEW_LEN)}…`;
}

export function deriveActivityStatus(
  dueAt: Date | null,
  now = new Date(),
  opts?: { type?: ActivityType; taskStatus?: TaskStatus | null },
): ActivityFeedStatus {
  if (opts?.type === "task" && opts.taskStatus === "completed") {
    return "logged";
  }
  if (!dueAt) return "logged";
  return dueAt.getTime() >= now.getTime() ? "upcoming" : "overdue";
}

function statusWhere(
  status: ActivityFeedStatus | "all" | undefined,
  now: Date,
): Prisma.ContactActivityWhereInput | undefined {
  if (!status || status === "all") return undefined;
  if (status === "logged") {
    return {
      OR: [{ dueAt: null }, COMPLETED_TASK_CLAUSE],
    };
  }
  if (status === "upcoming") {
    return {
      AND: [{ dueAt: { gte: now } }, OPEN_TASK_CLAUSE],
    };
  }
  return {
    AND: [{ dueAt: { lt: now } }, OPEN_TASK_CLAUSE],
  };
}

async function ownedContactIds(userId: string): Promise<string[]> {
  const { prisma } = await import("@/dao/db/prisma");
  const rows = await prisma.contactProfile.findMany({
    where: { ownerUserId: userId, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    take: MAX_OWNED_CONTACTS,
    select: { accountContactId: true },
  });
  return rows.map((r) => r.accountContactId);
}

async function buildOwnershipWhere(
  userId: string,
  ownerScope: ActivityOwnerScope,
): Promise<Prisma.ContactActivityWhereInput | undefined> {
  if (ownerScope === "all") return undefined;

  const ownedIds = await ownedContactIds(userId);
  const ownershipOr: Prisma.ContactActivityWhereInput[] = [
    { createdByUserId: userId },
    { assigneeUserId: userId },
  ];
  if (ownedIds.length > 0) {
    ownershipOr.push({ contactId: { in: ownedIds } });
  }
  return { OR: ownershipOr };
}

async function buildBaseWhere(
  filters: {
    userId: string;
    ownerScope?: ActivityOwnerScope;
    type?: ActivityType | "all";
    status?: ActivityFeedStatus | "all";
    search?: string;
    organizationId?: string | null;
  },
  now: Date,
): Promise<Prisma.ContactActivityWhereInput> {
  const organizationId = await resolveRequestOrganizationId(filters.organizationId);
  const ownerScope = filters.ownerScope ?? "mine";
  const ownership = await buildOwnershipWhere(filters.userId, ownerScope);

  const where: Prisma.ContactActivityWhereInput = {
    organizationId,
    folder: { not: "trash" },
    // Notes stay on the contact page only — never in Activities / My Tasks.
    ...(filters.type && filters.type !== "all"
      ? { type: filters.type }
      : { type: { not: "note" } }),
    ...(ownership ?? {}),
  };

  const statusClause = statusWhere(filters.status, now);
  const q = filters.search?.trim();
  const and: Prisma.ContactActivityWhereInput[] = [];
  if (statusClause) and.push(statusClause);
  if (q) {
    const { findContactIdsBySearch } = await import(
      "@/dao/account/account-repository"
    );
    const matchedContactIds = await findContactIdsBySearch(q, {
      organizationId,
      limit: 200,
    });
    and.push({
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
        ...(matchedContactIds.length > 0
          ? [{ contactId: { in: matchedContactIds } }]
          : []),
      ],
    });
  }
  if (and.length) where.AND = and;

  return where;
}

export async function getActivityStats(filters: {
  userId: string;
  ownerScope?: ActivityOwnerScope;
  organizationId?: string | null;
}): Promise<ActivityStats> {
  const now = new Date();
  const base = await buildBaseWhere(
    {
      userId: filters.userId,
      ownerScope: filters.ownerScope,
      organizationId: filters.organizationId,
    },
    now,
  );

  const [total, upcoming, overdue, logged] = await Promise.all([
    prisma.contactActivity.count({ where: base }),
    prisma.contactActivity.count({
      where: {
        AND: [base, { dueAt: { gte: now } }, OPEN_TASK_CLAUSE],
      },
    }),
    prisma.contactActivity.count({
      where: {
        AND: [base, { dueAt: { lt: now } }, OPEN_TASK_CLAUSE],
      },
    }),
    prisma.contactActivity.count({
      where: {
        AND: [
          base,
          {
            OR: [{ dueAt: null }, COMPLETED_TASK_CLAUSE],
          },
        ],
      },
    }),
  ]);

  return { total, upcoming, overdue, logged };
}

export async function listUserActivities(
  filters: ListUserActivitiesFilters,
): Promise<PaginatedResult<ActivityFeedItem>> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize, DEFAULT_PAGE_SIZE);
  const now = new Date();
  const where = await buildBaseWhere(filters, now);

  const [total, rows] = await Promise.all([
    prisma.contactActivity.count({ where }),
    prisma.contactActivity.findMany({
      where,
      orderBy:
        filters.status === "upcoming" || filters.status === "overdue"
          ? [{ dueAt: "asc" }, { createdAt: "desc" }]
          : [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        subject: true,
        body: true,
        threadId: true,
        gmailThreadId: true,
        emailDirection: true,
        folder: true,
        dueAt: true,
        createdAt: true,
        contactId: true,
        createdByUserId: true,
        assigneeUserId: true,
        taskStatus: true,
        disposition: true,
      },
    }),
  ]);

  if (rows.length === 0) {
    return paginatedResult([], total, page, pageSize);
  }

  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const { getPeopleByIds } = await import("@/dao/account/account-repository");
  const people = await getPeopleByIds(contactIds);
  const { getContactProfilesByAccountIds } = await import(
    "@/dao/contacts/contact-profile-repository"
  );
  const profiles = await getContactProfilesByAccountIds(contactIds);
  const byId = new Map(
    people.map((p) => [p.id.trim().toLowerCase(), p]),
  );

  const items: ActivityFeedItem[] = rows.map((row) => {
    const person = byId.get(row.contactId.trim().toLowerCase());
    const profile = profiles.get(row.contactId);
    return {
      id: row.id,
      type: row.type,
      subject: row.subject,
      bodyPreview: previewBody(row.body),
      disposition: row.disposition?.trim() || null,
      dueAt: row.dueAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      status: deriveActivityStatus(row.dueAt, now, {
        type: row.type,
        taskStatus: row.taskStatus,
      }),
      contactId: row.contactId,
      contactName: person
        ? formatContactDisplayName(person.firstName, person.lastName)
        : "Unknown contact",
      contactEmail: person?.email || null,
      companyId: profile?.companyId ?? null,
      companyName: person?.company?.name?.trim() || null,
      createdByUserId: row.createdByUserId,
      assigneeUserId: row.assigneeUserId,
      taskStatus: row.taskStatus,
      threadId: row.threadId,
      gmailThreadId: row.gmailThreadId,
      emailDirection: row.emailDirection,
      folder: row.folder,
    };
  });

  return paginatedResult(items, total, page, pageSize);
}
