/**
 * Contact-owner confirmation queue for B2B post-meeting process agent.
 * High-risk actions (customer email, commercial close) wait here until approved.
 */

import { Prisma, type ProcessConfirmationStatus } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { insertNotifications } from "@/dao/notifications/notification-store";
import { publishUserNotification } from "@/service/notifications/notification-events";

export type ProcessActionKind =
  | "email_proposal"
  | "book_meeting"
  | "propose_slots_email"
  | "close_won"
  | "close_lost"
  | "quote_send"
  | "quote_accept"
  | "disqualify";

export type ProcessConfirmationRow = {
  id: string;
  organizationId: string;
  contactId: string;
  ownerUserId: string;
  activityId: string | null;
  dealId: string | null;
  actionKind: string;
  title: string;
  summary: string | null;
  payload: unknown;
  status: ProcessConfirmationStatus;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  resultNote: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function enqueueProcessConfirmation(input: {
  organizationId: string;
  contactId: string;
  ownerUserId: string;
  activityId?: string | null;
  dealId?: string | null;
  actionKind: ProcessActionKind | string;
  title: string;
  summary?: string | null;
  payload: Record<string, unknown>;
}): Promise<ProcessConfirmationRow> {
  const ownerUserId = input.ownerUserId.trim();
  if (!ownerUserId) {
    throw new Error("Contact owner required for process confirmation.");
  }

  // Dedupe: one pending confirmation per contact + action kind.
  const existing = await prisma.processConfirmation.findFirst({
    where: {
      contactId: input.contactId,
      ownerUserId,
      actionKind: input.actionKind,
      status: "pending",
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return existing;
  }

  const row = await prisma.processConfirmation.create({
    data: {
      organizationId: input.organizationId,
      contactId: input.contactId,
      ownerUserId,
      activityId: input.activityId ?? null,
      dealId: input.dealId ?? null,
      actionKind: input.actionKind,
      title: input.title.slice(0, 200),
      summary: input.summary?.slice(0, 2000) ?? null,
      payload: input.payload as Prisma.InputJsonObject,
      status: "pending",
    },
  });

  const href = `/process-approvals?id=${encodeURIComponent(row.id)}`;
  try {
    const [notif] = await insertNotifications([
      {
        organizationId: input.organizationId,
        recipientUserId: ownerUserId,
        kind: "process_confirmation",
        title: input.title.slice(0, 200),
        body: input.summary?.slice(0, 500) ?? "Review and approve or reject.",
        href,
        entityType: "process_confirmation",
        entityId: row.id,
        contactId: input.contactId,
        metadata: {
          actionKind: input.actionKind,
          confirmationId: row.id,
          dealId: input.dealId ?? null,
        },
      },
    ]);
    if (notif) {
      publishUserNotification({
        userId: ownerUserId,
        organizationId: input.organizationId,
        notificationId: notif.id,
        kind: "process_confirmation",
      });
    }
  } catch (err) {
    console.error("process confirmation notify failed", row.id, err);
  }

  return row;
}

export async function listProcessConfirmationsForOwner(input: {
  ownerUserId: string;
  status?: ProcessConfirmationStatus | "all";
  limit?: number;
}): Promise<ProcessConfirmationRow[]> {
  const limit = Math.min(100, Math.max(1, input.limit ?? 40));
  return prisma.processConfirmation.findMany({
    where: {
      ownerUserId: input.ownerUserId,
      ...(input.status && input.status !== "all"
        ? { status: input.status }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getProcessConfirmation(
  id: string,
): Promise<ProcessConfirmationRow | null> {
  return prisma.processConfirmation.findUnique({ where: { id } });
}

export async function markProcessConfirmation(
  id: string,
  input: {
    status: "approved" | "rejected";
    decidedByUserId: string;
    resultNote?: string | null;
  },
): Promise<ProcessConfirmationRow> {
  return prisma.processConfirmation.update({
    where: { id },
    data: {
      status: input.status,
      decidedAt: new Date(),
      decidedByUserId: input.decidedByUserId,
      resultNote: input.resultNote ?? null,
    },
  });
}
