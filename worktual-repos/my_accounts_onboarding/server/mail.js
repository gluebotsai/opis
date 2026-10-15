import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";

import { withImapMailbox } from "./imapSession.js";
import {
  getCachedMessageDetail,
  getCachedMessageList,
  getRedisCachedMessageList,
  peekCachedMessageList,
  readFolderCacheFromDb,
  scheduleListRefresh,
  setCachedMessageDetail,
  setCachedMessageList,
} from "./mailCache.js";
import {
  getMailConfigStatus,
  getProfileConfig,
  isDevelopmentMail,
  isGmailHost,
  isMailDryRun,
  markSmtpReachable,
  normalizeMailProfile,
} from "./mailConfig.js";
import { isMicrosoftMailConfigured, getMicrosoftAdminConsentUrl } from "./msGraphConfig.js";
import {
  getGraphAttachment,
  getGraphMessage,
  listGraphMessages,
  sendGraphMail,
} from "./msGraphMail.js";
import {
  getMailOAuthStatus,
  getValidAccessTokenForProfile,
  withMicrosoftGraphAccess,
} from "./msGraphTokens.js";

export { getMailConfigStatus, normalizeMailProfile };

async function runMicrosoftGraphMail(mailContext, mailboxProfile, handler) {
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
  let outlook = { connected: false, accountEmail: "", accountName: "" };

  if (microsoftConfigured && mailContext?.accountId) {
    outlook = await getMailOAuthStatus(
      mailContext.accountType,
      mailContext.accountId,
      mailContext.mailboxProfile || role,
    );
  }

  const provider = microsoftConfigured
    ? outlook.connected
      ? "microsoft-graph"
      : "microsoft-graph-pending"
    : baseStatus.imapConfigured
      ? "imap"
      : "none";

  return {
    ...baseStatus,
    provider,
    microsoftConfigured,
    outlookConnected: outlook.connected,
    outlookEmail: outlook.accountEmail,
    outlookAccountName: outlook.accountName,
    needsOutlookConnect: microsoftConfigured && !outlook.connected,
    mailReady: microsoftConfigured ? outlook.connected : baseStatus.imapConfigured,
    adminConsentUrl: microsoftConfigured ? getMicrosoftAdminConsentUrl() : "",
  };
}

const smtpTransports = {};

