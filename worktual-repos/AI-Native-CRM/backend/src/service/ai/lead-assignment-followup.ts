/**
 * After a lead is assigned, email the owner and remind on the admin cadence.
 * The owner does not change. Only a later manual reassignment moves the lead.
 */

import { getContact } from "@/dao/contacts/contact-service";
import { prisma } from "@/dao/db/prisma";
import { notifyUsersViaCrmBot } from "@/service/email/notify-crm-bot";
import {
  listAdminUsers,
  listSalesManagerUsers,
} from "@/service/account/user-directory";
import { getOrCreateOrgAssignmentSettings } from "@/dao/sales/assignment-settings";
import { loadOwnerWorkingCalendar } from "@/service/ai/owner-business-hours";
import {
  followupDeadline,
  type FollowupBand,
  type FollowupStep,
} from "@/lib/owner-working-hours";

const ACTION_TYPES = ["email", "sms", "call", "note", "task"] as const;

function bandOf(value: string | null | undefined): FollowupBand {
  if (value === "hot" || value === "warm" || value === "cold") return value;
  return "warm";
}

async function leadBand(
  organizationId: string,
  contactId: string,
  explicit?: string | null,
): Promise<FollowupBand> {
  if (explicit === "hot" || explicit === "warm" || explicit === "cold") {
    return explicit;
  }
  const score = await prisma.leadScoringJob.findFirst({
    where: {
      organizationId: BigInt(organizationId),
      contactId,
    },
    select: { band: true },
  });
  return bandOf(score?.band);
}

function stepForStage(stage: string | null): FollowupStep | null {
  if (stage === "owner_notified") return "remind";
  if (stage === "owner_reminded") return "manager";
  if (stage === "manager_notified") return "admin";
  return null;
}

function nextStage(stage: string): string | null {
  if (stage === "owner_notified") return "owner_reminded";
  if (stage === "owner_reminded") return "manager_notified";
  if (stage === "manager_notified") return "admin_notified";
  return null;
}

async function hasOwnerAction(input: {
  contactId: string;
  assignedAt: Date;
  baselineStatus: string | null;
  leadStatus: string;
}): Promise<boolean> {
  if (
    input.baselineStatus &&
    input.leadStatus !== input.baselineStatus
  ) {
    return true;
  }
  const activity = await prisma.contactActivity.findFirst({
    where: {
      contactId: input.contactId,
      createdAt: { gt: input.assignedAt },
      type: { in: [...ACTION_TYPES] },
    },
    select: { id: true },
  });
  return Boolean(activity);
}

export async function beginLeadOwnerFollowup(input: {
  contactId: string;
  organizationId: string;
  ownerUserId: string;
  reason: string;
  displayName: string;
  band?: string | null;
  leadStatus?: string | null;
  score?: number | null;
}): Promise<Date> {
  const band = await leadBand(
    input.organizationId,
    input.contactId,
    input.band,
  );
  const settings = await getOrCreateOrgAssignmentSettings(input.organizationId);
  const calendar = await loadOwnerWorkingCalendar(
    input.organizationId,
    input.ownerUserId,
  );
  const assignedAt = new Date();
  const sla = followupDeadline({
    from: assignedAt,
    band,
    step: "remind",
    calendar,
    policy: settings.followupPolicy,
  });
  const baseline = input.leadStatus?.trim() || "new";

  await prisma.contactProfile.updateMany({
    where: { accountContactId: input.contactId },
    data: {
      assignmentReason: input.reason.slice(0, 2000),
      slaDeadline: sla,
      assignedAt,
      assignmentEscalated: false,
      assignmentFollowupStage: "owner_notified",
      assignmentBaselineStatus: baseline,
      nurtureStatus: null,
    },
  });

  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds: [input.ownerUserId],
    kind: "lead_assigned",
    title: `New ${band} lead assigned`,
    body: `${input.displayName} is assigned to you. ${input.reason}`,
    href: `/contact/${input.contactId}`,
    contactId: input.contactId,
    entityType: "contact",
    entityId: input.contactId,
    contactName: input.displayName,
    nextStep:
      "Accept the lead, send a message, log a call, change the status, or add a note or task.",
    metadata: {
      band,
      score: input.score ?? null,
      slaDeadline: sla.toISOString(),
    },
  }).catch((err) => {
    console.error("lead assignment owner email failed", input.contactId, err);
  });

  return sla;
}

export async function notifyNoSalesRepForLead(input: {
  contactId: string;
  organizationId: string;
  displayName: string;
  reason: string;
  score?: number | null;
  band?: string | null;
}): Promise<void> {
  const [admins, managers] = await Promise.all([
    listAdminUsers(input.organizationId),
    listSalesManagerUsers(input.organizationId),
  ]);
  const recipientUserIds = [
    ...new Set([...admins, ...managers].map((user) => user.id)),
  ];
  await prisma.contactProfile.updateMany({
    where: { accountContactId: input.contactId },
    data: {
      assignmentEscalated: true,
      assignmentReason: input.reason.slice(0, 2000),
      assignmentFollowupStage: null,
    },
  });
  if (recipientUserIds.length === 0) return;
  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds,
    kind: "lead_assignment_escalated",
    title: "No sales rep for lead",
    body: `${input.displayName} was not assigned. ${input.reason} A manager or admin can assign a sales rep manually.`,
    href: `/contact/${input.contactId}`,
    contactId: input.contactId,
    entityType: "contact",
    entityId: input.contactId,
    contactName: input.displayName,
    nextStep: "Assign the lead to a sales rep and record the reason.",
    metadata: {
      score: input.score ?? null,
      band: input.band ?? null,
    },
  });
}

