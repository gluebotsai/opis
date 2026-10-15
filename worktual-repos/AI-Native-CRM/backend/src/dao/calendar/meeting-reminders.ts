import { prisma } from "@/dao/db/prisma";
import { resolveCrmMeetingParticipants } from "@/dao/calendar/meeting-reminder-participants";
import { writeAuditLog } from "@/dao/audit/audit-log";
import {
  sendMeetingNotificationEmail,
  type MeetingReminderWindow,
} from "@/service/calendar/meeting-mail";
import {
  composeMeetingParticipantReminder,
  buildMeetingBriefContext,
  sendMeetingReminderBriefToOwner,
} from "@/service/ai/meeting-brief";
import { resolveSetupUserDeliveryEmail } from "@/service/account/setup-users";
import { resolveEmailSendProvider } from "@/service/email/send-connected-email";

async function auditMeetingReminder(input: {
  organizationId: string;
  activityId: string;
  actorUserId: string | null;
  window: MeetingReminderWindow;
  leg: "owner" | "customer";
  outcome: "sent" | "skipped" | "failed";
  contactId?: string | null;
}): Promise<void> {
  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "update",
    entityType: "contact_activity",
    entityId: input.activityId,
    organizationId: input.organizationId,
    meta: {
      agent: "meeting_reminder",
      window: input.window,
      leg: input.leg,
      outcome: input.outcome,
      contactId: input.contactId ?? null,
    },
  });
}

/** ±7.5 min — cron runs every 5 min; wider window avoids missing T−1h by seconds. */
const REMINDER_WINDOW_MS = 15 * 60_000;
const ONE_HOUR_MS = 60 * 60_000;
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;

export type MeetingReminderSweepResult = {
  checked24h: number;
  checked1h: number;
  ownerSent: number;
  customerSent: number;
  errors: string[];
};

/**
 * Dual-window meeting reminder agent:
 * - T−24h and T−1h
 * - Owner: AI 360 participant brief
 * - Customers: AI personalized don’t-miss emails (no blank templates)
 * Never skips Google Calendar–linked meetings.
 * Safe to call frequently (e.g. every 5 minutes via cron).
 */
export async function processMeetingReminders(): Promise<MeetingReminderSweepResult> {
  const errors: string[] = [];
  let ownerSent = 0;
  let customerSent = 0;

  const r24 = await processWindow("24h", errors);
  ownerSent += r24.ownerSent;
  customerSent += r24.customerSent;

  const r1 = await processWindow("1h", errors);
  ownerSent += r1.ownerSent;
  customerSent += r1.customerSent;

  return {
    checked24h: r24.checked,
    checked1h: r1.checked,
    ownerSent,
    customerSent,
    errors,
  };
}

