import type {
  ActivityType,
  EmailDirection,
  InboxFolder,
  MailProvider,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { parseNoteBody } from "@/lib/note-body";
import { publishLeadSummaryEvent } from "@/service/ai/lead-summary-events";
import {
  isConversationActivity,
  scheduleLeadSummaryRefresh,
} from "@/service/ai/lead-summary-refresh";

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "completed",
] as const satisfies readonly TaskStatus[];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
};

export type ContactActivityInput = {
  type: ActivityType;
  subject: string;
  body?: string | null;
  dueAt?: Date | null;
  assigneeUserId?: string | null;
  taskStatus?: TaskStatus | null;
  createdByUserId?: string | null;
  /** Tenant — preferred. Resolved from contact profile / session when omitted. */
  organizationId?: string | null;
  folder?: InboxFolder;
  threadId?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  mailProvider?: MailProvider | null;
  rfcMessageId?: string | null;
  emailDirection?: EmailDirection | null;
};

/**
 * Never use the legacy static DEFAULT_ORGANIZATION_ID. Prefer explicit →
 * contact_profiles.organization_id → signed-in session tenant.
 */
export async function resolveOrganizationIdForContactActivity(
  contactId: string,
  explicit?: string | null,
): Promise<string> {
  const fromInput = explicit?.trim();
  if (fromInput) return fromInput;

  const profile = await prisma.contactProfile.findFirst({
    where: { accountContactId: contactId },
    select: { organizationId: true },
    orderBy: { updatedAt: "desc" },
  });
  const fromProfile = profile?.organizationId?.trim();
  if (fromProfile) return fromProfile;

  try {
    const { getCurrentOrganizationId } = await import(
      "@/service/auth/require-role"
    );
    return await getCurrentOrganizationId();
  } catch (err) {
    throw new Error(
      `organizationId is required for contact activity (contact ${contactId}). ` +
        `Pass organizationId, ensure a contact_profiles row has a tenant, or sign in. ` +
        `${err instanceof Error ? err.message : ""}`.trim(),
    );
  }
}

export type ContactActivityView = {
  id: string;
  contactId: string;
  type: ActivityType;
  folder: InboxFolder;
  threadId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  emailDirection: EmailDirection | null;
  subject: string;
  body: string | null;
  dueAt: string | null;
  assigneeUserId: string | null;
  taskStatus: TaskStatus | null;
  completedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  /** Rolled-up meeting/call transcript when capture finished. */
  transcriptText: string | null;
  transcriptSource: string | null;
  /** Outcome label for this touch. Free text from the disposition agent. */
  disposition: string | null;
};

/** Display status for tasks: stored workflow + derived overdue. */
export type TaskDisplayStatus =
  | TaskStatus
  | "overdue";

export function deriveTaskDisplayStatus(
  taskStatus: TaskStatus | null | undefined,
  dueAt: Date | string | null | undefined,
  now = new Date(),
): TaskDisplayStatus | null {
  if (!taskStatus) return null;
  if (taskStatus === "completed") return "completed";
  if (dueAt) {
    const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) {
      return "overdue";
    }
  }
  return taskStatus;
}

export const TASK_DISPLAY_STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
};

function toView(row: {
  id: string;
  contactId: string;
  type: ActivityType;
  folder: InboxFolder;
  threadId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  emailDirection: EmailDirection | null;
  subject: string;
  body: string | null;
  dueAt: Date | null;
  assigneeUserId: string | null;
  taskStatus: TaskStatus | null;
  completedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  transcriptText?: string | null;
  transcriptSource?: string | null;
  disposition?: string | null;
}): ContactActivityView {
  return {
    id: row.id,
    contactId: row.contactId,
    type: row.type,
    folder: row.folder,
    threadId: row.threadId,
    gmailMessageId: row.gmailMessageId,
    gmailThreadId: row.gmailThreadId,
    rfcMessageId: row.rfcMessageId,
    emailDirection: row.emailDirection,
    subject: row.subject,
    body: row.body,
    dueAt: row.dueAt?.toISOString() ?? null,
    assigneeUserId: row.assigneeUserId,
    taskStatus: row.taskStatus,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    transcriptText: row.transcriptText?.trim() || null,
    transcriptSource: row.transcriptSource?.trim() || null,
    disposition: row.disposition?.trim() || null,
  };
}

