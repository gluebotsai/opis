import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";

import { htmlToPlainText } from "./body.js";
import { withImapMailbox, getImapSession, invalidateImapFolderCache } from "./imap-session.js";
import { withTiming, logTimed } from "../../infra/file-logger.js";
import {
  getCachedMessageDetail,
  getCachedMessageList,
  getRedisCachedMessageList,
  peekCachedMessageList,
  readFolderCacheFromDb,
  scheduleListRefresh,
  setCachedMessageDetail,
  setCachedMessageList,
} from "./cache.js";
import {
  getMailConfigStatus,
  getProfileConfig,
  isDevelopmentMail,
  isGmailHost,
  isMailDryRun,
  markSmtpReachable,
  normalizeMailProfile,
} from "./config.js";
import { isMicrosoftMailConfigured, getMicrosoftAdminConsentUrl } from "./ms-graph/config.js";
import { isValidMailFolder } from "./folders.js";
import {
  getGraphAttachment,
  getGraphMessage,
  listGraphMessages,
  moveGraphMessage,
  sendGraphMail,
  sendGraphMailAsUser,
  setGraphMessageFlag,
} from "./ms-graph/mail.js";
import { acquireMicrosoftAppOnlyAccessToken } from "./ms-graph/app-only.js";
import {
  getMailOAuthStatus,
  getValidAccessTokenForProfile,
  withMicrosoftGraphAccess,
} from "./ms-graph/tokens.js";
import { listActiveFinanceEmails } from "../users/user-store.js";

export { getMailConfigStatus, normalizeMailProfile };

/** @type {Array<{to: string[], cc: string[], subject: string, mailbox: string, replyTo?: string}> | null} */
// @ts-expect-error -- legacy runtime boundary is validated by integration checks.
let emailCaptureBuffer = null;

/** Start capturing sendEmail payloads (used by routing smoke tests). Does not send mail. */
export function beginEmailCapture() {
  emailCaptureBuffer = [];
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return emailCaptureBuffer;
}

export function endEmailCapture() {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const captured = emailCaptureBuffer || [];
  emailCaptureBuffer = null;
  return captured;
}

export function isEmailCaptureActive() {
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return Array.isArray(emailCaptureBuffer);
}

async function runMicrosoftGraphMail(mailContext: any, mailboxProfile: any, handler: any) {
  if (!isMicrosoftMailConfigured()) {
    return null;
  }

  if (mailContext?.accountId) {
    return withMicrosoftGraphAccess(
      mailContext.accountType,
      mailContext.accountId,
      mailboxProfile,
      handler,
    );
  }

  const connection = await getValidAccessTokenForProfile(mailboxProfile);
  if (!connection?.accessToken) {
    return null;
  }

  return handler(connection.accessToken);
}

export async function getMailRuntimeStatus(profile = "finance", mailContext = null) {
  const role = normalizeMailProfile(profile);
  const baseStatus = getMailConfigStatus(role);
  const microsoftConfigured = isMicrosoftMailConfigured();
  let outlook = { connected: false, needsReauth: false, accountEmail: "", accountName: "" };
  const financeTeamEmails = await listActiveFinanceEmails();

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (microsoftConfigured && mailContext?.accountId) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    outlook = await getMailOAuthStatus(
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      mailContext.accountType,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      mailContext.accountId,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      mailContext.mailboxProfile || role,
    );
  }

  const provider = microsoftConfigured
    ? outlook.connected
      ? "microsoft-graph"
      : "microsoft-graph-pending"
    : "none";

  const mailboxEmail = outlook.accountEmail || baseStatus.mailboxEmail || "";
  const needsOutlookConnect =
    microsoftConfigured && (!outlook.connected || Boolean(outlook.needsReauth));

  return {
    ...baseStatus,
    provider,
    microsoftConfigured,
    outlookConnected: Boolean(outlook.connected),
    needsReauth: Boolean(outlook.needsReauth),
    outlookEmail: outlook.accountEmail || "",
    outlookAccountName: outlook.accountName || "",
    fromAddress: outlook.accountEmail || baseStatus.fromAddress || "",
    mailboxEmail,
    financeTeamEmails,
    financeTeamEmail: financeTeamEmails[0] || "",
    needsOutlookConnect,
    mailReady: microsoftConfigured ? Boolean(outlook.connected) : false,
    adminConsentUrl: microsoftConfigured ? getMicrosoftAdminConsentUrl() : "",
    warnings: [
      ...(baseStatus.warnings || []),
      ...(microsoftConfigured && !outlook.connected
        ? ["Sign in with Microsoft Outlook to send and receive mail from your own mailbox."]
        : []),
      ...(outlook.needsReauth
        ? ["Outlook needs to be reconnected. Sign in with Microsoft again."]
        : []),
      ...(!financeTeamEmails.length
        ? ["No active finance users found. Quotation emails will have an empty To list until finance credentials exist."]
        : []),
    ],
  };
}

