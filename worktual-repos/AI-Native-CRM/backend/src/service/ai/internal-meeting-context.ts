/**
 * CRM facts for an internal meeting turn. The agent does not query the
 * database. An employee answer uses that person's own book. A manager fact
 * check uses the organization overall.
 */

import { getContactHydrateByIds } from "@/dao/account/account-repository";
import { prisma } from "@/dao/db/prisma";
import type { AppRole } from "@/service/auth/rbac";

export type InternalContextRole = "sales" | "marketing" | "finance" | "general";

const ACTIVITY_TYPES = ["meeting", "call", "task"] as const;

export function contextRoleFor(role: AppRole): InternalContextRole {
  if (role === "sales_rep" || role === "presales") return "sales";
  if (role === "marketing") return "marketing";
  if (role === "finance") return "finance";
  return "general";
}

export function localDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dayLabel(date: Date | null | undefined, today: string): string {
  if (!date) return "no date";
  const day = localDay(date);
  return day === today ? `today ${day}` : day;
}

function asBigInt(value: string): bigint | null {
  try {
    return BigInt(value.trim());
  } catch {
    return null;
  }
}

function personName(person: { firstName: string; lastName: string } | undefined): string {
  const name = `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.trim();
  return name || "unnamed contact";
}

function clip(text: string): string {
  return text.length > 3500 ? `${text.slice(0, 3500).trimEnd()}\n…` : text;
}

async function customerLines(
  organizationId: bigint,
  ownerUserId: bigint | null,
): Promise<string[]> {
  const profiles = await prisma.contactProfile.findMany({
    where: {
      organizationId,
      ...(ownerUserId != null ? { ownerUserId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      accountContactId: true,
      leadStatus: true,
      company: { select: { name: true } },
    },
  });
  if (!profiles.length) return [];
  const people = await getContactHydrateByIds(profiles.map((row) => row.accountContactId));
  return profiles.map((row) => {
    const person = people.get(row.accountContactId);
    const company = person?.company || row.company?.name || "no company";
    return `Customer ${personName(person)} company ${company} status ${row.leadStatus}`;
  });
}

async function dealLines(
  organizationId: bigint,
  ownerUserId: bigint | null,
  today: string,
): Promise<string[]> {
  const deals = await prisma.deal.findMany({
    where: {
      organizationId,
      ...(ownerUserId != null ? { ownerUserId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      title: true,
      stage: true,
      amount: true,
      contactName: true,
      expectedCloseDate: true,
      updatedAt: true,
    },
  });
  return deals.map((deal) => {
    const amount = deal.amount != null ? String(deal.amount) : "no amount";
    const who = deal.contactName?.trim() || "no contact";
    return `Deal "${deal.title}" stage ${deal.stage} amount ${amount} contact ${who} close ${dayLabel(deal.expectedCloseDate, today)} updated ${dayLabel(deal.updatedAt, today)}`;
  });
}

async function activityLines(
  organizationId: bigint,
  userId: bigint | null,
  today: string,
): Promise<string[]> {
  const activities = await prisma.contactActivity.findMany({
    where: {
      organizationId,
      type: { in: [...ACTIVITY_TYPES] },
      ...(userId != null
        ? { OR: [{ assigneeUserId: userId }, { createdByUserId: userId }] }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      type: true,
      subject: true,
      dueAt: true,
      taskStatus: true,
      contactId: true,
      updatedAt: true,
    },
  });
  if (!activities.length) return [];
  const people = await getContactHydrateByIds(
    activities.map((row) => row.contactId).filter(Boolean),
  );
  return activities.map((row) => {
    const contact = personName(people.get(row.contactId));
    const status = row.taskStatus || "no task status";
    return `Activity ${row.type} "${row.subject}" due ${dayLabel(row.dueAt, today)} updated ${dayLabel(row.updatedAt, today)} status ${status} contact ${contact}`;
  });
}

async function invoiceLines(organizationId: bigint, createdByUserId: bigint | null): Promise<string[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId,
      ...(createdByUserId != null ? { createdByUserId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { number: true, status: true, total: true, currency: true },
  });
  return invoices.map(
    (invoice) =>
      `Invoice ${invoice.number} status ${invoice.status} total ${invoice.total} ${invoice.currency}`,
  );
}

function section(title: string, lines: string[], empty: string): string {
  return lines.length ? `${title}\n${lines.join("\n")}` : `${title}\n${empty}`;
}

async function ownedCounts(
  organizationId: bigint,
  ownerUserId: bigint,
): Promise<string> {
  const owned = { organizationId, ownerUserId };
  const [customers, convertedDeals, openDeals, lostDeals] = await Promise.all([
    prisma.contactProfile.count({ where: owned }),
    prisma.deal.count({ where: { ...owned, stage: "closed_won" } }),
    prisma.deal.count({
      where: { ...owned, stage: { notIn: ["closed_won", "closed_lost"] } },
    }),
    prisma.deal.count({ where: { ...owned, stage: "closed_lost" } }),
  ]);
  return [
    `Counts: customers owned ${customers}.`,
    `Deals converted (closed won) ${convertedDeals}.`,
    `Open deals ${openDeals}.`,
    `Deals lost ${lostDeals}.`,
  ].join(" ");
}

/** This employee's customers, deals, and activities. */
export async function loadEmployeeMeetingContext(input: {
  organizationId: string;
  userId: string;
  name: string;
  role: InternalContextRole;
}): Promise<string> {
  const organizationId = asBigInt(input.organizationId);
  const userId = asBigInt(input.userId);
  const today = localDay(new Date());
  if (organizationId == null || userId == null) {
    return `Employee ${input.name}. No CRM records could be loaded. Today is ${today}.`;
  }
  const [counts, customers, deals, activities, invoices] = await Promise.all([
    ownedCounts(organizationId, userId),
    customerLines(organizationId, userId),
    dealLines(organizationId, userId, today),
    activityLines(organizationId, userId, today),
    input.role === "finance" ? invoiceLines(organizationId, userId) : Promise.resolve([]),
  ]);
  const parts = [
    `Employee ${input.name} (${input.role}). These rows are this person's own customers, deals, and activities. Today is ${today}.`,
    counts,
    section("Customers", customers, "No customers are owned by this person."),
    section("Deals", deals, "No deals are owned by this person."),
    section("Activities", activities, "No meetings, calls, or tasks are assigned to this person."),
  ];
  if (input.role === "finance") {
    parts.push(section("Invoices", invoices, "No invoices were created by this person."));
  }
  if (input.role === "marketing") {
    parts.push("Campaigns\nNo marketing campaign records are stored in the CRM.");
  }
  return clip(parts.join("\n\n"));
}

/** Company-wide records for an admin, manager, or CEO fact check. */
export async function loadOrgMeetingContext(organizationId: string): Promise<string> {
  const org = asBigInt(organizationId);
  const today = localDay(new Date());
  if (org == null) {
    return `Organization records. No CRM records could be loaded. Today is ${today}.`;
  }
  const [customers, deals, activities, invoices] = await Promise.all([
    customerLines(org, null),
    dealLines(org, null, today),
    activityLines(org, null, today),
    invoiceLines(org, null),
  ]);
  return clip(
    [
      `Organization-wide CRM records. Today is ${today}.`,
      section("Customers", customers, "No customer records are stored."),
      section("Deals", deals, "No deal records are stored."),
      section("Activities", activities, "No meetings, calls, or tasks are stored."),
      section("Invoices", invoices, "No invoice records are stored."),
      "Campaigns\nNo marketing campaign records are stored in the CRM.",
    ].join("\n\n"),
  );
}
