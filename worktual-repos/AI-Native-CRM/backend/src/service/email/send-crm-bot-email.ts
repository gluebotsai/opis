/**
 * Send email via the org CRM bot mailbox configured in Accounts
 * (setup_channel_configs product_ids ⊇ crm + setup_email_configs +
 * mail_oauth_connections). Used for proactive agent mail (e.g. nurture)
 * so we never impersonate a salesperson's connected inbox.
 */

import { accountQuery } from "@/dao/db/account-pool";
import {
  resolveCrmBotMailbox,
  type CrmBotMailbox,
} from "@/dao/account/crm-bot-mailbox";
import {
  accountsTokenEncryptionConfigured,
  decryptAccountsSecret,
  encryptAccountsSecret,
} from "@/service/account/accounts-token-crypto";
import { getGmailMessage, sendGmailMessage } from "@/service/google/gmail";
import { refreshMicrosoftAccessToken } from "@/service/microsoft/oauth";
import type { SendConnectedEmailResult } from "@/service/email/send-connected-email";
import { validateOutboundEmailContent } from "@/lib/outbound-email-guard";

const GOOGLE_REAUTH_ERRORS = new Set([
  "unauthorized_client",
  "invalid_client",
  "invalid_grant",
]);

type GoogleOauthClient = {
  clientId: string;
  clientSecret: string;
};

function googleOauthClients(): GoogleOauthClient[] {
  const out: GoogleOauthClient[] = [];
  const seen = new Set<string>();
  const push = (id?: string, secret?: string) => {
    const clientId = id?.trim();
    const clientSecret = secret?.trim();
    if (!clientId || !clientSecret) return;
    const key = `${clientId}\0${clientSecret}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ clientId, clientSecret });
  };
  // Accounts-connected mailbox first when that app is configured separately.
  push(
    process.env.ACCOUNTS_GOOGLE_CLIENT_ID,
    process.env.ACCOUNTS_GOOGLE_CLIENT_SECRET,
  );
  push(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  return out;
}

function parseGoogleOAuthError(body: string): {
  code: string;
  description: string;
} {
  try {
    const json = JSON.parse(body) as {
      error?: string;
      error_description?: string;
    };
    if (json.error?.trim()) {
      return {
        code: json.error.trim(),
        description: (json.error_description ?? "").trim(),
      };
    }
  } catch {
    /* not JSON */
  }
  return { code: "unknown", description: body.slice(0, 200) };
}

export const CRM_BOT_GMAIL_REAUTH_ERROR = "crm_bot_gmail_reauth";

async function refreshMicrosoftWithAccountsClient(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const clientId =
    process.env.ACCOUNTS_MICROSOFT_CLIENT_ID?.trim() ||
    process.env.MICROSOFT_CLIENT_ID?.trim();
  const clientSecret =
    process.env.ACCOUNTS_MICROSOFT_CLIENT_SECRET?.trim() ||
    process.env.MICROSOFT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Microsoft OAuth client is not configured for Accounts mailbox refresh.",
    );
  }
  if (
    process.env.ACCOUNTS_MICROSOFT_CLIENT_ID?.trim() ||
    process.env.ACCOUNTS_MICROSOFT_CLIENT_SECRET?.trim()
  ) {
    const res = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Microsoft token refresh failed: ${await res.text()}`);
    }
    return res.json() as Promise<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }>;
  }
  return refreshMicrosoftAccessToken(refreshToken);
}

async function refreshGoogleWithAccountsClient(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const clients = googleOauthClients();
  if (clients.length === 0) {
    throw new Error(
      "Google OAuth client is not configured for Accounts mailbox refresh.",
    );
  }

  let lastBody = "";
  for (const client of clients) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      return res.json() as Promise<{
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      }>;
    }
    lastBody = await res.text();
  }

  const parsed = parseGoogleOAuthError(lastBody);
  const err = new Error(
    GOOGLE_REAUTH_ERRORS.has(parsed.code)
      ? CRM_BOT_GMAIL_REAUTH_ERROR
      : `Google token refresh failed: ${lastBody.slice(0, 300)}`,
  ) as Error & { needsReauth?: boolean; googleOAuthError?: string };
  err.googleOAuthError = parsed.code;
  err.needsReauth = GOOGLE_REAUTH_ERRORS.has(parsed.code);
  throw err;
}

async function markOauthNeedsReauth(oauthConnectionId: string): Promise<void> {
  await accountQuery(
    `UPDATE accounts.mail_oauth_connections
     SET needs_reauth = true, updated_at = now()
     WHERE id = $1::bigint`,
    [oauthConnectionId],
  );
}