async function processWindow(
  window: MeetingReminderWindow,
  errors: string[],
): Promise<{ checked: number; ownerSent: number; customerSent: number }> {
  const now = Date.now();
  const offset = window === "24h" ? TWENTY_FOUR_HOURS_MS : ONE_HOUR_MS;
  const windowStart = new Date(now + offset - REMINDER_WINDOW_MS / 2);
  const windowEnd = new Date(now + offset + REMINDER_WINDOW_MS / 2);

  const flagField =
    window === "24h" ? "reminder24hSentAt" : "reminder1hSentAt";

  const meetings = await prisma.contactActivity.findMany({
    where: {
      type: "meeting",
      [flagField]: null,
      dueAt: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
    take: 50,
  });

  let ownerSent = 0;
  let customerSent = 0;

  for (const meeting of meetings) {
    const markDone = async () => {
      const nowTs = new Date();
      await prisma.contactActivity.update({
        where: { id: meeting.id },
        data: {
          [flagField]: nowTs,
          ...(window === "1h" ? { reminderSentAt: nowTs } : {}),
        },
      });
    };

    if (!meeting.dueAt) {
      await markDone();
      continue;
    }

    const briefCtx = await buildMeetingBriefContext(
      meeting.id,
      meeting.organizationId,
    );
    const assignedOwnerId =
      briefCtx?.ownerUserId?.trim() || null;
    const senderUserId =
      assignedOwnerId || meeting.createdByUserId?.trim() || null;
    if (!senderUserId) {
      errors.push(`${meeting.id}/${window}: no assigned owner or meeting creator`);
      await markDone();
      continue;
    }

    const ownerDelivery = await resolveSetupUserDeliveryEmail(
      senderUserId,
      meeting.organizationId,
    );
    const provider = await resolveEmailSendProvider(senderUserId, null);
    if (!provider || !ownerDelivery?.email) {
      errors.push(
        `${meeting.id}/${window}: assigned rep has no connected email that can send`,
      );
      // Transient — retry next cron until they connect (or meeting passes window)
      continue;
    }

    const organizerEmail = ownerDelivery.email.toLowerCase();
    const organizerName = ownerDelivery.displayName;

    // --- Owner AI 360 brief ---
    let ownerOk = false;
    let ownerPermanent = false;
    try {
      const ownerResult = await sendMeetingReminderBriefToOwner({
        activityId: meeting.id,
        contactId: meeting.contactId,
        window,
        organizationId: meeting.organizationId,
        senderUserId,
      });
      if (ownerResult.ok) {
        ownerOk = true;
        ownerSent += 1;
        await auditMeetingReminder({
          organizationId: meeting.organizationId,
          activityId: meeting.id,
          actorUserId: senderUserId,
          window,
          leg: "owner",
          outcome: "sent",
          contactId: meeting.contactId,
        });
      } else {
        ownerPermanent = Boolean(ownerResult.permanent);
        if (ownerResult.reason === "owner_email_missing") {
          ownerPermanent = true;
        }
        errors.push(
          `${meeting.id}/${window}/owner: ${ownerResult.reason || "failed"}`,
        );
        await auditMeetingReminder({
          organizationId: meeting.organizationId,
          activityId: meeting.id,
          actorUserId: senderUserId,
          window,
          leg: "owner",
          outcome: ownerPermanent ? "skipped" : "failed",
          contactId: meeting.contactId,
        });
      }
    } catch (err) {
      errors.push(
        `${meeting.id}/${window}/owner: ${
          err instanceof Error ? err.message : "owner brief failed"
        }`,
      );
      await auditMeetingReminder({
        organizationId: meeting.organizationId,
        activityId: meeting.id,
        actorUserId: senderUserId,
        window,
        leg: "owner",
        outcome: "failed",
        contactId: meeting.contactId,
      });
    }

    // --- Customer don’t-miss emails (AI personalized) ---
    const participants = await resolveCrmMeetingParticipants({
      contactId: meeting.contactId,
      body: meeting.body,
      organizerEmail,
    });

    let customerFailures = 0;
    let mailboxBroken = false;

    for (const participant of participants) {
      const composed = await composeMeetingParticipantReminder({
        activityId: meeting.id,
        contactId: meeting.contactId,
        window,
        organizationId: meeting.organizationId,
        participantFirstName: participant.firstName,
        organizerName,
      });
      if (!composed.ok || !composed.subject || !composed.body) {
        customerFailures += 1;
        errors.push(
          `${meeting.id}/${window}/customer:${participant.contactId}: ${
            composed.reason || "llm_compose_failed"
          }`,
        );
        await auditMeetingReminder({
          organizationId: meeting.organizationId,
          activityId: meeting.id,
          actorUserId: senderUserId,
          window,
          leg: "customer",
          outcome: "failed",
          contactId: participant.contactId,
        });
        continue;
      }

      const result = await sendMeetingNotificationEmail({
        userId: senderUserId,
        contactId: participant.contactId,
        to: participant.email,
        subject: composed.subject,
        body: composed.body,
        preferredProvider: null,
      });
      if (!result.ok) {
        customerFailures += 1;
        errors.push(
          `${meeting.id}/${window}/customer:${participant.contactId}: ${result.error}`,
        );
        await auditMeetingReminder({
          organizationId: meeting.organizationId,
          activityId: meeting.id,
          actorUserId: senderUserId,
          window,
          leg: "customer",
          outcome: "failed",
          contactId: participant.contactId,
        });
        if (result.needsConnect) {
          mailboxBroken = true;
          break;
        }
      } else {
        customerSent += 1;
        await auditMeetingReminder({
          organizationId: meeting.organizationId,
          activityId: meeting.id,
          actorUserId: senderUserId,
          window,
          leg: "customer",
          outcome: "sent",
          contactId: participant.contactId,
        });
      }
    }

    // Mark window complete when owner leg is done and customers all succeeded
    // (or there were no CRM participants). Leave unset on transient failures.
    const ownerDone = ownerOk || ownerPermanent;
    const customersDone = !mailboxBroken && customerFailures === 0;
    if (ownerDone && customersDone) {
      await markDone();
    }
  }

  return { checked: meetings.length, ownerSent, customerSent };
}