export async function listContactActivities(
  contactId: string,
  limit = 100,
): Promise<ContactActivityView[]> {
  const rows = await prisma.contactActivity.findMany({
    where: { contactId, folder: { not: "trash" } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
  return rows.map(toView);
}

export async function createContactActivity(
  contactId: string,
  input: ContactActivityInput,
): Promise<ContactActivityView> {
  const view = await createContactActivityInner(contactId, input);
  // Batch conversation summaries for about a minute, then tell open pages to reload.
  try {
    const organizationId =
      input.organizationId?.trim() ||
      (
        await prisma.contactProfile.findFirst({
          where: { accountContactId: contactId },
          select: { organizationId: true },
        })
      )?.organizationId?.toString() ||
      "";
    if (organizationId && isConversationActivity(view.type)) {
      await scheduleLeadSummaryRefresh({ organizationId, contactId });
    }
  } catch (err) {
    console.error("schedule lead summary refresh failed", err);
  }
  publishLeadSummaryEvent({ contactId, reason: input.type });
  try {
    const { scheduleCustomerBantCapture } = await import(
      "@/service/ai/contact-bant-from-communication"
    );
    scheduleCustomerBantCapture({
      contactId,
      type: view.type,
      subject: view.subject,
      body: view.body,
      emailDirection: view.emailDirection,
    });
  } catch (err) {
    console.error("schedule customer BANT capture failed", err);
  }
  try {
    const { emitCrmPlatformEvent } = await import("@/lib/crm-platform-events");
    const organizationId =
      input.organizationId?.trim() ||
      (
        await prisma.contactProfile.findFirst({
          where: { accountContactId: contactId },
          select: { organizationId: true },
        })
      )?.organizationId ||
      "";
    if (organizationId) {
      emitCrmPlatformEvent({
        type: "activity.logged",
        organizationId,
        cdpId: contactId,
        entityType: "activity",
        entityId: view.id,
        payload: { activityType: view.type, subject: view.subject },
      });
    }
  } catch {
    /* optional combine contract */
  }
  return view;
}

async function createContactActivityInner(
  contactId: string,
  input: ContactActivityInput,
): Promise<ContactActivityView> {
  const type = input.type;
  const organizationId = await resolveOrganizationIdForContactActivity(
    contactId,
    input.organizationId,
  );

  if (type === "note") {
    const rawBody = input.body?.trim() || input.subject.trim() || "";
    if (!rawBody) throw new Error("Note description is required.");
    const parsed = parseNoteBody(rawBody);
    if (!parsed.plain && parsed.attachments.length === 0) {
      throw new Error("Note description is required.");
    }
    const subject =
      parsed.plain.length > 80
        ? `${parsed.plain.slice(0, 77)}…`
        : parsed.plain ||
          (parsed.attachments.length
            ? `Note with ${parsed.attachments.length} attachment${parsed.attachments.length === 1 ? "" : "s"}`
            : "Note");

    const row = await prisma.contactActivity.create({
      data: {
        organizationId,
        contactId,
        type: "note",
        folder: input.folder ?? "inbox",
        subject,
        body: rawBody,
        dueAt: null,
        assigneeUserId: null,
        taskStatus: null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
    if (!row.threadId) {
      const updated = await prisma.contactActivity.update({
        where: { id: row.id },
        data: { threadId: row.id },
      });
      return toView(updated);
    }
    return toView(row);
  }

  if (type === "task") {
    const subject = input.subject.trim();
    if (!subject) throw new Error("Task title is required.");
    const body = input.body?.trim() || "";
    if (!body) throw new Error("Task description is required.");
    const assigneeUserId = input.assigneeUserId?.trim() || null;
    if (!assigneeUserId) throw new Error("Task assignee is required.");
    if (!input.dueAt) throw new Error("Task due date is required.");

    // Status is not user-editable on create — always start Open.
    const row = await prisma.contactActivity.create({
      data: {
        organizationId,
        contactId,
        type: "task",
        folder: input.folder ?? "inbox",
        subject,
        body,
        dueAt: input.dueAt,
        assigneeUserId,
        taskStatus: "open",
        completedAt: null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
    if (!row.threadId) {
      const updated = await prisma.contactActivity.update({
        where: { id: row.id },
        data: { threadId: row.id },
      });
      return toView(updated);
    }
    return toView(row);
  }

  const subject = input.subject.trim();
  if (!subject) throw new Error("Activity subject is required.");

  const gmailMessageId = input.gmailMessageId?.trim() || null;
  const providerMessageId = input.providerMessageId?.trim() || null;
  const gmailThreadId = input.gmailThreadId?.trim() || null;
  const providerThreadId = input.providerThreadId?.trim() || null;
  const rfcMessageId = input.rfcMessageId?.trim() || null;

  // Idempotent: if this provider message was already logged (e.g. send + sync,
  // or a client that logs twice), return the existing row instead of failing.
  if (gmailMessageId) {
    const existingByGmail = await prisma.contactActivity.findUnique({
      where: { gmailMessageId },
    });
    if (existingByGmail) return toView(existingByGmail);
  }
  if (providerMessageId) {
    const existingByProvider = await prisma.contactActivity.findUnique({
      where: { providerMessageId },
    });
    if (existingByProvider) {
      if (
        type === "meeting" &&
        existingByProvider.type === "meeting" &&
        input.dueAt &&
        existingByProvider.dueAt &&
        Math.abs(existingByProvider.dueAt.getTime() - input.dueAt.getTime()) >
          60_000
      ) {
        return updateContactMeetingSchedule(existingByProvider.id, {
          dueAt: input.dueAt,
          body: input.body?.trim() || existingByProvider.body || "",
          subject,
        });
      }
      return toView(existingByProvider);
    }
  }
  // Outbound send often stores Gmail id on provider_message_id only; sync later
  // sets gmail_message_id. Match RFC Message-ID so we do not double-log.
  if (type === "email" && rfcMessageId) {
    const existingByRfc = await prisma.contactActivity.findFirst({
      where: { type: "email", rfcMessageId },
      orderBy: { createdAt: "asc" },
    });
    if (existingByRfc) {
      const patch: {
        gmailMessageId?: string;
        gmailThreadId?: string;
        providerMessageId?: string;
        providerThreadId?: string;
      } = {};
      if (gmailMessageId && !existingByRfc.gmailMessageId) {
        patch.gmailMessageId = gmailMessageId;
      }
      if (gmailThreadId && !existingByRfc.gmailThreadId) {
        patch.gmailThreadId = gmailThreadId;
      }
      if (providerMessageId && !existingByRfc.providerMessageId) {
        patch.providerMessageId = providerMessageId;
      }
      if (providerThreadId && !existingByRfc.providerThreadId) {
        patch.providerThreadId = providerThreadId;
      }
      if (Object.keys(patch).length > 0) {
        const updated = await prisma.contactActivity.update({
          where: { id: existingByRfc.id },
          data: patch,
        });
        return toView(updated);
      }
      return toView(existingByRfc);
    }
  }

  try {
    const row = await prisma.contactActivity.create({
      data: {
        organizationId,
        contactId,
        type,
        folder: input.folder ?? "inbox",
        threadId: input.threadId ?? undefined,
        gmailMessageId: gmailMessageId ?? undefined,
        gmailThreadId: gmailThreadId ?? undefined,
        providerMessageId: providerMessageId ?? undefined,
        providerThreadId: providerThreadId ?? undefined,
        mailProvider: input.mailProvider ?? undefined,
        rfcMessageId: rfcMessageId ?? undefined,
        emailDirection: input.emailDirection ?? undefined,
        subject,
        body: input.body?.trim() || null,
        dueAt: input.dueAt ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });

    if (!row.threadId) {
      const updated = await prisma.contactActivity.update({
        where: { id: row.id },
        data: { threadId: row.id },
      });
      return toView(updated);
    }

    return toView(row);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "P2002" && gmailMessageId) {
      const existing = await prisma.contactActivity.findUnique({
        where: { gmailMessageId },
      });
      if (existing) return toView(existing);
    }
    throw err;
  }
}

export type UpcomingMeetingRow = {
  id: string;
  contactId: string;
  subject: string;
  body: string | null;
  dueAt: Date | null;
  createdByUserId: string | null;
  providerMessageId: string | null;
};

/** Next still-open future meeting for this contact (reschedule target). */
export async function findUpcomingMeetingForContact(
  contactId: string,
): Promise<UpcomingMeetingRow | null> {
  const now = new Date();
  const windowEnd = new Date(Date.now() + 14 * 24 * 60 * 60_000);
  const row = await prisma.contactActivity.findFirst({
    where: {
      contactId,
      type: "meeting",
      missEscalatedAt: null,
      completedAt: null,
      dueAt: { gt: now, lte: windowEnd },
    },
    orderBy: { dueAt: "asc" },
    select: {
      id: true,
      contactId: true,
      subject: true,
      body: true,
      dueAt: true,
      createdByUserId: true,
      providerMessageId: true,
    },
  });
  if (!row) return null;
  return {
    ...row,
    createdByUserId: row.createdByUserId != null ? String(row.createdByUserId) : null,
  };
}

export async function updateContactMeetingSchedule(
  activityId: string,
  input: {
    dueAt: Date;
    body: string;
    subject?: string;
    providerMessageId?: string | null;
    reminder24hSentAt?: Date | null;
    reminder1hSentAt?: Date | null;
    reminderSentAt?: Date | null;
  },
): Promise<ContactActivityView> {
  const data = {
    dueAt: input.dueAt,
    body: input.body,
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.providerMessageId !== undefined
      ? { providerMessageId: input.providerMessageId }
      : {}),
    reminder24hSentAt: input.reminder24hSentAt ?? null,
    reminder1hSentAt: input.reminder1hSentAt ?? null,
    reminderSentAt: input.reminderSentAt ?? null,
  };
  try {
    const row = await prisma.contactActivity.update({
      where: { id: activityId },
      data,
    });
    return toView(row);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "P2002" && input.providerMessageId) {
      const { providerMessageId: _ignored, ...withoutProviderId } = data;
      void _ignored;
      const row = await prisma.contactActivity.update({
        where: { id: activityId },
        data: withoutProviderId,
      });
      return toView(row);
    }
    throw err;
  }
}

/** Close replaced meetings after a reschedule so only the new slot stays live. */
export async function completeSupersededMeetings(input: {
  contactId: string;
  keepActivityId: string;
  /** Prefer completing these ids first (the meeting that was rescheduled). */
  supersedeActivityIds?: string[];
}): Promise<number> {
  const explicit = (input.supersedeActivityIds ?? []).filter(
    (id) => id && id !== input.keepActivityId,
  );
  let count = 0;
  if (explicit.length > 0) {
    const result = await prisma.contactActivity.updateMany({
      where: {
        contactId: input.contactId,
        type: "meeting",
        id: { in: explicit },
        completedAt: null,
      },
      data: { completedAt: new Date() },
    });
    count += result.count;
  }
  // Also close any other still-open meetings for this contact (one live slot).
  const rest = await prisma.contactActivity.updateMany({
    where: {
      contactId: input.contactId,
      type: "meeting",
      id: { not: input.keepActivityId },
      completedAt: null,
      dueAt: { not: null },
    },
    data: { completedAt: new Date() },
  });
  count += rest.count;
  return count;
}

/** @deprecated Prefer completeSupersededMeetings — kept for callers/tests. */
export async function completeSupersededSameDayMeetings(input: {
  contactId: string;
  keepActivityId: string;
  around: Date;
}): Promise<number> {
  void input.around;
  return completeSupersededMeetings({
    contactId: input.contactId,
    keepActivityId: input.keepActivityId,
  });
}

export async function updateTaskStatus(
  activityId: string,
  taskStatus: TaskStatus,
  options?: { actorUserId?: string | null },
): Promise<ContactActivityView> {
  if (!TASK_STATUSES.includes(taskStatus)) {
    throw new Error("Invalid task status.");
  }

  const existing = await prisma.contactActivity.findUnique({
    where: { id: activityId },
  });
  if (!existing) throw new Error("Activity not found.");
  if (existing.type !== "task") {
    throw new Error("Only tasks have a workflow status.");
  }

  const row = await prisma.contactActivity.update({
    where: { id: activityId },
    data: {
      taskStatus,
      completedAt: taskStatus === "completed" ? new Date() : null,
    },
  });
  void options;
  publishLeadSummaryEvent({ contactId: row.contactId, reason: "task_status" });
  return toView(row);
}

export async function updateContactActivityDraft(
  activityId: string,
  input: {
    contactId?: string;
    subject: string;
    body?: string | null;
  },
): Promise<ContactActivityView> {
  const subject = input.subject.trim();
  if (!subject) throw new Error("Activity subject is required.");

  const existing = await prisma.contactActivity.findUnique({
    where: { id: activityId },
  });
  if (!existing) throw new Error("Activity not found.");
  if (existing.folder === "trash") {
    throw new Error("Draft was discarded.");
  }

  const row = await prisma.contactActivity.update({
    where: { id: activityId },
    data: {
      contactId: input.contactId ?? existing.contactId,
      subject,
      body: input.body?.trim() || null,
      // Never resurrect a trashed/sent item by forcing folder back to draft.
      ...(existing.folder === "draft" ? { folder: "draft" as const } : {}),
    },
  });
  return toView(row);
}

export async function updateContactActivityFolder(
  activityId: string,
  folder: InboxFolder,
): Promise<ContactActivityView> {
  const existing = await prisma.contactActivity.findUnique({
    where: { id: activityId },
  });
  if (!existing) throw new Error("Activity not found.");

  // Reply drafts share threadId with the live conversation. Discarding a
  // draft must not move the whole thread to trash.
  if (existing.folder === "draft") {
    const row = await prisma.contactActivity.update({
      where: { id: activityId },
      data: { folder },
    });
    return toView(row);
  }

  if (existing.threadId) {
    await prisma.contactActivity.updateMany({
      where: { threadId: existing.threadId },
      data: { folder },
    });
    const row = await prisma.contactActivity.findUniqueOrThrow({
      where: { id: activityId },
    });
    return toView(row);
  }

  const row = await prisma.contactActivity.update({
    where: { id: activityId },
    data: { folder },
  });
  return toView(row);
}

/** Permanently delete a trashed activity (and its thread siblings). */
export async function purgeContactActivityFromTrash(
  activityId: string,
): Promise<{ id: string; contactId: string }> {
  const existing = await prisma.contactActivity.findUnique({
    where: { id: activityId },
  });
  if (!existing) throw new Error("Activity not found.");
  if (existing.folder !== "trash") {
    throw new Error("Only items in Trash can be deleted forever.");
  }

  const contactId = existing.contactId;
  if (existing.threadId) {
    await prisma.contactActivity.deleteMany({
      where: { threadId: existing.threadId, folder: "trash" },
    });
  } else {
    await prisma.contactActivity.delete({ where: { id: activityId } });
  }
  publishLeadSummaryEvent({ contactId, reason: "delete" });
  return { id: activityId, contactId };
}

export async function deleteContactActivity(
  contactId: string,
  activityId: string,
): Promise<void> {
  const existing = await prisma.contactActivity.findFirst({
    where: { id: activityId, contactId },
  });
  if (!existing) throw new Error("Activity not found.");
  await prisma.contactActivity.delete({ where: { id: activityId } });
  publishLeadSummaryEvent({ contactId, reason: "delete" });
}

export async function deleteActivitiesForContact(
  contactId: string,
): Promise<void> {
  await prisma.contactActivity.deleteMany({ where: { contactId } });
}
