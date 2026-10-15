/**
 * Phase 2 — send one test email using My Accounts mailbox transport.
 * Send using the org My Accounts mailbox (Google / Microsoft / SMTP).
 */

import { createHash } from "node:crypto";
import tls from "node:tls";
import { env } from "../config/env.js";
import { decryptAccountsSecret } from "../helpers/accounts-oauth-crypto.js";
import {
  buildCampaignEmailMime,
  toCrLf,
} from "../helpers/email-mime.js";
import { ensureOutboundEmailPersonalized } from "../helpers/email-render.js";
import {
  isWorktualTechEmail,
  WORKTUAL_TECH_FROM_BLOCKED,
} from "../helpers/worktual-tech-from.js";
import { AppError } from "../helpers/response-builders.js";
import type { AccountsEmailMailboxPublic } from "../dao/accounts-email-mailbox.js";

type SecretRow = {
  provider_type: string;
  third_party_mode: string | null;
  oauth_provider: string | null;
  sender_email: string | null;
  sender_name: string | null;
  reply_to: string | null;
  oauth_account_email: string | null;
  oauth_expires_at: string | null;
  oauth_needs_reauth: boolean | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean | null;
  smtp_user_encrypted: string | null;
  smtp_pass_encrypted: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  requested_local_part: string | null;
  hosted_domain: string | null;
};

export type AccountsEmailTestSendInput = {
  to: string;
  subject?: string;
  html?: string;
};

export type AccountsEmailTestSendResult = {
  ok: true;
  transport: "oauth" | "smtp";
  provider: string;
  from: string;
  to: string;
  message_id: string;
};

/** Do not retry — mailbox/auth/config cannot recover mid-batch. */
export class PermanentEmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentEmailSendError";
  }
}

export function accountsEmailSendIntervalMs(): number {
  return Math.ceil(60_000 / env.accountsEmailLaunch.ratePerMinute);
}

export function isPermanentAccountsEmailError(err: unknown): boolean {
  if (err instanceof PermanentEmailSendError) return true;
  const msg = (err instanceof Error ? err.message : String(err || "")).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("ms_token_encryption_key") ||
    msg.includes("cannot decrypt") ||
    msg.includes("reconnect") ||
    msg.includes("invalid_grant") ||
    msg.includes("not ready") ||
    msg.includes("not configured") ||
    msg.includes("unsupported oauth") ||
    msg.includes("yahoo oauth")
  );
}

function classifyAccountsSendError(err: unknown): Error {
  if (err instanceof PermanentEmailSendError) return err;
  const msg = err instanceof Error ? err.message : String(err || "send failed");
  const lower = msg.toLowerCase();
  const retryable =
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("timeout") ||
    lower.includes("temporar") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("socket");
  if (!retryable && isPermanentAccountsEmailError(err)) {
    return new PermanentEmailSendError(msg);
  }
  if (
    !retryable &&
    err instanceof AppError &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  ) {
    return new PermanentEmailSendError(msg);
  }
  return err instanceof Error ? err : new Error(msg);
}

function base64Url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function resolveFrom(row: SecretRow): { email: string; name: string | null } {
  const email =
    String(row.sender_email || "").trim() ||
    String(row.oauth_account_email || "").trim() ||
    (() => {
      const local = String(row.requested_local_part || "").trim();
      const domain = String(row.hosted_domain || "").trim();
      return local && domain ? `${local}@${domain}` : "";
    })();
  if (!email) {
    throw new AppError("Accounts mailbox has no sender address.", 400);
  }
  const name = String(row.sender_name || "").trim() || null;
  return { email, name };
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const { reloadBackendEnv } = await import("../config/env.js");
  reloadBackendEnv();
  const clientId = env.accountsOAuth.googleClientId;
  const clientSecret = env.accountsOAuth.googleClientSecret;
  if (!clientId || !clientSecret) {
    throw new AppError(
      "Campaign backend process has no GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET loaded (check backend/.env and restart the API — dev-lan must pick up backend/.env). Reconnect the mailbox in Setup if OAuth still fails after restart.",
      400,
    );
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new AppError(
      json.error_description ||
        json.error ||
        "Could not refresh Google OAuth token — reconnect mailbox in Setup.",
      400,
    );
  }
  return json.access_token;
}

async function refreshMicrosoftAccessToken(
  refreshToken: string,
): Promise<string> {
  const clientId = env.accountsOAuth.microsoftClientId;
  const clientSecret = env.accountsOAuth.microsoftClientSecret;
  if (!clientId || !clientSecret) {
    throw new AppError(
      "Microsoft access token expired. Set MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET, or reconnect in Setup.",
      400,
    );
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "https://graph.microsoft.com/.default offline_access Mail.Send",
  });
  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new AppError(
      json.error_description ||
        json.error ||
        "Could not refresh Microsoft OAuth token — reconnect mailbox in Setup.",
      400,
    );
  }
  return json.access_token;
}

