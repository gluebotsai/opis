import { sendConnectedEmailForUser } from "@/service/email/send-connected-email";
import { formatEmailDeliveryFailure } from "@/lib/email-delivery-error";
import { createContactActivity } from "@/dao/contacts/contact-activity-service";
import { notifyAdminsOfLeadEventAsync } from "@/dao/notifications/notify-admins";

export type TransactionalEmailResult =
  | { ok: true; via: string }
  | { ok: false; error: string; needsConnect?: boolean };

/**
 * Send a simple transactional email via the user's connected inbox.
 * Optionally logs a sent email activity on the contact.
 */
export async function sendTransactionalEmail(args: {
  userId: string;
  to: string;
  subject: string;
  body: string;
  contactId?: string | null;
  attachments?: {
    filename: string;
    contentType: string;
    content: string | Buffer;
  }[];
}): Promise<TransactionalEmailResult> {
  const to = args.to.trim();
  if (!to) {
    return { ok: false, error: "No recipient email address." };
  }

  const result = await sendConnectedEmailForUser({
    userId: args.userId,
    to,
    subject: args.subject,
    body: args.body,
    attachments: args.attachments,
  });

  if (!result.ok) {
    const formatted = formatEmailDeliveryFailure(result.error, {
      needsConnect: result.needsConnect,
    });
    return {
      ok: false,
      error: formatted.message,
      needsConnect: formatted.needsConnect,
    };
  }

  if (args.contactId) {
    try {
      const activity = await createContactActivity(args.contactId, {
        type: "email",
        subject: args.subject,
        body: args.body,
        folder: "sent",
        emailDirection: "outbound",
        createdByUserId: args.userId,
        providerThreadId: result.threadId ?? undefined,
        gmailThreadId: result.threadId ?? undefined,
        rfcMessageId: result.rfcMessageId ?? undefined,
        providerMessageId: result.messageId ?? undefined,
      });
      notifyAdminsOfLeadEventAsync({
        kind: "lead_activity",
        contactId: args.contactId,
        actorUserId: args.userId,
        activityType: "email",
        activitySubject: activity.subject,
      });
    } catch {
      // Delivery succeeded; activity log is best-effort.
    }
  }

  return { ok: true, via: result.via };
}
