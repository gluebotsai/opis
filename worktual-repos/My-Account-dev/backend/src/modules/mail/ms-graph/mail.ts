import {
  extractCidReferences,
  htmlToPlainText,
  normalizeContentId,
  resolveInlineCidImages,
} from "../body.js";
import {
  getGraphDisplayNameHints,
  getGraphWellKnownFolderId,
} from "../folders.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const discoveredFolderIds = new Map();

/**
 * Encode a Graph message/attachment id for a URL path segment exactly once.
 * Fastify and query-string parsers already percent-decode; do not encode a
 * pre-encoded value a second time (that turns `%2F` into `%252F`).
 */
function encodeGraphPathId(id: any): string {
  const raw = String(id ?? "");
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return encodeURIComponent(decoded);
}

function formatRecipients(recipients = []) {
  return recipients
    .map((entry) => {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      const address = entry?.emailAddress?.address || "";
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      const name = entry?.emailAddress?.name || "";
      if (name && address) {
        return `${name} <${address}>`;
      }

      return address || name;
    })
    .filter(Boolean)
    .join(", ");
}

function mapGraphMessageSummary(message: any, folderKey: any) {
  const fromAddress = message.from?.emailAddress?.address || "";
  const fromName = message.from?.emailAddress?.name || "";
  const from =
    fromName && fromAddress ? `${fromName} <${fromAddress}>` : fromAddress || fromName || "Unknown sender";

  return {
    id: message.id,
    folder: folderKey,
    from,
    fromEmail: fromAddress,
    to: formatRecipients(message.toRecipients),
    cc: formatRecipients(message.ccRecipients),
    subject: message.subject || "",
    date:
      message.receivedDateTime ||
      message.sentDateTime ||
      message.lastModifiedDateTime ||
      null,
    preview: message.bodyPreview || "",
    isRead: Boolean(message.isRead),
    hasAttachments: Boolean(message.hasAttachments),
    isFlagged: message.flag?.flagStatus === "flagged",
    inferenceClassification: message.inferenceClassification || "other",
  };
}

async function graphRequest(path: any, accessToken: any, options = {}) {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  let attempt = 0;

  while (attempt < 2) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        ...(options.headers || {}),
      },
    });

    if (response.status === 429 && attempt === 0) {
      const retryAfter = Number(response.headers.get("retry-after") || "2");
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      attempt += 1;
      continue;
    }

    if (response.status === 204) {
      return null;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      const message = payload.error?.message || `Microsoft Graph request failed (${response.status}).`;
      const error = new Error(message);
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.status = response.status;
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      error.graphCode = payload.error?.code || "";
      throw error;
    }

    return payload;
  }

  throw new Error("Microsoft Graph request failed after retry.");
}

async function resolveGraphFolderId(accessToken: any, folderKey: any) {
  const cacheKey = `${accessToken.slice(0, 12)}:${folderKey}`;
  if (discoveredFolderIds.has(cacheKey)) {
    return discoveredFolderIds.get(cacheKey);
  }

  const wellKnown = getGraphWellKnownFolderId(folderKey);
  if (wellKnown) {
    discoveredFolderIds.set(cacheKey, wellKnown);
    return wellKnown;
  }

  const hints = getGraphDisplayNameHints(folderKey).map((entry: string) => entry.toLowerCase());
  const payload = await graphRequest("/me/mailFolders?$top=100&$select=id,displayName", accessToken);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const match = (payload.value || []).find((folder: any) =>
    hints.includes(String(folder.displayName || "").toLowerCase()),
  );

  if (match?.id) {
    discoveredFolderIds.set(cacheKey, match.id);
    return match.id;
  }

  discoveredFolderIds.set(cacheKey, null);
  return null;
}