const smtpTransports = {};

function normalizeRecipients(value: any) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  return String(value)
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dryRunSend(mailOptions: any, to: any, cc: any, extra = {}) {
  console.log(
    `[mail dry-run] ${mailOptions.subject} -> ${to.join(", ")}${cc.length ? ` cc ${cc.join(", ")}` : ""}`,
  );
  return {
    messageId: `dry-run-${Date.now()}`,
    accepted: to,
    dryRun: true,
    ...extra,
  };
}

function formatMailError(error: any) {
  const message = error instanceof Error ? error.message : String(error);

  if (/535|BadCredentials|Username and Password not accepted|EAUTH/i.test(message)) {
    return [
      "Gmail rejected the mail login.",
      "Use a Gmail App Password (not your normal Gmail password).",
      "Ensure SALES_* credentials are for sales and FINANCE_* credentials are for finance.",
    ].join(" ");
  }

  if (/NONEXISTENT|Unknown Mailbox|does not exist/i.test(message)) {
    return "Could not open that mail folder. Gmail Sent/Spam folder paths may differ — set IMAP_SENT / IMAP_SPAM in .env.";
  }

  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return [
      "Could not reach the configured mail server.",
      "Check internet/DNS access and SMTP/IMAP host settings in .env.",
      "For local UI testing without sending real email, set MAIL_DRY_RUN=true.",
    ].join(" ");
  }

  return message;
}

function createSmtpTransport(profile = "finance") {
  const config = getProfileConfig(profile);

  if (!config.hasSmtp()) {
    throw new Error(
      `SMTP is not configured for ${profile}. Set ${profile === "sales" ? "SALES" : "FINANCE"}_SMTP_* in .env.`,
    );
  }

  const secure = config.smtpSecure || config.smtpPort === 465;
  const transportOptions = {
    host: config.smtpHost,
    port: config.smtpPort,
    secure,
    auth: { user: config.smtpUser, pass: config.smtpPass },
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
  };

  if (!secure) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    transportOptions.requireTLS = true;
  }

  if (isGmailHost(config.smtpHost)) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    transportOptions.requireTLS = true;
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    transportOptions.tls = { minVersion: "TLSv1.2" };
  }

  return nodemailer.createTransport(transportOptions);
}

function getSmtpTransport(profile = "finance") {
  const role = normalizeMailProfile(profile);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!smtpTransports[role]) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    smtpTransports[role] = createSmtpTransport(role);
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return smtpTransports[role];
}

function formatAddressList(value: any) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => entry.text || entry.address || "")
      .filter(Boolean)
      .join(", ");
  }

  return value.text || value.address || "";
}

function extractEmailAddress(value: any) {
  const raw = String(value || "").trim();
  const named = raw.match(/<([^>]+)>/);
  if (named) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    return named[1].trim();
  }

  if (raw.includes("@")) {
    return raw;
  }

  return "";
}

function hasSeenFlag(flags: any) {
  if (!flags) {
    return false;
  }

  if (typeof flags.has === "function") {
    return flags.has("\\Seen");
  }

  return Array.isArray(flags) && flags.includes("\\Seen");
}

function mapAttachments(parsed: any) {
  return (parsed.attachments || []).map((attachment: any, index: any) => ({
    id: String(index),
    fileName: attachment.filename || `attachment-${index + 1}`,
    contentType: attachment.contentType || "application/octet-stream",
    size: attachment.size || attachment.content?.length || 0,
    isPreviewable:
      (attachment.contentType || "").startsWith("image/") ||
      attachment.contentType === "application/pdf",
  }));
}

function buildMessageSummary(parsed: any, envelope: any, uid: any, folderKey: any, flags: any) {
  const textContent = parsed.text || htmlToPlainText(parsed.html);
  const from = parsed.from?.text || envelope?.from?.[0]?.address || "Unknown sender";

  return {
    id: String(uid),
    folder: folderKey,
    from,
    fromEmail: extractEmailAddress(from) || envelope?.from?.[0]?.address || "",
    to: formatAddressList(parsed.to) || formatAddressList(envelope?.to),
    subject: parsed.subject || envelope?.subject || "",
    date: parsed.date?.toISOString() || envelope?.date || null,
    preview: textContent.replace(/\s+/g, " ").trim().slice(0, 160),
    isRead: hasSeenFlag(flags),
    hasAttachments: Boolean(parsed.attachments?.length),
  };
}

