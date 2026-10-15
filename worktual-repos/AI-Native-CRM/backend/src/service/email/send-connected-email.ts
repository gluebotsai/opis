import { sendGoogleEmailForUser } from "@/service/google/send-email";
import { sendMicrosoftEmailForUser } from "@/service/microsoft/send-email";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import { googleHasGmailSendScope } from "@/service/google/access-token";
import {
  isMicrosoftGuestMailbox,
  microsoftHasMailSendScope,
} from "@/service/microsoft/oauth";
import {
  getPreferredEmailProvider,
  type ConnectedEmailProvider,
} from "@/service/email/preferred-provider";
import { validateOutboundEmailContent } from "@/lib/outbound-email-guard";

export type { ConnectedEmailProvider };

export type SendConnectedEmailResult =
  | {
      ok: true;
      via: ConnectedEmailProvider;
      fromEmail: string | null;
      messageId?: string;
      threadId?: string;
      rfcMessageId?: string | null;
    }
  | { ok: false; error: string; needsConnect?: boolean };

async function providerCanSend(
  userId: string,
  provider: ConnectedEmailProvider,
): Promise<boolean> {
  const conn = await getCalendarConnection(userId, provider);
  if (!conn) return false;
  if (provider === "google") return googleHasGmailSendScope(conn.scope);
  return (
    microsoftHasMailSendScope(conn.scope) &&
    !isMicrosoftGuestMailbox(conn.accountEmail)
  );
}

/** Prefer user's preferred provider, else most recently connected that can send.
 * Pass `preferred: null` to skip cookie lookup (safe for cron / background jobs).
 * Omit / undefined to try the request cookie first.
 */
export async function resolveEmailSendProvider(
  userId: string,
  preferred?: ConnectedEmailProvider | null,
): Promise<ConnectedEmailProvider | null> {
  const preferredOrCookie =
    preferred !== undefined
      ? preferred
      : await getPreferredEmailProvider().catch(() => null);

  if (preferredOrCookie) {
    if (await providerCanSend(userId, preferredOrCookie)) {
      return preferredOrCookie;
    }
  }

  const candidates: { provider: ConnectedEmailProvider; updatedAt: number }[] =
    [];

  for (const provider of ["google", "microsoft"] as const) {
    const conn = await getCalendarConnection(userId, provider);
    if (!conn) continue;
    if (!(await providerCanSend(userId, provider))) continue;
    candidates.push({
      provider,
      updatedAt: conn.updatedAt?.getTime?.() ?? 0,
    });
  }

  candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0]?.provider ?? null;
}

export async function sendConnectedEmailForUser(args: {
  userId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
  preferredProvider?: ConnectedEmailProvider | null;
  gmailThreadId?: string | null;
  inReplyToRfcMessageId?: string | null;
  inReplyToGmailMessageId?: string | null;
  references?: string | null;
  attachments?: {
    filename: string;
    contentType: string;
    content: string | Buffer;
  }[];
}): Promise<SendConnectedEmailResult> {
  const contentCheck = validateOutboundEmailContent({
    subject: args.subject,
    body: args.body,
  });
  if (!contentCheck.ok) {
    return { ok: false, error: contentCheck.error };
  }

  const via = await resolveEmailSendProvider(
    args.userId,
    args.preferredProvider !== undefined
      ? args.preferredProvider
      : undefined,
  );

  if (!via) {
    return {
      ok: false,
      error:
        "Connect an email account in Configuration → Email (Google or Microsoft).",
      needsConnect: true,
    };
  }

  if (via === "google") {
    const result = await sendGoogleEmailForUser({
      userId: args.userId,
      to: args.to,
      subject: args.subject,
      body: args.body,
      cc: args.cc,
      gmailThreadId: args.gmailThreadId,
      inReplyToRfcMessageId: args.inReplyToRfcMessageId,
      inReplyToGmailMessageId: args.inReplyToGmailMessageId,
      references: args.references,
      attachments: args.attachments,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        needsConnect: result.needsConnect,
      };
    }
    return {
      ok: true,
      via: "google",
      fromEmail: result.fromEmail,
      messageId: result.messageId,
      threadId: result.threadId,
      rfcMessageId: result.rfcMessageId,
    };
  }

  const result = await sendMicrosoftEmailForUser({
    userId: args.userId,
    to: args.to,
    subject: args.subject,
    body: args.body,
    cc: args.cc,
    attachments: args.attachments,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      needsConnect: result.needsConnect,
    };
  }
  return { ok: true, via: "microsoft", fromEmail: result.fromEmail };
}