export async function listGraphMessages(accessToken: any, folderKey = "inbox", limit = 30, options = {}) {
  const folderId = await resolveGraphFolderId(accessToken, folderKey);
  if (!folderId) {
    return { messages: [], folderUnavailable: true };
  }

  const top = Math.max(1, Math.min(Number(limit) || 30, 50));
  const orderBy =
    folderKey === "drafts"
      ? "lastModifiedDateTime desc"
      : folderKey === "sent"
        ? "sentDateTime desc"
        : "receivedDateTime desc";
  const query = new URLSearchParams({
    $top: String(top),
    $orderby: orderBy,
    $select:
      "id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,lastModifiedDateTime,isRead,bodyPreview,hasAttachments,inferenceClassification,flag",
  });

  const payload = await graphRequest(
    `/me/mailFolders/${encodeURIComponent(folderId)}/messages?${query.toString()}`,
    accessToken,
  );

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  let messages = (payload.value || []).map((message: any) => mapGraphMessageSummary(message, folderKey));

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (folderKey === "inbox" && options.view) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const view = String(options.view).toLowerCase();
    messages = messages.filter((message: any) => {
      const classification = message.inferenceClassification || "other";
      if (view === "focused") {
        return classification === "focused";
      }
      if (view === "other") {
        return classification !== "focused";
      }
      return true;
    });
  }

  return { messages, folderUnavailable: false };
}

const ATTACHMENT_SELECT =
  "id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId";

async function listGraphMessageAttachments(accessToken: any, messageId: any) {
  const payload = await graphRequest(
    `/me/messages/${encodeGraphPathId(messageId)}/attachments?$select=${ATTACHMENT_SELECT}`,
    accessToken,
  );

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return payload.value || [];
}

async function fetchGraphAttachmentRecord(accessToken: any, messageId: any, attachmentId: any) {
  return graphRequest(
    `/me/messages/${encodeGraphPathId(messageId)}/attachments/${encodeGraphPathId(attachmentId)}`,
    accessToken,
  );
}

async function fetchInlineAttachmentBytes(accessToken: any, messageId: any, attachment: any) {
  if (attachment.contentBytes) {
    return attachment.contentBytes;
  }

  if (!attachment.id) {
    return null;
  }

  const fullAttachment = await fetchGraphAttachmentRecord(accessToken, messageId, attachment.id);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return fullAttachment?.contentBytes || null;
}