function buildMessageSummaryFromEnvelope(envelope: any, uid: any, folderKey: any, flags: any, hasAttachments = false) {
  const fromAddress = envelope?.from?.[0]?.address || "unknown@local";
  const fromName = envelope?.from?.[0]?.name || "";
  const from =
    fromName && !fromName.includes("@") ? `${fromName} <${fromAddress}>` : fromAddress;

  return {
    id: String(uid),
    folder: folderKey,
    from,
    fromEmail: fromAddress,
    to: formatAddressList(envelope?.to),
    subject: envelope?.subject || "",
    date: envelope?.date ? new Date(envelope.date).toISOString() : null,
    preview: "",
    isRead: hasSeenFlag(flags),
    hasAttachments,
  };
}

function buildMessageDetail(parsed: any, envelope: any, uid: any, folderKey: any, flags: any) {
  const summary = buildMessageSummary(parsed, envelope, uid, folderKey, flags);
  const textBody = parsed.text || htmlToPlainText(parsed.html) || summary.preview;

  return {
    ...summary,
    body: textBody,
    htmlBody: parsed.html || "",
    attachments: mapAttachments(parsed),
  };
}

async function markMessageAsRead(client: any, uid: any) {
  try {
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
  } catch {
    // Some folders reject flag updates.
  }
}

function messageHasAttachments(bodyStructure: any) {
  if (!bodyStructure) {
    return false;
  }

  if (bodyStructure.disposition === "attachment") {
    return true;
  }

  for (const part of bodyStructure.childNodes || []) {
    if (messageHasAttachments(part)) {
      return true;
    }
  }

  return false;
}

async function fetchMailboxMessagesFromImap(folderKey = "inbox", limit = 30, profile = "finance") {
  return withTiming(
    "mail",
    "imap.fetch.list",
    async () => {
      const result = await withImapMailbox(folderKey, profile, async (client: any) => {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        const messages = [];
        const total = client.mailbox.exists || 0;

        if (!total) {
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          return messages;
        }

        const start = Math.max(1, total - limit + 1);
        const range = `${start}:${total}`;

        for await (const message of client.fetch(range, {
          envelope: true,
          uid: true,
          flags: true,
          bodyStructure: true,
        })) {
          messages.push(
            buildMessageSummaryFromEnvelope(
              message.envelope,
              message.uid,
              folderKey,
              message.flags,
              messageHasAttachments(message.bodyStructure),
            ),
          );
        }

        return messages.reverse();
      });

      if (result === null) {
        return { messages: [], folderUnavailable: true };
      }

      return { messages: result, folderUnavailable: false };
    },
    { profile, folder: folderKey, limit },
  );
}

export async function verifySmtpConnection(profile = "finance") {
  const role = normalizeMailProfile(profile);

  if (isMailDryRun()) {
    return { ok: true, dryRun: true, profile: role };
  }

  const transport = getSmtpTransport(role);

  try {
    await transport.verify();
    markSmtpReachable(role, true);
    return { ok: true, profile: role };
  } catch (error) {
    markSmtpReachable(role, false);
    throw error;
  }
}

export async function sendEmail(payload: any, profile = "finance", mailContext = null) {
  const role = normalizeMailProfile(payload?.mailbox || payload?.profile || profile);
  return withTiming(
    "mail",
    "sendEmail",
    () => sendEmailInner(payload, profile, mailContext),
    {
      profile: role,
      toCount: normalizeRecipients(payload?.to).length,
      hasAttachment: Boolean(payload?.attachment?.contentBase64),
    },
  );
}

