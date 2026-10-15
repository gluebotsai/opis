import {
  microsoftHasMailSendScope,
  refreshMicrosoftAccessToken,
  isMicrosoftOAuthConfigured,
  isMicrosoftGuestMailbox,
} from "@/service/microsoft/oauth";
import {
  getCalendarConnection,
  updateCalendarTokens,
} from "@/dao/calendar/token-repository";

export async function getValidMicrosoftAccessToken(
  userId: string,
  opts?: { forceRefresh?: boolean },
): Promise<string | null> {
  const conn = await getCalendarConnection(userId, "microsoft");
  if (!conn) return null;

  const expiresAt = conn.tokenExpiresAt?.getTime() ?? 0;
  const stillValid = expiresAt > Date.now() + 60_000;
  if (stillValid && !opts?.forceRefresh) return conn.accessToken;

  if (!conn.refreshToken) {
    return stillValid ? conn.accessToken : null;
  }

  const refreshed = await refreshMicrosoftAccessToken(conn.refreshToken);
  const tokenExpiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000)
    : null;
  await updateCalendarTokens(userId, "microsoft", {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? null,
    tokenExpiresAt,
  });
  return refreshed.access_token;
}

function formatGraphError(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string };
    };
    const msg = parsed.error?.message;
    const code = parsed.error?.code;
    if (msg) detail = code ? `${code}: ${msg}` : msg;
  } catch {
    // keep raw body
  }
  if (!detail) detail = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "No details";
  return `Microsoft send failed (${status}): ${detail}`;
}

async function graphSendMail(
  accessToken: string,
  args: {
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    attachments?: { filename: string; contentType: string; content: string | Buffer }[];
  },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { toOutboundEmailBodies } = await import("@/lib/outbound-email");
  const message: Record<string, unknown> = {
    subject: args.subject,
    body: {
      contentType: "HTML",
      content: toOutboundEmailBodies(args.body).html,
    },
    toRecipients: args.to.map((address) => ({
      emailAddress: { address },
    })),
  };
  if (args.cc.length) {
    message.ccRecipients = args.cc.map((address) => ({
      emailAddress: { address },
    }));
  }
  if (args.attachments?.length) {
    message.attachments = args.attachments.map((file) => {
      const bytes = Buffer.isBuffer(file.content)
        ? file.content
        : Buffer.from(file.content, "utf8");
      return {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: file.filename,
        contentType: file.contentType,
        contentBytes: bytes.toString("base64"),
      };
    });
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (res.ok || res.status === 202) {
    return { ok: true };
  }

  const text = await res.text();
  return { ok: false, status: res.status, error: formatGraphError(res.status, text) };
}

export async function sendMicrosoftEmailForUser(args: {
  userId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
  attachments?: {
    filename: string;
    contentType: string;
    content: string | Buffer;
  }[];
}): Promise<
  | { ok: true; fromEmail: string | null }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  if (!isMicrosoftOAuthConfigured()) {
    return {
      ok: false,
      error:
        "Microsoft is not configured. Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.",
    };
  }

  const conn = await getCalendarConnection(args.userId, "microsoft");
  if (!conn) {
    return {
      ok: false,
      error: "Connect Microsoft in Configuration → Email first.",
      needsConnect: true,
    };
  }

  if (!microsoftHasMailSendScope(conn.scope)) {
    return {
      ok: false,
      error:
        "Reconnect Microsoft to grant Mail.Send permission (Configuration → Email).",
      needsConnect: true,
    };
  }

  if (isMicrosoftGuestMailbox(conn.accountEmail)) {
    return {
      ok: false,
      error:
        "Your Microsoft account is linked as a guest (#EXT#) and cannot send mail. Disconnect Microsoft in Configuration → Email, then Connect again and sign in with your Outlook/Hotmail mailbox (use a personal or work account that has a real inbox).",
      needsConnect: true,
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await getValidMicrosoftAccessToken(args.userId);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to refresh Microsoft access token.",
      needsConnect: true,
    };
  }

  if (!accessToken) {
    return {
      ok: false,
      error:
        "Microsoft session expired. Reconnect Microsoft in Configuration → Email.",
      needsConnect: true,
    };
  }

  const toList = args.to
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter(Boolean);
  const ccList = (args.cc ?? "")
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter(Boolean);

  if (toList.length === 0) {
    return { ok: false, error: "Enter at least one recipient email." };
  }

  let result = await graphSendMail(accessToken, {
    to: toList,
    cc: ccList,
    subject: args.subject,
    body: args.body,
    attachments: args.attachments,
  });

  // Retry once after forced token refresh on auth failures.
  if (!result.ok && (result.status === 401 || result.status === 403)) {
    try {
      const refreshed = await getValidMicrosoftAccessToken(args.userId, {
        forceRefresh: true,
      });
      if (refreshed) {
        result = await graphSendMail(refreshed, {
          to: toList,
          cc: ccList,
          subject: args.subject,
          body: args.body,
          attachments: args.attachments,
        });
      }
    } catch {
      // keep original error
    }
  }

  if (!result.ok) {
    return { ok: false, error: result.error, needsConnect: result.status === 401 };
  }

  return { ok: true, fromEmail: conn.accountEmail };
}

export {
  isMicrosoftOAuthConfigured,
  exchangeMicrosoftCode,
  fetchMicrosoftAccountEmail,
  microsoftHasMailSendScope,
  microsoftHasMailReadScope,
} from "@/service/microsoft/oauth";