async function emailFollowup(input: {
  organizationId: string;
  contactId: string;
  displayName: string;
  stage: string;
  ownerUserId: string;
}): Promise<void> {
  if (input.stage === "owner_notified") {
    await notifyUsersViaCrmBot({
      organizationId: input.organizationId,
      recipientUserIds: [input.ownerUserId],
      kind: "lead_assignment_reminder",
      title: `Reminder: ${input.displayName} still needs a first action`,
      body: `${input.displayName} is still assigned to you and has no accept, message, call, status change, note, or task yet.`,
      href: `/contact/${input.contactId}`,
      contactId: input.contactId,
      entityType: "contact",
      entityId: input.contactId,
      contactName: input.displayName,
      nextStep: "Take an action on this lead. It stays with you.",
    });
    return;
  }
  const managers = await listSalesManagerUsers(input.organizationId);
  const admins =
    input.stage === "owner_reminded"
      ? []
      : await listAdminUsers(input.organizationId);
  const recipientUserIds = [
    ...new Set(
      (input.stage === "owner_reminded" ? managers : admins).map((u) => u.id),
    ),
  ];
  if (recipientUserIds.length === 0) return;
  const toManager = input.stage === "owner_reminded";
  await notifyUsersViaCrmBot({
    organizationId: input.organizationId,
    recipientUserIds,
    kind: "lead_assignment_escalated",
    title: toManager
      ? `Lead needs attention: ${input.displayName}`
      : `Lead still untouched: ${input.displayName}`,
    body: toManager
      ? `${input.displayName} is still with the assigned sales rep and has no action after the reminder. The owner is unchanged.`
      : `${input.displayName} is still with the assigned sales rep after the manager was told. The owner is unchanged. Reassign only with a reason.`,
    href: `/contact/${input.contactId}`,
    contactId: input.contactId,
    entityType: "contact",
    entityId: input.contactId,
    contactName: input.displayName,
    nextStep: toManager
      ? "Check in with the owner. Reassign only if you record a reason."
      : "Reassign the lead only with a reason, or confirm the owner will act.",
  });
}

export async function processLeadAssignmentFollowups(options?: {
  organizationId?: string | null;
  limit?: number;
}): Promise<{ advanced: number; acted: number }> {
  const limit = Math.min(100, Math.max(1, options?.limit ?? 40));
  if (options?.organizationId === undefined) {
    const orgs = await prisma.contactProfile.findMany({
      where: {
        assignmentFollowupStage: {
          in: ["owner_notified", "owner_reminded", "manager_notified"],
        },
        slaDeadline: { lte: new Date() },
      },
      distinct: ["organizationId"],
      select: { organizationId: true },
      take: 50,
    });
    let advanced = 0;
    let acted = 0;
    for (const org of orgs) {
      const result = await processLeadAssignmentFollowups({
        organizationId: String(org.organizationId),
        limit,
      });
      advanced += result.advanced;
      acted += result.acted;
    }
    return { advanced, acted };
  }

  const organizationId = String(options.organizationId);
  const due = await prisma.contactProfile.findMany({
    where: {
      organizationId: BigInt(organizationId),
      ownerUserId: { not: null },
      assignedAt: { not: null },
      slaDeadline: { lte: new Date() },
      assignmentFollowupStage: {
        in: ["owner_notified", "owner_reminded", "manager_notified"],
      },
      leadStatus: { notIn: ["converted", "disqualified"] },
    },
    take: limit,
    select: {
      accountContactId: true,
      ownerUserId: true,
      assignedAt: true,
      assignmentFollowupStage: true,
      assignmentBaselineStatus: true,
      leadStatus: true,
      notes: true,
    },
  });

  let advanced = 0;
  let acted = 0;
  for (const row of due) {
    const stage = row.assignmentFollowupStage;
    if (!stage || !row.assignedAt || !row.ownerUserId) continue;
    const actedNow = await hasOwnerAction({
      contactId: row.accountContactId,
      assignedAt: row.assignedAt,
      baselineStatus: row.assignmentBaselineStatus,
      leadStatus: row.leadStatus,
    });
    if (actedNow) {
      await prisma.contactProfile.updateMany({
        where: {
          accountContactId: row.accountContactId,
          assignmentFollowupStage: stage,
        },
        data: { assignmentFollowupStage: "acted", slaDeadline: null },
      });
      acted += 1;
      continue;
    }

    const upcoming = nextStage(stage);
    const deadlineStep = stepForStage(upcoming);
    if (!upcoming) continue;
    const band = await leadBand(organizationId, row.accountContactId, null);
    const settings = await getOrCreateOrgAssignmentSettings(organizationId);
    const calendar = await loadOwnerWorkingCalendar(
      organizationId,
      String(row.ownerUserId),
    );
    const nextDeadline =
      deadlineStep == null
        ? null
        : followupDeadline({
            from: row.assignedAt,
            band,
            step: deadlineStep,
            calendar,
            policy: settings.followupPolicy,
          });

    const claimed = await prisma.contactProfile.updateMany({
      where: {
        accountContactId: row.accountContactId,
        assignmentFollowupStage: stage,
      },
      data: {
        assignmentFollowupStage: upcoming,
        slaDeadline: nextDeadline,
        assignmentEscalated: upcoming === "admin_notified",
      },
    });
    if (claimed.count !== 1) continue;

    const contact = await getContact(row.accountContactId).catch(() => null);
    const displayName = contact?.displayName?.trim() || "Lead";
    await emailFollowup({
      organizationId,
      contactId: row.accountContactId,
      displayName,
      stage,
      ownerUserId: String(row.ownerUserId),
    }).catch((err) => {
      console.error("lead follow-up email failed", row.accountContactId, err);
    });
    advanced += 1;
  }
  return { advanced, acted };
}
