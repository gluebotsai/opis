import { getGmailMessage, sendGmailMessage, type SendGmailAttachment } from "@/service/google/gmail";
import {
  getValidGoogleAccessToken,
  googleHasGmailSendScope,
  isGoogleConfigured,
} from "@/service/google/access-token";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import { formatEmailDeliveryFailure } from "@/lib/email-delivery-error";

function displayNameFromEmail(email: string | null | undefined): string | null {
  if (!email?.includes("@")) return null;
  const local = email.split("@")[0]?.replace(/[._+-]/g, " ").trim();
  return local || null;
}

export async function sendGoogleEmailForUser(args: {
  userId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
  gmailThreadId?: string | null;
  inReplyToRfcMessageId?: string | null;
  /** Fallback: look up RFC Message-ID from a stored Gmail API message id */
  inReplyToGmailMessageId?: string | null;
  references?: string | null;
  attachments?: SendGmailAttachment[];
}): Promise<
  | {
      ok: true;
      messageId: string;
      threadId: string;
      rfcMessageId: string | null;
      fromEmail: string | null;
    }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  if (!isGoogleConfigured()) {
    return {
      ok: false,
      error:
        "Google is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    };
  }

  const conn = await getCalendarConnection(args.userId, "google");
  if (!conn) {
    return {
      ok: false,
      error: "Connect Google in Configuration → Email first.",
      needsConnect: true,
    };
  }

  if (!googleHasGmailSendScope(conn.scope)) {
    return {
      ok: false,
      error:
        "Reconnect Google to grant Gmail send permission (Configuration → Email).",
      needsConnect: true,
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await getValidGoogleAccessToken(args.userId);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to refresh Google access token.",
      needsConnect: true,
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      error: "Connect Google in Configuration → Email first.",
      needsConnect: true,
    };
  }

  let inReplyToRfc = args.inReplyToRfcMessageId ?? null;
  if (!inReplyToRfc && args.inReplyToGmailMessageId) {
    try {
      const parent = await getGmailMessage({
        accessToken,
        messageId: args.inReplyToGmailMessageId,
      });
      inReplyToRfc = parent.rfcMessageId;
    } catch {
      // continue without — Gmail may still thread via threadId
    }
  }

  try {
    const result = await sendGmailMessage({
      accessToken,
      to: args.to,
      subject: args.subject,
      body: args.body,
      cc: args.cc,
      fromEmail: conn.accountEmail,
      fromName: displayNameFromEmail(conn.accountEmail),
      threadId: args.gmailThreadId,
      inReplyToRfcMessageId: inReplyToRfc,
      references: args.references,
      attachments: args.attachments,
    });
    return {
      ok: true,
      messageId: result.id,
      threadId: result.threadId,
      rfcMessageId: result.rfcMessageId,
      fromEmail: conn.accountEmail,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Failed to send email via Gmail.";
    const { message, needsConnect } = formatEmailDeliveryFailure(raw);
    return {
      ok: false,
      error: message,
      needsConnect,
    };
  }
}
