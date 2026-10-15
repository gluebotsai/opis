const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const FOLDER_IDS = {
  inbox: "inbox",
  sent: "sentitems",
  spam: "junkemail",
};

function stripHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRecipients(recipients = []) {
  return recipients
    .map((entry) => {
      const address = entry?.emailAddress?.address || "";
      const name = entry?.emailAddress?.name || "";
      if (name && address) {
        return `${name} <${address}>`;
      }

      return address || name;
    })
    .filter(Boolean)
    .join(", ");
}

function mapGraphMessageSummary(message, folderKey) {
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
    subject: message.subject || "",
    date: message.receivedDateTime || message.sentDateTime || null,
    preview: message.bodyPreview || "",
    isRead: Boolean(message.isRead),
    hasAttachments: Boolean(message.hasAttachments),
  };
}

async function graphRequest(path, accessToken, options = {}) {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  let attempt = 0;

  while (attempt < 2) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
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
      const message = payload.error?.message || `Microsoft Graph request failed (${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      error.graphCode = payload.error?.code || "";
      throw error;
    }

    return payload;
  }

  throw new Error("Microsoft Graph request failed after retry.");
}

export async function listGraphMessages(accessToken, folderKey = "inbox", limit = 30) {
  const folderId = FOLDER_IDS[folderKey] || FOLDER_IDS.inbox;
  const top = Math.max(1, Math.min(Number(limit) || 30, 50));
  const query = new URLSearchParams({
    $top: String(top),
    $orderby: folderKey === "sent" ? "sentDateTime desc" : "receivedDateTime desc",
    $select:
      "id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview,hasAttachments",
  });

  const payload = await graphRequest(
    `/me/mailFolders/${folderId}/messages?${query.toString()}`,
    accessToken,
  );

  return (payload.value || []).map((message) => mapGraphMessageSummary(message, folderKey));
}

export async function getGraphMessage(accessToken, messageId, folderKey = "inbox") {
  const query = new URLSearchParams({
    $select:
      "id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,body,bodyPreview,hasAttachments",
    $expand: "attachments($select=id,name,contentType,size)",
  });

  const message = await graphRequest(`/me/messages/${encodeURIComponent(messageId)}?${query}`, accessToken);

  const summary = mapGraphMessageSummary(message, folderKey);
  const textBody =
    message.body?.contentType === "html"
      ? stripHtml(message.body?.content)
      : message.body?.content || summary.preview;

  if (!message.isRead) {
    await graphRequest(`/me/messages/${encodeURIComponent(messageId)}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ isRead: true }),
    });
  }

  return {
    ...summary,
    isRead: true,
    body: textBody,
    htmlBody: message.body?.contentType === "html" ? message.body?.content || "" : "",
    attachments: (message.attachments || []).map((attachment, index) => ({
      id: attachment.id || String(index),
      fileName: attachment.name || `attachment-${index + 1}`,
      contentType: attachment.contentType || "application/octet-stream",
      size: attachment.size || 0,
      isPreviewable:
        (attachment.contentType || "").startsWith("image/") ||
        attachment.contentType === "application/pdf",
    })),
  };
}

export async function getGraphAttachment(accessToken, messageId, attachmentId) {
  const attachment = await graphRequest(
    `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    accessToken,
  );

  if (!attachment?.contentBytes) {
    throw new Error("Attachment not found.");
  }

  return {
    fileName: attachment.name || "attachment",
    contentType: attachment.contentType || "application/octet-stream",
    size: attachment.size || 0,
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

export async function sendGraphMail(accessToken, payload) {
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

    attachments.push({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: entry.fileName,
      contentType: entry.contentType || "application/octet-stream",
      contentBytes: entry.contentBase64,
    });
  }

  const message = {
    subject: payload.subject || "Worktual message",
    body: {
      contentType: "Text",
      content: payload.body || "",
    },
    toRecipients: to,
    ccRecipients: cc.length ? cc : undefined,
    bccRecipients: bcc.length ? bcc : undefined,
    attachments: attachments.length ? attachments : undefined,
  };

  await graphRequest("/me/sendMail", accessToken, {
    method: "POST",
    body: JSON.stringify({
      message,
      saveToSentItems: true,
    }),
  });

  return {
    messageId: `graph-${Date.now()}`,
    accepted: to.map((entry) => entry.emailAddress.address),
    provider: "microsoft-graph",
  };
}

export function getGraphFolderId(folderKey) {
  return FOLDER_IDS[folderKey] || FOLDER_IDS.inbox;
}

export async function verifyGraphMailAccess(accessToken) {
  const response = await fetch(`${GRAPH_BASE}/me/mailFolders/inbox?$select=id,displayName`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (response.ok) {
    return true;
  }

  const code = payload.error?.code || "";
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