async function resolveOAuthAccessToken(row: SecretRow): Promise<string> {
  if (!row.access_token_encrypted) {
    throw new AppError("OAuth access token missing on Accounts mailbox.", 400);
  }
  let accessToken = decryptAccountsSecret(row.access_token_encrypted);
  const expiresAt = row.oauth_expires_at
    ? Date.parse(row.oauth_expires_at)
    : NaN;
  const expired = Number.isFinite(expiresAt) && expiresAt <= Date.now() + 60_000;
  if (!expired) return accessToken;
  if (!row.refresh_token_encrypted) {
    throw new AppError(
      "OAuth access token expired and no refresh token — reconnect mailbox in Setup.",
      400,
    );
  }
  const refreshToken = decryptAccountsSecret(row.refresh_token_encrypted);
  const provider = String(row.oauth_provider || "").trim().toLowerCase();
  if (provider === "google") {
    accessToken = await refreshGoogleAccessToken(refreshToken);
  } else if (provider === "microsoft") {
    accessToken = await refreshMicrosoftAccessToken(refreshToken);
  } else {
    throw new AppError(
      `OAuth token refresh is not implemented for provider "${provider}" yet.`,
      400,
    );
  }
  return accessToken;
}

async function sendViaGmail(args: {
  accessToken: string;
  mime: string;
}): Promise<string> {
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(args.mime) }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.id) {
    throw new AppError(
      json.error?.message || "Gmail API rejected the test send.",
      res.status >= 400 && res.status < 500 ? res.status : 502,
    );
  }
  return json.id;
}

async function sendViaMicrosoftGraph(args: {
  accessToken: string;
  from: { email: string; name: string | null };
  to: string;
  subject: string;
  html: string;
}): Promise<string> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: args.subject,
        body: { contentType: "HTML", content: args.html },
        toRecipients: [{ emailAddress: { address: args.to } }],
        from: {
          emailAddress: {
            address: args.from.email,
            name: args.from.name || undefined,
          },
        },
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new AppError(
      json.error?.message || "Microsoft Graph rejected the test send.",
      res.status >= 400 && res.status < 500 ? res.status : 502,
    );
  }
  return createHash("sha256")
    .update(`${args.from.email}:${args.to}:${Date.now()}`)
    .digest("hex")
    .slice(0, 24);
}

function readSmtpResponse(socket: tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      cleanup();
      resolve(chunk.toString("utf8"));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP timeout"));
    }, 20_000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.once("data", onData);
    socket.once("error", onError);
  });
}

async function smtpCommand(
  socket: tls.TLSSocket,
  command: string,
): Promise<string> {
  socket.write(`${command}\r\n`);
  return readSmtpResponse(socket);
}

async function sendViaSmtp(args: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mime: string;
  fromEmail: string;
  to: string;
}): Promise<string> {
  const socket = tls.connect({
    host: args.host,
    port: args.port,
    servername: args.host,
    rejectUnauthorized: env.nodeEnv === "production",
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("secureConnect", () => resolve());
    socket.once("error", reject);
  });

  const greet = await readSmtpResponse(socket);
  if (!greet.startsWith("220")) {
    socket.end();
    throw new AppError("SMTP server did not greet.", 502);
  }

  const ehlo = await smtpCommand(socket, "EHLO campaign-phase2");
  if (!ehlo.startsWith("250")) {
    socket.end();
    throw new AppError("SMTP EHLO failed.", 502);
  }

  const authPlain = Buffer.from(`\0${args.user}\0${args.pass}`).toString(
    "base64",
  );
  const auth = await smtpCommand(socket, `AUTH PLAIN ${authPlain}`);
  if (!auth.startsWith("235")) {
    socket.end();
    throw new AppError("SMTP authentication failed.", 401);
  }

  const mailFrom = await smtpCommand(socket, `MAIL FROM:<${args.fromEmail}>`);
  if (!mailFrom.startsWith("250")) {
    socket.end();
    throw new AppError("SMTP MAIL FROM rejected.", 502);
  }

  const rcpt = await smtpCommand(socket, `RCPT TO:<${args.to}>`);
  if (!rcpt.startsWith("250")) {
    socket.end();
    throw new AppError("SMTP RCPT TO rejected.", 502);
  }

  socket.write("DATA\r\n");
  const dataReady = await readSmtpResponse(socket);
  if (!dataReady.startsWith("354")) {
    socket.end();
    throw new AppError("SMTP DATA not accepted.", 502);
  }

  socket.write(`${toCrLf(args.mime)}\r\n.\r\n`);
  const sent = await readSmtpResponse(socket);
  await smtpCommand(socket, "QUIT").catch(() => {});
  socket.end();

  if (!sent.startsWith("250")) {
    throw new AppError("SMTP server rejected message body.", 502);
  }

  return createHash("sha256")
    .update(`${args.fromEmail}:${args.to}:${Date.now()}`)
    .digest("hex")
    .slice(0, 24);
}