async function persistOauthTokens(input: {
  oauthConnectionId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date | null;
}): Promise<void> {
  const accessEnc = encryptAccountsSecret(input.accessToken);
  if (input.refreshToken) {
    const refreshEnc = encryptAccountsSecret(input.refreshToken);
    await accountQuery(
      `UPDATE accounts.mail_oauth_connections
       SET access_token_encrypted = $2,
           refresh_token_encrypted = $3,
           expires_at = $4,
           needs_reauth = false,
           updated_at = now()
       WHERE id = $1::bigint`,
      [
        input.oauthConnectionId,
        accessEnc,
        refreshEnc,
        input.expiresAt?.toISOString() ?? null,
      ],
    );
    return;
  }
  await accountQuery(
    `UPDATE accounts.mail_oauth_connections
     SET access_token_encrypted = $2,
         expires_at = $3,
         needs_reauth = false,
         updated_at = now()
     WHERE id = $1::bigint`,
    [
      input.oauthConnectionId,
      accessEnc,
      input.expiresAt?.toISOString() ?? null,
    ],
  );
}

export async function getValidOauthAccessToken(
  mailbox: CrmBotMailbox,
): Promise<
  | { ok: true; accessToken: string; fromEmail: string | null; fromName: string | null }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  if (!mailbox.oauthConnectionId || !mailbox.accessTokenEncrypted) {
    return {
      ok: false,
      error:
        "CRM bot email channel has no OAuth connection. Connect it in Accounts.",
      needsConnect: true,
    };
  }
  if (mailbox.needsReauth && !mailbox.refreshTokenEncrypted) {
    return {
      ok: false,
      error: "CRM bot mailbox needs re-authentication in Accounts.",
      needsConnect: true,
    };
  }
  if (!accountsTokenEncryptionConfigured()) {
    return {
      ok: false,
      error:
        "MS_TOKEN_ENCRYPTION_KEY (or MS_CLIENT_SECRET for scrypt fallback) is not set — cannot use the Accounts CRM bot mailbox.",
      needsConnect: true,
    };
  }

  let accessToken: string;
  let refreshToken: string | null = null;
  try {
    accessToken = decryptAccountsSecret(mailbox.accessTokenEncrypted);
    if (mailbox.refreshTokenEncrypted) {
      refreshToken = decryptAccountsSecret(mailbox.refreshTokenEncrypted);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // AES-GCM auth failure = CRM env key ≠ Accounts encrypt key.
    const decryptMismatch =
      /unable to authenticate data|unsupported state|bad decrypt|invalid accounts encrypted/i.test(
        msg,
      );
    return {
      ok: false,
      error: decryptMismatch
        ? "crm_bot_token_decrypt_failed"
        : msg || "Failed to decrypt Accounts mailbox tokens.",
      needsConnect: true,
    };
  }

  const stillValid =
    !mailbox.needsReauth &&
    (mailbox.tokenExpiresAt?.getTime() ?? 0) > Date.now() + 60_000;
  if (!stillValid) {
    if (!refreshToken) {
      return {
        ok: false,
        error: "CRM bot mailbox token expired and has no refresh token.",
        needsConnect: true,
      };
    }
    try {
      if (mailbox.oauthProvider === "microsoft") {
        const refreshed = await refreshMicrosoftWithAccountsClient(refreshToken);
        accessToken = refreshed.access_token;
        const expiresAt = refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000)
          : null;
        await persistOauthTokens({
          oauthConnectionId: mailbox.oauthConnectionId,
          accessToken,
          refreshToken: refreshed.refresh_token ?? refreshToken,
          expiresAt,
        });
      } else {
        const refreshed = await refreshGoogleWithAccountsClient(refreshToken);
        accessToken = refreshed.access_token;
        const expiresAt = refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000)
          : null;
        await persistOauthTokens({
          oauthConnectionId: mailbox.oauthConnectionId,
          accessToken,
          refreshToken: refreshed.refresh_token ?? refreshToken,
          expiresAt,
        });
      }
    } catch (err) {
      const needsReauth =
        err instanceof Error &&
        (err as Error & { needsReauth?: boolean }).needsReauth === true;
      if (needsReauth && mailbox.oauthConnectionId) {
        await markOauthNeedsReauth(mailbox.oauthConnectionId).catch((markErr) =>
          console.error("mark CRM bot mailbox needs_reauth failed", markErr),
        );
      }
      const message =
        err instanceof Error ? err.message : "Failed to refresh CRM bot mailbox token.";
      return {
        ok: false,
        error: needsReauth ? CRM_BOT_GMAIL_REAUTH_ERROR : message,
        needsConnect: true,
      };
    }
  }

  return {
    ok: true,
    accessToken,
    fromEmail: mailbox.senderEmail || mailbox.accountEmail,
    fromName: mailbox.senderName || mailbox.accountName,
  };
}