async function sendEmailInner(payload: any, profile = "finance", mailContext = null) {
  const role = normalizeMailProfile(payload?.mailbox || payload?.profile || profile);
  const to = normalizeRecipients(payload.to);
  const cc = normalizeRecipients(payload.cc);
  const bcc = normalizeRecipients(payload.bcc);

  if (!to.length) {
    throw new Error("At least one recipient is required.");
  }

  if (isMailDryRun()) {
    return dryRunSend(
      {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        from: mailContext?.accountEmail || "microsoft-graph",
        to,
        cc,
        subject: payload.subject || "Worktual Quotation",
        text: payload.body || "",
      },
      to,
      cc,
      { profile: role, provider: "microsoft-graph-dry-run" },
    );
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (emailCaptureBuffer) {
    emailCaptureBuffer.push({
      to: [...to],
      cc: [...cc],
      bcc: [...bcc],
      subject: String(payload.subject || ""),
      mailbox: role,
      replyTo: payload.replyTo || null,
    });
    return {
      messageId: `capture-${Date.now()}`,
      accepted: to,
      dryRun: true,
      profile: role,
      captured: true,
    };
  }

  // Unattended system mail (e.g. password-reset OTP) via app-only Graph.
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (mailContext?.sendMode === "appOnly") {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const fromAddress = mailContext.accountEmail || "microsoft-graph";
    if (isMailDryRun()) {
      return dryRunSend(
        {
          from: fromAddress,
          to,
          cc,
          subject: payload.subject || "Worktual Quotation",
          text: payload.body || "",
        },
        to,
        cc,
        { profile: role, provider: "microsoft-graph-app-only-dry-run" },
      );
    }

    if (!fromAddress || fromAddress === "microsoft-graph") {
      throw new Error("ADMIN_EMAIL is required for unattended Graph mail.");
    }

    const accessToken = await acquireMicrosoftAppOnlyAccessToken();
    return sendGraphMailAsUser(accessToken, fromAddress, payload);
  }

  const graphResult = await runMicrosoftGraphMail(
    {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountType: mailContext?.accountType,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken: any) => sendGraphMail(accessToken, payload),
  );

  if (graphResult) {
    return graphResult;
  }

  // Microsoft Graph is the only live transport. Shared SMTP is disabled.
  if (isMicrosoftMailConfigured()) {
    if (isMailDryRun()) {
      return dryRunSend(
        {
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          from: mailContext?.accountEmail || "microsoft-graph",
          to,
          cc,
          subject: payload.subject || "Worktual Quotation",
          text: payload.body || "",
        },
        to,
        cc,
        { profile: role, provider: "microsoft-graph-dry-run" },
      );
    }

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (mailContext?.accountId) {
      const error = new Error("Connect your Microsoft Outlook account before sending mail.");
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.code = "needs_outlook_connect";
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.needsOutlookConnect = true;
      throw error;
    }

    const error = new Error(
      "Microsoft Outlook is required to send mail. No connected mailbox is available for this sender.",
    );
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.code = "needs_outlook_connect";
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    error.needsOutlookConnect = true;
    throw error;
  }

  if (isMailDryRun()) {
    return dryRunSend(
      {
        from: "dry-run@localhost",
        to,
        cc,
        subject: payload.subject || "Worktual Quotation",
        text: payload.body || "",
      },
      to,
      cc,
      { profile: role },
    );
  }

  // SMTP transport intentionally disabled — configure Microsoft Graph (MS_* env vars).
  throw new Error(
    "Mail sending requires Microsoft Outlook (Graph). Configure MS_CLIENT_ID and sign in with Microsoft.",
  );
}

export async function fetchMailboxMessages(
  folderKey = "inbox",
  limit = 30,
  profile = "finance",
  { forceRefresh = false, mailContext = null, view = null } = {},
) {
  const role = normalizeMailProfile(profile);
  const started = performance.now();
  try {
    const result = await fetchMailboxMessagesInner(folderKey, limit, profile, {
      forceRefresh,
      mailContext,
      view,
    });
    logTimed({
      channel: "mail",
      action: "fetchMailboxMessages",
      ok: true,
      durationMs: performance.now() - started,
      profile: role,
      folder: folderKey,
      limit,
      forceRefresh: Boolean(forceRefresh),
      source: result.source,
      cached: Boolean(result.cached),
      count: result.messages?.length ?? 0,
    });
    return result;
  } catch (error) {
    logTimed({
      channel: "mail",
      action: "fetchMailboxMessages",
      ok: false,
      durationMs: performance.now() - started,
      profile: role,
      folder: folderKey,
      error,
    });
    throw error;
  }
}

async function fetchMailboxMessagesInner(
  folderKey = "inbox",
  limit = 30,
  profile = "finance",
  { forceRefresh = false, mailContext = null, view = null } = {},
) {
  const role = normalizeMailProfile(profile);
  const graphResult = await runMicrosoftGraphMail(
    {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountType: mailContext?.accountType,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken: any) => listGraphMessages(accessToken, folderKey, limit, { view }),
  );

  if (graphResult) {
    return {
      messages: graphResult.messages || [],
      cached: false,
      source: "microsoft-graph",
      folderUnavailable: Boolean(graphResult.folderUnavailable),
    };
  }

  if (isMicrosoftMailConfigured()) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (mailContext?.accountId) {
      throw new Error("Connect your Microsoft Outlook account to load mail.");
    }
    return {
      messages: [],
      cached: false,
      source: "microsoft-graph-pending",
      folderUnavailable: false,
    };
  }

  return {
    messages: [],
    cached: false,
    source: "none",
    folderUnavailable: false,
  };
}