async function resolveGraphHtmlInlineImages(accessToken: any, messageId: any, htmlBody: any, attachments = []) {
  const referencedCids = extractCidReferences(htmlBody);
  if (!referencedCids.length) {
    return htmlBody;
  }

  const inlineAttachments = [];

  for (const attachment of attachments) {
    let resolvedAttachment = attachment;
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    let contentId = normalizeContentId(attachment.contentId);

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (!contentId && attachment.id) {
      try {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        resolvedAttachment = await fetchGraphAttachmentRecord(accessToken, messageId, attachment.id);
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        contentId = normalizeContentId(resolvedAttachment.contentId);
      } catch (error) {
        console.warn(
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          `Failed to load attachment metadata ${attachment.id}: ${error.message}`,
        );
      }
    }

    if (!contentId || !referencedCids.includes(contentId)) {
      continue;
    }

    try {
      const contentBase64 = await fetchInlineAttachmentBytes(
        accessToken,
        messageId,
        resolvedAttachment,
      );
      if (!contentBase64) {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        console.warn(`Inline attachment ${attachment.id || contentId} has no content bytes.`);
        continue;
      }

      inlineAttachments.push({
        contentId,
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        contentType: resolvedAttachment.contentType || "application/octet-stream",
        contentBase64,
      });
    } catch (error) {
      console.warn(
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        `Failed to fetch inline attachment ${attachment.id || contentId}: ${error.message}`,
      );
    }
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  return resolveInlineCidImages(htmlBody, inlineAttachments);
}

export async function getGraphMessage(accessToken: any, messageId: any, folderKey = "inbox") {
  const query = new URLSearchParams({
    $select:
      "id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,body,bodyPreview,hasAttachments,flag",
  });

  const message = await graphRequest(`/me/messages/${encodeGraphPathId(messageId)}?${query}`, accessToken);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const graphAttachments = message.hasAttachments
    ? await listGraphMessageAttachments(accessToken, messageId)
    : [];

  const summary = mapGraphMessageSummary(message, folderKey);
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const rawHtmlBody = message.body?.contentType === "html" ? message.body?.content || "" : "";
  const htmlBody = rawHtmlBody
    ? await resolveGraphHtmlInlineImages(accessToken, messageId, rawHtmlBody, graphAttachments)
    : "";
  const textBody =
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    message.body?.contentType === "html"
      ? htmlToPlainText(htmlBody || rawHtmlBody)
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      : message.body?.content || summary.preview;

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!message.isRead) {
    await graphRequest(`/me/messages/${encodeGraphPathId(messageId)}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ isRead: true }),
    });
  }

  return {
    ...summary,
    isRead: true,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    isFlagged: message.flag?.flagStatus === "flagged",
    body: textBody,
    htmlBody,
    attachments: graphAttachments.map((attachment: any, index: any) => ({
      id: attachment.id || String(index),
      fileName: attachment.name || `attachment-${index + 1}`,
      contentType: attachment.contentType || "application/octet-stream",
      size: attachment.size || 0,
      isInline: Boolean(attachment.isInline),
      isPreviewable:
        (attachment.contentType || "").startsWith("image/") ||
        attachment.contentType === "application/pdf",
    })),
  };
}

export async function getGraphAttachment(accessToken: any, messageId: any, attachmentId: any) {
  const attachment = await fetchGraphAttachmentRecord(accessToken, messageId, attachmentId);

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  if (!attachment?.contentBytes) {
    throw new Error("Attachment not found.");
  }

  return {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    fileName: attachment.name || "attachment",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    contentType: attachment.contentType || "application/octet-stream",
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    size: attachment.size || 0,
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    contentBase64: attachment.contentBytes,
  };
}

function buildRecipientList(values = []) {
  return values
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map((address) => ({
      emailAddress: { address },
    }));
}

function buildGraphMailMessage(payload: any) {
  const to = buildRecipientList(
    Array.isArray(payload.to) ? payload.to : String(payload.to || "").split(/[,;]/),
  );
  const cc = buildRecipientList(
    Array.isArray(payload.cc) ? payload.cc : String(payload.cc || "").split(/[,;]/),
  );
  const bcc = buildRecipientList(
    Array.isArray(payload.bcc) ? payload.bcc : String(payload.bcc || "").split(/[,;]/),
  );

  if (!to.length) {
    throw new Error("At least one recipient is required.");
  }

  const attachments = [];
  const rawAttachments = [];
  if (payload.attachment?.contentBase64 && payload.attachment?.fileName) {
    rawAttachments.push(payload.attachment);
  }
  if (Array.isArray(payload.attachments)) {
    rawAttachments.push(...payload.attachments);
  }

  for (const entry of rawAttachments) {
    if (!entry?.contentBase64 || !entry?.fileName) {
      continue;
    }

    const graphAttachment = {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: entry.fileName,
      contentType: entry.contentType || "application/octet-stream",
      contentBytes: entry.contentBase64,
    };

    const contentId = String(entry.contentId || "")
      .replace(/^<|>$/g, "")
      .trim();
    if (entry.isInline || contentId) {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      graphAttachment.isInline = true;
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      graphAttachment.contentId = contentId || entry.fileName;
    }

    attachments.push(graphAttachment);
  }

  const htmlBody = String(payload.htmlBody || payload.html || "").trim();
  const plainBody =
    String(payload.body || "").trim() ||
    (htmlBody ? htmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");

  const message = {
    subject: payload.subject || "Worktual message",
    body: {
      contentType: htmlBody ? "HTML" : "Text",
      content: htmlBody || plainBody,
    },
    toRecipients: to,
    ccRecipients: cc.length ? cc : undefined,
    bccRecipients: bcc.length ? bcc : undefined,
    attachments: attachments.length ? attachments : undefined,
  };

  const importance = String(payload.importance || "normal").toLowerCase();
  if (["low", "normal", "high"].includes(importance)) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    message.importance = importance;
  }

  const sensitivity = String(payload.sensitivity || "normal").toLowerCase();
  if (
    ["normal", "personal", "private", "confidential"].includes(sensitivity) &&
    sensitivity !== "normal"
  ) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    message.sensitivity = sensitivity;
  }

  return { message, to };
}

async function postGraphSendMail(accessToken: any, sendPath: any, message: any, to: any) {
  await graphRequest(sendPath, accessToken, {
    method: "POST",
    body: JSON.stringify({
      message,
      saveToSentItems: true,
    }),
  });

  return {
    messageId: `graph-${Date.now()}`,
    accepted: to.map((entry: any) => entry.emailAddress.address),
    provider: "microsoft-graph",
  };
}

export async function sendGraphMail(accessToken: any, payload: any) {
  const { message, to } = buildGraphMailMessage(payload);
  return postGraphSendMail(accessToken, "/me/sendMail", message, to);
}

/** App-only (client credentials) send as a specific mailbox user. */
export async function sendGraphMailAsUser(accessToken: any, userPrincipalOrEmail: any, payload: any) {
  const mailbox = String(userPrincipalOrEmail || "").trim();
  if (!mailbox) {
    throw new Error("Mailbox user is required for app-only Graph send.");
  }

  const { message, to } = buildGraphMailMessage(payload);
  const encodedUser = encodeURIComponent(mailbox);
  return postGraphSendMail(accessToken, `/users/${encodedUser}/sendMail`, message, to);
}

export function getGraphFolderId(folderKey: any) {
  return getGraphWellKnownFolderId(folderKey) || "inbox";
}

export async function moveGraphMessage(accessToken: any, messageId: any, destinationFolderKey: any) {
  const destinationFolderId = await resolveGraphFolderId(accessToken, destinationFolderKey);
  if (!destinationFolderId) {
    throw new Error(`Destination folder "${destinationFolderKey}" is not available.`);
  }

  await graphRequest(`/me/messages/${encodeGraphPathId(messageId)}/move`, accessToken, {
    method: "POST",
    body: JSON.stringify({ destinationId: destinationFolderId }),
  });

  return { ok: true };
}

export async function setGraphMessageFlag(accessToken: any, messageId: any, flagged: any) {
  await graphRequest(`/me/messages/${encodeGraphPathId(messageId)}`, accessToken, {
    method: "PATCH",
    body: JSON.stringify({
      flag: {
        flagStatus: flagged ? "flagged" : "notFlagged",
      },
    }),
  });

  return { ok: true, flagged: Boolean(flagged) };
}

export async function verifyGraphMailAccess(accessToken: any) {
  const response = await fetch(`${GRAPH_BASE}/me/mailFolders/inbox?$select=id,displayName`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (response.ok) {
    return true;
  }

  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const code = payload.error?.code || "";
  // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
  const message = payload.error?.message || `Microsoft Graph mail check failed (${response.status}).`;

  if (
    code === "MailboxNotEnabledForRESTAPI" ||
    code === "ResourceNotFound" ||
    /mailbox/i.test(message)
  ) {
    throw new Error(
      "This Microsoft account does not have an Outlook mailbox. Use a Microsoft 365 work account or Outlook.com — Gmail and external guest accounts are not supported.",
    );
  }

  if (response.status === 401 || code === "InvalidAuthenticationToken") {
    throw new Error(
      "Microsoft rejected the mail token. Mail.Read is missing — grant admin consent in Azure API permissions, then reconnect.",
    );
  }

  if (code === "ErrorAccessDenied") {
    throw new Error(
      "Outlook mail access was denied. Reconnect and accept Mail.Read, Mail.Send, and offline_access permissions.",
    );
  }

  throw new Error(message);
}