async function sendViaMicrosoftGraph(args: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
}): Promise<SendConnectedEmailResult> {
  const { toOutboundEmailBodies } = await import("@/lib/outbound-email");
  const ccList = (args.cc ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const message: Record<string, unknown> = {
    subject: args.subject,
    body: {
      contentType: "HTML",
      content: toOutboundEmailBodies(args.body).html,
    },
    toRecipients: [{ emailAddress: { address: args.to } }],
  };
  if (ccList.length) {
    message.ccRecipients = ccList.map((address) => ({
      emailAddress: { address },
    }));
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      error: `Microsoft send failed (${res.status}): ${text.slice(0, 300)}`,
      needsConnect: res.status === 401 || res.status === 403,
    };
  }
  return { ok: true, via: "microsoft", fromEmail: null };
}

export type CrmBotEmailThreading = {
  /** Gmail thread to keep replies in the same conversation */
  gmailThreadId?: string | null;
  /** RFC Message-ID of the parent (In-Reply-To / References) */
  inReplyToRfcMessageId?: string | null;
  /** Fallback: look up RFC Message-ID from a stored Gmail API message id */
  inReplyToGmailMessageId?: string | null;
  /** Prior References header chain (optional) */
  references?: string | null;
};

export async function sendCrmBotEmail(args: {
  organizationId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
} & CrmBotEmailThreading): Promise<
  SendConnectedEmailResult & {
    mailbox?: Pick<
      CrmBotMailbox,
      "channelConfigId" | "emailConfigId" | "channelName"
    >;
  }
> {
  const contentCheck = validateOutboundEmailContent({
    subject: args.subject,
    body: args.body,
  });
  if (!contentCheck.ok) {
    return { ok: false, error: contentCheck.error };
  }

  const mailbox = await resolveCrmBotMailbox(args.organizationId);
  if (!mailbox) {
    return {
      ok: false,
      error:
        "No active CRM email channel in Accounts (channel_type=email, product_ids includes crm).",
      needsConnect: true,
    };
  }

  const isOauth =
    mailbox.thirdPartyMode === "oauth" ||
    Boolean(mailbox.oauthConnectionId) ||
    mailbox.providerType === "third_party";

  if (!isOauth || !mailbox.oauthProvider) {
    return {
      ok: false,
      error: `CRM bot mailbox "${mailbox.channelName}" is not OAuth-connected (SMTP/hosted send not wired yet).`,
      needsConnect: true,
    };
  }

  const token = await getValidOauthAccessToken(mailbox);
  if (!token.ok) {
    return {
      ok: false,
      error: token.error,
      needsConnect: token.needsConnect,
    };
  }

  if (mailbox.oauthProvider === "google") {
    let inReplyToRfc = args.inReplyToRfcMessageId ?? null;
    if (!inReplyToRfc && args.inReplyToGmailMessageId) {
      try {
        const parent = await getGmailMessage({
          accessToken: token.accessToken,
          messageId: args.inReplyToGmailMessageId,
        });
        inReplyToRfc = parent.rfcMessageId;
      } catch {
        // continue without — Gmail may still thread via threadId
      }
    }
    try {
      const result = await sendGmailMessage({
        accessToken: token.accessToken,
        to: args.to,
        subject: args.subject,
        body: args.body,
        cc: args.cc,
        fromEmail: token.fromEmail,
        fromName: token.fromName,
        threadId: args.gmailThreadId,
        inReplyToRfcMessageId: inReplyToRfc,
        references: args.references ?? inReplyToRfc,
      });
      return {
        ok: true,
        via: "google",
        fromEmail: token.fromEmail,
        messageId: result.id,
        threadId: result.threadId,
        rfcMessageId: result.rfcMessageId,
        mailbox: {
          channelConfigId: mailbox.channelConfigId,
          emailConfigId: mailbox.emailConfigId,
          channelName: mailbox.channelName,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Gmail send failed.",
      };
    }
  }

  const ms = await sendViaMicrosoftGraph({
    accessToken: token.accessToken,
    to: args.to,
    subject: args.subject,
    body: args.body,
    cc: args.cc,
  });
  if (!ms.ok) return ms;
  return {
    ...ms,
    fromEmail: token.fromEmail,
    mailbox: {
      channelConfigId: mailbox.channelConfigId,
      emailConfigId: mailbox.emailConfigId,
      channelName: mailbox.channelName,
    },
  };
}
