import { prisma } from "@/dao/db/prisma";
import { sendConnectedEmailForUser } from "@/service/email/send-connected-email";
import { formatMeetingWhenLabel } from "@/service/calendar/meeting-mail";
import {
  displayNameFromSetupUser,
  getSetupUserById,
  resolveSetupUserDeliveryEmail,
} from "@/service/account/setup-users";

const REMINDER_WINDOW_MS = 10 * 60_000; // ±5 min around the 1-hour mark
const ONE_HOUR_MS = 60 * 60_000;

/**
 * Email task assignees ~1 hour before dueAt.
 * Safe to call frequently (e.g. every 5 minutes via the meeting-reminders cron).
 */
export async function processTaskReminders(): Promise<{
  checked: number;
  sent: number;
  errors: string[];
}> {
  const now = Date.now();
  const windowStart = new Date(now + ONE_HOUR_MS - REMINDER_WINDOW_MS / 2);
  const windowEnd = new Date(now + ONE_HOUR_MS + REMINDER_WINDOW_MS / 2);

  const tasks = await prisma.contactActivity.findMany({
    where: {
      type: "task",
      reminderSentAt: null,
      taskStatus: { not: "completed" },
      dueAt: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
    take: 50,
  });

  let sent = 0;
  const errors: string[] = [];

  for (const task of tasks) {
    if (!task.dueAt || !task.assigneeUserId) {
      await prisma.contactActivity.update({
        where: { id: task.id },
        data: { reminderSentAt: new Date() },
      });
      continue;
    }

    const senderUserId = task.createdByUserId ?? task.assigneeUserId;
    const orgId = String(task.organizationId);
    const assigneeDelivery = await resolveSetupUserDeliveryEmail(
      String(task.assigneeUserId),
      orgId,
    );
    if (!assigneeDelivery?.email) {
      errors.push(`${task.id}: assignee has no delivery email`);
      await prisma.contactActivity.update({
        where: { id: task.id },
        data: { reminderSentAt: new Date() },
      });
      continue;
    }

    const assigneeUser = await getSetupUserById(String(task.assigneeUserId));
    const assigneeName =
      (assigneeUser
        ? displayNameFromSetupUser(assigneeUser)
        : assigneeDelivery.displayName) ||
      assigneeDelivery.email.split("@")[0] ||
      "there";

    const { getPeopleByIds } = await import("@/dao/account/account-repository");
    const [person] = await getPeopleByIds([task.contactId]);
    const contactName = person
      ? [person.firstName, person.lastName].filter(Boolean).join(" ").trim() ||
        "contact"
      : "contact";

    const whenLabel = formatMeetingWhenLabel(
      task.dueAt,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
    const subject = `Reminder: ${task.subject}`;
    const body = [
      `Hi ${assigneeName},`,
      "",
      `This is a reminder that your CRM task is due in about an hour.`,
      "",
      `Task: ${task.subject}`,
      `Due: ${whenLabel}`,
      `Contact: ${contactName}`,
      task.body?.trim() ? `\nDetails:\n${task.body.trim()}` : "",
      "",
      `Open the contact in CRM to mark it complete.`,
    ]
      .filter((line) => line !== undefined)
      .join("\n");

    const result = await sendConnectedEmailForUser({
      userId: senderUserId,
      to: assigneeDelivery.email,
      subject,
      body,
    });

    if (!result.ok) {
      errors.push(`${task.id}: ${result.error}`);
      continue;
    }

    await prisma.contactActivity.update({
      where: { id: task.id },
      data: { reminderSentAt: new Date() },
    });
    sent += 1;
  }

  return { checked: tasks.length, sent, errors };
}