async function sendViaOAuth(
  row: SecretRow,
  mime: string,
  from: { email: string; name: string | null },
  to: string,
  subject: string,
  html: string,
): Promise<{ provider: string; messageId: string }> {
  const provider = String(row.oauth_provider || "").trim().toLowerCase();
  const accessToken = await resolveOAuthAccessToken(row);
  if (provider === "google") {
    const messageId = await sendViaGmail({ accessToken, mime });
    return { provider: "google", messageId };
  }
  if (provider === "microsoft") {
    const messageId = await sendViaMicrosoftGraph({
      accessToken,
      from,
      to,
      subject,
      html,
    });
    return { provider: "microsoft", messageId };
  }
  if (provider === "yahoo") {
    throw new AppError(
      "Yahoo OAuth test send is not implemented yet — use SMTP or Google/Microsoft for Phase 2.",
      400,
    );
  }
  throw new AppError(
    `Unsupported OAuth provider "${provider || "unknown"}".`,
    400,
  );
}

async function sendThroughAccountsMailbox(
  row: SecretRow,
  mailbox: AccountsEmailMailboxPublic,
  input: { to: string; subject: string; html: string; first_name?: string },
): Promise<AccountsEmailTestSendResult> {
  if (!mailbox.send_ready) {
    throw new PermanentEmailSendError(
      mailbox.block_reason || "Accounts mailbox is not ready for send.",
    );
  }

  const to = String(input.to || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new PermanentEmailSendError("Recipient email is not valid.");
  }

  const from = resolveFrom(row);
  if (
    isWorktualTechEmail(from.email) ||
    isWorktualTechEmail(row.sender_email) ||
    isWorktualTechEmail(row.oauth_account_email)
  ) {
    throw new PermanentEmailSendError(WORKTUAL_TECH_FROM_BLOCKED);
  }
  const personalized = ensureOutboundEmailPersonalized(
    {
      subject: String(input.subject || "").trim() || "Campaign",
      html: String(input.html || "").trim(),
    },
    { first_name: String(input.first_name || "").trim() },
  );
  const subject = personalized.subject;
  const html = personalized.html || `<p>${subject}</p>`;
  const mime = buildCampaignEmailMime({
    from,
    to,
    subject,
    html,
    replyTo: row.reply_to,
  });

  try {
    if (mailbox.transport === "oauth") {
      const sent = await sendViaOAuth(row, mime, from, to, subject, html);
      return {
        ok: true,
        transport: "oauth",
        provider: sent.provider,
        from: from.email,
        to,
        message_id: sent.messageId,
      };
    }

    if (mailbox.transport === "smtp") {
      const user = decryptAccountsSecret(String(row.smtp_user_encrypted));
      const pass = decryptAccountsSecret(String(row.smtp_pass_encrypted));
      const host = String(row.smtp_host || "").trim();
      const port = Number(row.smtp_port || 465);
      const secure = row.smtp_secure !== false;
      const messageId = await sendViaSmtp({
        host,
        port,
        secure,
        user,
        pass,
        mime,
        fromEmail: from.email,
        to,
      });
      return {
        ok: true,
        transport: "smtp",
        provider: "smtp",
        from: from.email,
        to,
        message_id: messageId,
      };
    }
  } catch (err) {
    throw classifyAccountsSendError(err);
  }

  throw new PermanentEmailSendError(
    mailbox.block_reason || "This Accounts mailbox type cannot send yet.",
  );
}

export async function sendAccountsMailboxCampaignEmail(
  row: SecretRow,
  mailbox: AccountsEmailMailboxPublic,
  input: { to: string; subject: string; html: string; first_name?: string },
): Promise<AccountsEmailTestSendResult> {
  return sendThroughAccountsMailbox(row, mailbox, input);
}

export async function sendAccountsMailboxTestEmail(
  row: SecretRow,
  mailbox: AccountsEmailMailboxPublic,
  input: AccountsEmailTestSendInput,
): Promise<AccountsEmailTestSendResult> {
  if (!mailbox.send_ready) {
    throw new AppError(
      mailbox.block_reason || "Accounts mailbox is not ready for test send.",
      400,
    );
  }

  const to = String(input.to || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new AppError("Enter a valid test recipient email.", 400);
  }

  const from = resolveFrom(row);
  const subject =
    String(input.subject || "").trim() ||
    "Worktual Campaign — Phase 2 mailbox test";
  const html =
    String(input.html || "").trim() ||
    `<p>This is a test email from your My Accounts campaign mailbox (<code>${from.email}</code>).</p>`;

  try {
    return await sendThroughAccountsMailbox(row, mailbox, {
      to,
      subject,
      html,
    });
  } catch (err) {
    if (err instanceof PermanentEmailSendError) {
      throw new AppError(err.message, 400);
    }
    throw err;
  }
}
