import { prisma } from "@/dao/db/prisma";
import { withUser } from "@/middlewares/auth";
import { getServerUserId } from "@/service/account/session-cookie";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import {
  sendInboxEmailCommand,
  updateInboxFolderCommand,
} from "@/service/inbox/inbox-commands";

export type ScheduleOutboundInput = {
  to: string;
  subject: string;
  body: string;
  contactId?: string | null;
  draftId?: string | null;
  sendAt: string;
};

function parseSendAt(raw: string): Date | null {
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return null;
  return when;
}

export async function scheduleOutboundEmailCommand(input: ScheduleOutboundInput) {
  const userId = await getServerUserId();
  if (!userId) return { ok: false as const, error: "Sign in again." };
  const to = input.to.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!to || !subject || !body) {
    return { ok: false as const, error: "To, subject, and body are required." };
  }
  const sendAt = parseSendAt(input.sendAt);
  if (!sendAt) return { ok: false as const, error: "That send time is not valid." };
  if (sendAt.getTime() <= Date.now() + 30_000) {
    return {
      ok: false as const,
      error: "Pick a time at least a minute from now, or send it now.",
    };
  }

  let organizationId: bigint;
  try {
    organizationId = BigInt(await resolveRequestOrganizationId());
  } catch {
    return { ok: false as const, error: "Organization is missing." };
  }
  let mailboxUserId: bigint;
  try {
    mailboxUserId = BigInt(userId);
  } catch {
    return { ok: false as const, error: "This mailbox user cannot schedule email." };
  }

  const draftActivityId = input.draftId?.trim() || null;
  const existing = draftActivityId
    ? await prisma.scheduledOutboundEmail.findFirst({
        where: {
          draftActivityId,
          mailboxUserId,
          status: "scheduled",
        },
      })
    : null;

  const data = {
    organizationId,
    mailboxUserId,
    contactId: input.contactId?.trim() || null,
    draftActivityId,
    toEmail: to,
    subject: subject.slice(0, 500),
    body,
    sendAt,
    status: "scheduled",
    lastError: null,
  };

  const row = existing
    ? await prisma.scheduledOutboundEmail.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.scheduledOutboundEmail.create({ data });

  return {
    ok: true as const,
    id: row.id,
    sendAt: row.sendAt.toISOString(),
  };
}

export async function cancelScheduledOutboundEmailCommand(input: {
  id?: string | null;
  draftId?: string | null;
}) {
  const userId = await getServerUserId();
  if (!userId) return { ok: false as const, error: "Sign in again." };
  let mailboxUserId: bigint;
  try {
    mailboxUserId = BigInt(userId);
  } catch {
    return { ok: false as const, error: "This mailbox user cannot cancel a scheduled email." };
  }
  const id = input.id?.trim();
  const draftId = input.draftId?.trim();
  if (!id && !draftId) {
    return { ok: false as const, error: "Scheduled email is missing." };
  }
  const where = id
    ? { id, mailboxUserId, status: "scheduled" }
    : { draftActivityId: draftId, mailboxUserId, status: "scheduled" };
  const updated = await prisma.scheduledOutboundEmail.updateMany({
    where,
    data: { status: "cancelled" },
  });
  return { ok: true as const, cancelled: updated.count };
}

export async function processDueScheduledOutboundEmails(limit = 25) {
  const due = await prisma.scheduledOutboundEmail.findMany({
    where: { status: "scheduled", sendAt: { lte: new Date() } },
    orderBy: { sendAt: "asc" },
    take: limit,
  });
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const userId = String(row.mailboxUserId);
    const result = await withUser(userId, () =>
      sendInboxEmailCommand({
        contactId: row.contactId ?? undefined,
        to: row.toEmail,
        subject: row.subject,
        body: row.body,
      }),
    );
    if (result.ok) {
      sent += 1;
      await prisma.scheduledOutboundEmail.update({
        where: { id: row.id },
        data: { status: "sent", sentAt: new Date(), lastError: null },
      });
      if (row.draftActivityId) {
        await withUser(userId, () =>
          updateInboxFolderCommand(row.draftActivityId!, "trash"),
        );
      }
    } else {
      failed += 1;
      await prisma.scheduledOutboundEmail.update({
        where: { id: row.id },
        data: { status: "failed", lastError: result.error.slice(0, 500) },
      });
    }
  }
  return { scanned: due.length, sent, failed };
}
