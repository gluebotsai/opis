import { google, type gmail_v1 } from "googleapis";

import type { GmailRuntimeCredentials } from "./credential-store.js";

export type GmailMessageMetadata = {
  messageId: string;
  threadId: string;
  from: string;
  senderEmail: string;
  subject: string;
  dateHeader: string | null;
  messageHeaderId: string | null;
  inReplyTo: string | null;
  references: string | null;
  replyTo: string | null;
  to: string | null;
  cc: string | null;
  labelIds: string[];
  body: string;
  htmlBody: string | null;
  headers: Record<string, string>;
  attachments: Array<{
    attachmentId: string | null;
    fileName: string;
    contentType: string;
    byteSize: number;
    inlineData: string | null;
  }>;
};

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  for (const header of headers ?? []) {
    if (header.name?.toLowerCase() === name.toLowerCase()) {
      return header.value ?? "";
    }
  }
  return "";
}

export function extractEmailAddress(fromHeader: string): string {
  if (fromHeader.includes("<") && fromHeader.includes(">")) {
    return fromHeader.split("<")[1]?.split(">")[0]?.trim() ?? fromHeader.trim();
  }
  return fromHeader.trim();
}

function decodeBody(data: string | null | undefined): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

export function sanitizeHtmlToText(value: string): string {
  return value
    .replace(/<(script|style|iframe|object)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractBodies(
  payload: gmail_v1.Schema$MessagePart | undefined,
): { plain: string; html: string | null } {
  if (!payload) return { plain: "", html: null };

  if (payload.body?.data && payload.mimeType === "text/plain") {
    return { plain: decodeBody(payload.body.data).trim(), html: null };
  }
  if (payload.body?.data && payload.mimeType === "text/html") {
    const html = decodeBody(payload.body.data).trim();
    return { plain: sanitizeHtmlToText(html), html };
  }

  let plain = "";
  let html: string | null = null;
  for (const part of payload.parts ?? []) {
    if (part.filename) continue;
    const nested = extractBodies(part);
    if (!plain && nested.plain) plain = nested.plain;
    if (!html && nested.html) html = nested.html;
    if (part.mimeType === "text/plain" && part.body?.data) {
      plain = decodeBody(part.body.data).trim();
    }
  }
  return { plain: plain || (html ? sanitizeHtmlToText(html) : ""), html };
}

function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
): GmailMessageMetadata["attachments"] {
  if (!payload) return [];
  const attachments: GmailMessageMetadata["attachments"] = [];
  for (const part of payload.parts ?? []) {
    if (part.filename) {
      attachments.push({
        attachmentId: part.body?.attachmentId ?? null,
        fileName: part.filename,
        contentType: part.mimeType ?? "application/octet-stream",
        byteSize: part.body?.size ?? 0,
        inlineData: part.body?.data ?? null,
      });
    }
    attachments.push(...extractAttachments(part));
  }
  return attachments;
}

export class GmailClient {
  private createService(credentials: GmailRuntimeCredentials): gmail_v1.Gmail {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: credentials.accessToken });
    return google.gmail({ version: "v1", auth });
  }

  async registerWatch(
    credentials: GmailRuntimeCredentials,
    topicName: string,
  ): Promise<{ expiration: string | null; historyId: string | null }> {
    const gmail = this.createService(credentials);
    const response = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName,
        labelIds: ["INBOX"],
      },
    });
    return {
      expiration: response.data.expiration ?? null,
      historyId: response.data.historyId ?? null,
    };
  }

  async listHistory(
    credentials: GmailRuntimeCredentials,
    startHistoryId: string,
  ): Promise<string[]> {
    const gmail = this.createService(credentials);
    const response = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
    });

    const messageIds: string[] = [];
    for (const change of response.data.history ?? []) {
      for (const item of change.messagesAdded ?? []) {
        if (item.message?.id) messageIds.push(item.message.id);
      }
    }
    return messageIds;
  }

  async listUnreadInbox(credentials: GmailRuntimeCredentials, maxResults = 20): Promise<string[]> {
    const gmail = this.createService(credentials);
    const response = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread in:inbox",
      maxResults,
    });
    return (response.data.messages ?? [])
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id));
  }

  async getMessageMetadata(
    credentials: GmailRuntimeCredentials,
    messageId: string,
  ): Promise<GmailMessageMetadata> {
    const gmail = this.createService(credentials);
    const response = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const headers = response.data.payload?.headers;
    const from = getHeader(headers, "From");
    const replyToHeader = getHeader(headers, "Reply-To");
    const bodies = extractBodies(response.data.payload);
    const approvedHeaders = new Set([
      "message-id",
      "in-reply-to",
      "references",
      "from",
      "to",
      "cc",
      "reply-to",
      "date",
      "content-type",
    ]);
    const headerMap = Object.fromEntries(
      (headers ?? [])
        .filter(
          (header) =>
            Boolean(header.name) && approvedHeaders.has(header.name!.toLowerCase()),
        )
        .map((header) => [header.name!.toLowerCase(), header.value ?? ""]),
    );
    return {
      messageId,
      threadId: response.data.threadId ?? messageId,
      from,
      senderEmail: extractEmailAddress(from),
      subject: getHeader(headers, "Subject"),
      dateHeader: getHeader(headers, "Date") || null,
      messageHeaderId: getHeader(headers, "Message-ID") || null,
      inReplyTo: getHeader(headers, "In-Reply-To") || null,
      references: getHeader(headers, "References") || null,
      replyTo: replyToHeader ? extractEmailAddress(replyToHeader) : null,
      to: getHeader(headers, "To") || null,
      cc: getHeader(headers, "Cc") || null,
      labelIds: response.data.labelIds ?? [],
      body: bodies.plain,
      htmlBody: bodies.html,
      headers: headerMap,
      attachments: extractAttachments(response.data.payload),
    };
  }

  async downloadAttachment(
    credentials: GmailRuntimeCredentials,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const gmail = this.createService(credentials);
    const response = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });
    const data = response.data.data;
    if (!data) throw new Error("Gmail attachment has no content");
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }

  async markAsRead(credentials: GmailRuntimeCredentials, messageId: string): Promise<void> {
    const gmail = this.createService(credentials);
    await gmail.users.messages.batchModify({
      userId: "me",
      requestBody: {
        ids: [messageId],
        removeLabelIds: ["UNREAD"],
      },
    });
  }

  async sendReply(input: {
    credentials: GmailRuntimeCredentials;
    to: string;
    subject: string;
    body: string;
    threadId: string;
    inReplyTo?: string | null;
    references?: string | null;
    attachment?: {
      fileName: string;
      mimeType: string;
      contentBase64: string;
    } | null;
  }): Promise<string> {
    const gmail = this.createService(input.credentials);
    const replySubject = input.subject.toLowerCase().startsWith("re:")
      ? input.subject
      : `Re: ${input.subject}`;

    return this.sendRaw(gmail, {
      to: input.to,
      subject: replySubject,
      body: input.body,
      inReplyTo: input.inReplyTo,
      references: input.references,
      threadId: input.threadId,
      attachment: input.attachment,
    });
  }

  async sendMessage(input: {
    credentials: GmailRuntimeCredentials;
    to: string;
    subject: string;
    body: string;
    attachment?: {
      fileName: string;
      mimeType: string;
      contentBase64: string;
    } | null;
  }): Promise<string> {
    const gmail = this.createService(input.credentials);
    return this.sendRaw(gmail, {
      to: input.to,
      subject: input.subject,
      body: input.body,
      attachment: input.attachment,
    });
  }

  private buildMimeMessage(input: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string | null;
    references?: string | null;
    attachment?: {
      fileName: string;
      mimeType: string;
      contentBase64: string;
    } | null;
  }): string {
    const escapedHtml = input.body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    const altBoundary = `=_worktual_alt_${Date.now().toString(16)}`;
    const alternative = [
      `--${altBoundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      input.body,
      `--${altBoundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      `<html><body>${escapedHtml}</body></html>`,
      `--${altBoundary}--`,
    ].join("\r\n");

    const headers = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      "MIME-Version: 1.0",
    ];
    if (input.inReplyTo) {
      headers.push(`In-Reply-To: ${input.inReplyTo}`);
      headers.push(`References: ${input.references ?? input.inReplyTo}`);
    }

    if (input.attachment) {
      const mixedBoundary = `=_worktual_mixed_${Date.now().toString(16)}`;
      headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
      return [
        ...headers,
        "",
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        "",
        alternative,
        `--${mixedBoundary}`,
        `Content-Type: ${input.attachment.mimeType}; name="${input.attachment.fileName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${input.attachment.fileName}"`,
        "",
        input.attachment.contentBase64.replace(/\s+/g, ""),
        `--${mixedBoundary}--`,
      ].join("\r\n");
    }

    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    return [...headers, "", alternative].join("\r\n");
  }

  private async sendRaw(
    gmail: ReturnType<typeof this.createService>,
    input: {
      to: string;
      subject: string;
      body: string;
      inReplyTo?: string | null;
      references?: string | null;
      threadId?: string;
      attachment?: {
        fileName: string;
        mimeType: string;
        contentBase64: string;
      } | null;
    },
  ): Promise<string> {
    const rawMessage = this.buildMimeMessage(input);
    const raw = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      },
    });

    return response.data.id ?? "";
  }
}