function normalizeRecipients(value) {
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

function dryRunSend(mailOptions, to, cc, extra = {}) {
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

function formatMailError(error) {
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
    transportOptions.requireTLS = true;
  }

  if (isGmailHost(config.smtpHost)) {
    transportOptions.requireTLS = true;
    transportOptions.tls = { minVersion: "TLSv1.2" };
  }

  return nodemailer.createTransport(transportOptions);
}

function getSmtpTransport(profile = "finance") {
  const role = normalizeMailProfile(profile);
  if (!smtpTransports[role]) {
    smtpTransports[role] = createSmtpTransport(role);
  }

  return smtpTransports[role];
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatAddressList(value) {
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

function extractEmailAddress(value) {
  const raw = String(value || "").trim();
  const named = raw.match(/<([^>]+)>/);
  if (named) {
    return named[1].trim();
  }

  if (raw.includes("@")) {
    return raw;
  }

  return "";
}

function hasSeenFlag(flags) {
  if (!flags) {
    return false;
  }

  if (typeof flags.has === "function") {
    return flags.has("\\Seen");
  }

  return Array.isArray(flags) && flags.includes("\\Seen");
}

function mapAttachments(parsed) {
  return (parsed.attachments || []).map((attachment, index) => ({
    id: String(index),
    fileName: attachment.filename || `attachment-${index + 1}`,
    contentType: attachment.contentType || "application/octet-stream",
    size: attachment.size || attachment.content?.length || 0,
    isPreviewable:
      (attachment.contentType || "").startsWith("image/") ||
      attachment.contentType === "application/pdf",
  }));
}

function buildMessageSummary(parsed, envelope, uid, folderKey, flags) {
  const textContent = parsed.text || stripHtml(parsed.html);
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

function buildMessageSummaryFromEnvelope(envelope, uid, folderKey, flags, hasAttachments = false) {
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

function buildMessageDetail(parsed, envelope, uid, folderKey, flags) {
  const summary = buildMessageSummary(parsed, envelope, uid, folderKey, flags);
  const textBody = parsed.text || stripHtml(parsed.html) || summary.preview;

  return {
    ...summary,
    body: textBody,
    htmlBody: parsed.html || "",
    attachments: mapAttachments(parsed),
  };
}

async function markMessageAsRead(client, uid) {
  try {
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
  } catch {
    // Some folders reject flag updates.
  }
}

function messageHasAttachments(bodyStructure) {
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
  return withImapMailbox(folderKey, profile, async (client) => {
    const messages = [];
    const total = client.mailbox.exists || 0;

    if (!total) {
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

export async function sendEmail(payload, profile = "finance", mailContext = null) {
  const role = normalizeMailProfile(payload?.mailbox || payload?.profile || profile);
  const graphResult = await runMicrosoftGraphMail(
    {
      accountType: mailContext?.accountType,
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken) => sendGraphMail(accessToken, payload),
  );

  if (graphResult) {
    return graphResult;
  }

  if (isMicrosoftMailConfigured() && mailContext?.accountId) {
    throw new Error("Connect your Microsoft Outlook account before sending mail.");
  }
  const to = normalizeRecipients(payload.to);
  const cc = normalizeRecipients(payload.cc);
  const bcc = normalizeRecipients(payload.bcc);

  if (!to.length) {
    throw new Error("At least one recipient is required.");
  }

  const config = getProfileConfig(role);
  const from = payload.from || config.smtpFrom;

  const mailOptions = {
    from,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject: payload.subject || "Worktual Quotation",
    text: payload.body || "",
  };

  if (payload.replyTo) {
    mailOptions.replyTo = payload.replyTo;
  }

  const outgoingAttachments = [];
  if (payload.attachment?.contentBase64 && payload.attachment?.fileName) {
    outgoingAttachments.push(payload.attachment);
  }
  if (Array.isArray(payload.attachments)) {
    outgoingAttachments.push(...payload.attachments);
  }

  if (outgoingAttachments.length) {
    mailOptions.attachments = outgoingAttachments
      .filter((entry) => entry?.contentBase64 && entry?.fileName)
      .map((entry) => ({
        filename: entry.fileName,
        content: Buffer.from(entry.contentBase64, "base64"),
        contentType: entry.contentType || "application/octet-stream",
      }));
  }

  if (isMailDryRun()) {
    return dryRunSend(mailOptions, to, cc, { profile: role });
  }

  const transport = getSmtpTransport(role);

  try {
    const info = await transport.sendMail(mailOptions);
    markSmtpReachable(role, true);
    return { messageId: info.messageId, accepted: info.accepted, profile: role };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (isDevelopmentMail() && /ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
      markSmtpReachable(role, false);
      console.warn(`[mail] SMTP unreachable for ${role} — simulating send.`);
      return dryRunSend(mailOptions, to, cc, { dryRunFallback: true, profile: role });
    }

    throw new Error(formatMailError(error));
  }
}

export async function fetchMailboxMessages(
  folderKey = "inbox",
  limit = 30,
  profile = "finance",
  { forceRefresh = false, mailContext = null } = {},
) {
  const role = normalizeMailProfile(profile);
  const graphMessages = await runMicrosoftGraphMail(
    {
      accountType: mailContext?.accountType,
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken) => listGraphMessages(accessToken, folderKey, limit),
  );

  if (graphMessages) {
    return { messages: graphMessages, cached: false, source: "microsoft-graph" };
  }

  if (isMicrosoftMailConfigured() && mailContext?.accountId) {
    throw new Error("Connect your Microsoft Outlook account to load mail.");
  }

  const cacheKey = `${role}:${folderKey}:${limit}`;

  if (!forceRefresh) {
    const memoryCached = getCachedMessageList(role, folderKey, limit);
    if (memoryCached) {
      return { messages: memoryCached, cached: true, source: "memory" };
    }

    const redisCached = await getRedisCachedMessageList(role, folderKey, limit);
    if (redisCached?.length) {
      setCachedMessageList(role, folderKey, limit, redisCached);
      return { messages: redisCached, cached: true, source: "redis" };
    }

    const freshDb = await readFolderCacheFromDb(role, folderKey, limit);
    const dbCached =
      freshDb || (await readFolderCacheFromDb(role, folderKey, limit, { allowStale: true }));
    if (dbCached?.length) {
      setCachedMessageList(role, folderKey, limit, dbCached);
      scheduleListRefresh(cacheKey, async () => {
        const fresh = await fetchMailboxMessagesFromImap(folderKey, limit, role);
        setCachedMessageList(role, folderKey, limit, fresh);
      });
      return {
        messages: dbCached,
        cached: true,
        source: freshDb ? "database" : "database-stale",
      };
    }
  }

  try {
    const messages = await fetchMailboxMessagesFromImap(folderKey, limit, role);
    setCachedMessageList(role, folderKey, limit, messages);
    return { messages, cached: false, source: "imap" };
  } catch (error) {
    if (!forceRefresh) {
      const staleMemory = peekCachedMessageList(role, folderKey, limit);
      if (staleMemory) {
        return { messages: staleMemory, cached: true, source: "memory-stale" };
      }

      const staleDb = await readFolderCacheFromDb(role, folderKey, limit, { allowStale: true });
      if (staleDb?.length) {
        return { messages: staleDb, cached: true, source: "database-stale" };
      }
    }

    throw new Error(formatMailError(error));
  }
}

export async function fetchMessageByUid(folderKey, uid, profile = "finance", mailContext = null) {
  const role = normalizeMailProfile(profile);
  const graphMessage = await runMicrosoftGraphMail(
    {
      accountType: mailContext?.accountType,
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken) => getGraphMessage(accessToken, String(uid), folderKey),
  );

  if (graphMessage) {
    return graphMessage;
  }

  if (isMicrosoftMailConfigured() && mailContext?.accountId) {
    throw new Error("Connect your Microsoft Outlook account to open messages.");
  }

  const numericUid = Number(uid);
  if (!numericUid) {
    throw new Error("Invalid message id.");
  }
  const cached = getCachedMessageDetail(role, folderKey, numericUid);
  if (cached) {
    return cached;
  }

  const message = await withImapMailbox(folderKey, role, async (client) => {
    const fetched = await client.fetchOne(
      String(numericUid),
      {
        envelope: true,
        source: true,
        uid: true,
        flags: true,
      },
      { uid: true },
    );

    if (!fetched) {
      throw new Error("Message not found.");
    }

    await markMessageAsRead(client, numericUid);
    const parsed = await simpleParser(fetched.source);
    const flags = new Set([...(fetched.flags || []), "\\Seen"]);

    return buildMessageDetail(parsed, fetched.envelope, fetched.uid, folderKey, flags);
  });

  setCachedMessageDetail(role, folderKey, numericUid, message);
  return message;
}

export async function fetchAttachmentByUid(
  folderKey,
  uid,
  attachmentId,
  profile = "finance",
  mailContext = null,
) {
  const role = normalizeMailProfile(profile);
  const graphAttachment = await runMicrosoftGraphMail(
    {
      accountType: mailContext?.accountType,
      accountId: mailContext?.accountId,
      mailboxProfile: role,
    },
    role,
    (accessToken) => getGraphAttachment(accessToken, String(uid), String(attachmentId)),
  );

  if (graphAttachment) {
    return graphAttachment;
  }

  if (isMicrosoftMailConfigured() && mailContext?.accountId) {
    throw new Error("Connect your Microsoft Outlook account to download attachments.");
  }

  const numericUid = Number(uid);
  const attachmentIndex = Number(attachmentId);

  if (!numericUid || Number.isNaN(attachmentIndex)) {
    throw new Error("Invalid attachment request.");
  }

  return withImapMailbox(folderKey, profile, async (client) => {
    const message = await client.fetchOne(
      String(numericUid),
      {
        source: true,
        uid: true,
      },
      { uid: true },
    );

    if (!message) {
      throw new Error("Message not found.");
    }

    const parsed = await simpleParser(message.source);
    const attachment = parsed.attachments?.[attachmentIndex];

    if (!attachment?.content) {
      throw new Error("Attachment not found.");
    }

    return {
      fileName: attachment.filename || `attachment-${attachmentIndex + 1}`,
      contentType: attachment.contentType || "application/octet-stream",
      size: attachment.size || attachment.content.length,
      contentBase64: attachment.content.toString("base64"),
    };
  });
}

export async function fetchInboxMessages(limit = 20, profile = "finance", options = {}) {
  const result = await fetchMailboxMessages("inbox", limit, profile, options);
  return result.messages;
}

export async function fetchMailWorkspace(
  folder = "inbox",
  limit = 30,
  profile = "finance",
  { forceRefresh = false, mailContext = null } = {},
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
    };
  }

  if (!config.mailReady) {
    return {
      ...config,
      folder,
      messages: [],
      cached: false,
      source: "none",
    };
  }

  try {
    const listResult = await fetchMailboxMessages(folder, limit, role, { forceRefresh, mailContext });
    return {
      ...config,
      folder,
      messages: listResult.messages,
      cached: listResult.cached,
      source: listResult.source,
    };
  } catch (error) {
    if (config.outlookConnected) {
      return {
        ...config,
        folder,
        messages: [],
        cached: false,
        source: "microsoft-graph-error",
        mailError: error instanceof Error ? error.message : "Failed to load Outlook messages.",
      };
    }

    throw error;
  }
}