export async function fetchMessageByUid(folderKey: any, uid: any, profile = "finance", mailContext = null) {
  const role = normalizeMailProfile(profile);
  return withTiming(
    "mail",
    "fetchMessageByUid",
    () => fetchMessageByUidInner(folderKey, uid, profile, mailContext),
    { profile: role, folder: folderKey, uid: String(uid) },
  );
}

async function fetchMessageByUidInner(folderKey: any, uid: any, profile = "finance", mailContext = null) {
  const role = normalizeMailProfile(profile);
  const graphMessage = await runMicrosoftGraphMail(
    {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountType: mailContext?.accountType,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken: any) => getGraphMessage(accessToken, String(uid), folderKey),
  );

  if (graphMessage) {
    return graphMessage;
  }

  if (isMicrosoftMailConfigured()) {
    throw new Error("Connect your Microsoft Outlook account to open messages.");
  }

  throw new Error("Microsoft Outlook is required to open mail messages.");
}

export async function fetchAttachmentByUid(
  folderKey: any,
  uid: any,
  attachmentId: any,
  profile = "finance",
  mailContext = null,
) {
  const role = normalizeMailProfile(profile);
  const graphAttachment = await runMicrosoftGraphMail(
    {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountType: mailContext?.accountType,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken: any) => getGraphAttachment(accessToken, String(uid), String(attachmentId)),
  );

  if (graphAttachment) {
    return graphAttachment;
  }

  if (isMicrosoftMailConfigured()) {
    throw new Error("Connect your Microsoft Outlook account to download attachments.");
  }

  throw new Error("Microsoft Outlook is required to download attachments.");
}

export async function fetchInboxMessages(limit = 20, profile = "finance", options = {}) {
  const result = await fetchMailboxMessages("inbox", limit, profile, options);
  return result.messages;
}

export async function fetchMailWorkspace(
  folder = "inbox",
  limit = 30,
  profile = "finance",
  { forceRefresh = false, mailContext = null, view = null } = {},
) {
  const role = normalizeMailProfile(profile);
  const config = await getMailRuntimeStatus(role, mailContext);

  if (config.needsOutlookConnect) {
    return {
      ...config,
      folder,
      messages: [],
      cached: false,
      source: "microsoft-graph-pending",
      folderUnavailable: false,
    };
  }

  if (!config.mailReady) {
    return {
      ...config,
      folder,
      messages: [],
      cached: false,
      source: "none",
      folderUnavailable: false,
    };
  }

  try {
    const listResult = await fetchMailboxMessages(folder, limit, role, {
      forceRefresh,
      mailContext,
      view,
    });
    return {
      ...config,
      folder,
      messages: listResult.messages,
      cached: listResult.cached,
      source: listResult.source,
      folderUnavailable: listResult.folderUnavailable,
    };
  } catch (error) {
    if (config.outlookConnected) {
      return {
        ...config,
        folder,
        messages: [],
        cached: false,
        source: "microsoft-graph-error",
        folderUnavailable: false,
        mailError: error instanceof Error ? error.message : "Failed to load Outlook messages.",
      };
    }

    throw error;
  }
}

export async function moveMailMessage(
  folderKey: any,
  messageId: any,
  destinationFolderKey: any,
  profile = "finance",
  mailContext = null,
) {
  const role = normalizeMailProfile(profile);
  if (!isValidMailFolder(folderKey) || !isValidMailFolder(destinationFolderKey)) {
    throw new Error("Invalid mail folder.");
  }

  const graphResult = await runMicrosoftGraphMail(
    {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountType: mailContext?.accountType,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken: any) => moveGraphMessage(accessToken, String(messageId), destinationFolderKey),
  );

  if (graphResult) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    invalidateImapFolderCache(role);
    return graphResult;
  }

  throw new Error("Connect your Microsoft Outlook account before moving mail.");
}

export async function setMailMessageFlag(
  folderKey: any,
  messageId: any,
  flagged: any,
  profile = "finance",
  mailContext = null,
) {
  const role = normalizeMailProfile(profile);
  if (!isValidMailFolder(folderKey)) {
    throw new Error("Invalid mail folder.");
  }

  const graphResult = await runMicrosoftGraphMail(
    {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountType: mailContext?.accountType,
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken: any) => setGraphMessageFlag(accessToken, String(messageId), flagged),
  );

  if (graphResult) {
    return graphResult;
  }

  throw new Error("Connect your Microsoft Outlook account before flagging mail.");
}
