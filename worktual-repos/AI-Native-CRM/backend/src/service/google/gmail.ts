/**
 * Gmail API helpers (send + read).
 * Requires gmail.send for outbound; gmail.readonly for inbound sync.
 */

import { randomBytes } from "crypto";
import {
  decodeBase64Url,
  extractEmailBodyFromPayload,
} from "@/lib/email-body";
import {
  encodeMimeHeaderValue,
  encodeQuotedPrintable,
  formatFromHeader,
  normalizeEmailSubject,
  toOutboundEmailBodies,
} from "@/lib/outbound-email";

const GMAIL_SEND =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_MESSAGES =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export type SendGmailAttachment = {
  filename: string;
  contentType: string;
  /** Raw file contents (not base64) */
  content: string | Buffer;
};

export type SendGmailInput = {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  /** Gmail thread to keep replies in the same conversation */
  threadId?: string | null;
  /** RFC Message-ID of the parent (for In-Reply-To / References) */
  inReplyToRfcMessageId?: string | null;
  /** Prior References header chain (optional) */
  references?: string | null;
  attachments?: SendGmailAttachment[];
};

export type GmailSendResult = {
  id: string;
  threadId: string;
  rfcMessageId: string | null;
};

function encodeBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Ensure Message-ID uses angle brackets for MIME headers. */
export function normalizeRfcMessageId(
  raw: string | null | undefined,
): string | null {
  if (!raw?.trim()) return null;
  const cleaned = raw.trim().replace(/^<|>$/g, "");
  if (!cleaned) return null;
  return `<${cleaned}>`;
}

function mimeBoundary(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function buildAlternativePart(body: string): string {
  const boundary = mimeBoundary("alt");
  const { plain, html } = toOutboundEmailBodies(body);
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(plain),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    encodeQuotedPrintable(html),
    `--${boundary}--`,
  ].join("\r\n");
}

function buildMimeMessage(input: SendGmailInput): string {
  const inReplyTo = normalizeRfcMessageId(input.inReplyToRfcMessageId);
  const references = [input.references?.trim(), inReplyTo]
    .filter(Boolean)
    .join(" ")
    .trim();

  const from = input.fromEmail?.trim()
    ? formatFromHeader(input.fromEmail, input.fromName)
    : null;

  const headers = [
    `To: ${input.to.trim()}`,
    input.cc?.trim() ? `Cc: ${input.cc.trim()}` : null,
    from ? `From: ${from}` : null,
    `Subject: ${encodeMimeHeaderValue(normalizeEmailSubject(input.subject))}`,
    `Date: ${new Date().toUTCString()}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    "MIME-Version: 1.0",
  ].filter((line): line is string => Boolean(line));

  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    return [...headers, buildAlternativePart(input.body)].join("\r\n");
  }

  const mixed = mimeBoundary("mix");
  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    buildAlternativePart(input.body),
  ];

  for (const file of attachments) {
    const bytes = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, "utf8");
    parts.push(
      `--${mixed}`,
      `Content-Type: ${file.contentType}; name="${file.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${file.filename}"`,
      "",
      bytes.toString("base64").replace(/(.{76})/g, "$1\r\n").trim(),
    );
  }

  parts.push(`--${mixed}--`);
  return parts.join("\r\n");
}

export async function sendGmailMessage(
  input: SendGmailInput,
): Promise<GmailSendResult> {
  const raw = encodeBase64Url(buildMimeMessage(input));
  const payload: { raw: string; threadId?: string } = { raw };
  if (input.threadId?.trim()) {
    payload.threadId = input.threadId.trim();
  }

  const res = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send failed: ${text}`);
  }

  const data = (await res.json()) as { id?: string; threadId?: string };
  const id = data.id ?? "";
  const threadId = data.threadId ?? "";

  let rfcMessageId: string | null = null;
  if (id) {
    try {
      const detail = await getGmailMessage({
        accessToken: input.accessToken,
        messageId: id,
      });
      rfcMessageId = detail.rfcMessageId;
    } catch {
      // Send succeeded; RFC id is best-effort for future replies
    }
  }

  return { id, threadId, rfcMessageId };
}

export type GmailListedMessage = {
  id: string;
  threadId: string;
};

export async function listGmailMessages(input: {
  accessToken: string;
  query?: string;
  maxResults?: number;
}): Promise<GmailListedMessage[]> {
  const params = new URLSearchParams({
    maxResults: String(Math.min(input.maxResults ?? 40, 100)),
  });
  if (input.query?.trim()) params.set("q", input.query.trim());

  const res = await fetch(`${GMAIL_MESSAGES}?${params}`, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail list failed: ${text}`);
  }

  const data = (await res.json()) as {
    messages?: { id: string; threadId: string }[];
  };
  return (data.messages ?? []).map((m) => ({
    id: m.id,
    threadId: m.threadId,
  }));
}

/** Move a Gmail message to Trash — requires gmail.modify scope. Idempotent. */
export async function trashGmailMessage(input: {
  accessToken: string;
  messageId: string;
}): Promise<void> {
  const res = await fetch(
    `${GMAIL_MESSAGES}/${encodeURIComponent(input.messageId)}/trash`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail trash failed: ${text}`);
  }
}

/** Messages in a Gmail thread (for syncing customer replies). */
export async function listGmailThreadMessages(input: {
  accessToken: string;
  threadId: string;
}): Promise<GmailListedMessage[]> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.threadId)}?format=minimal`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail thread get failed: ${text}`);
  }
  const data = (await res.json()) as {
    id?: string;
    messages?: { id: string; threadId?: string }[];
  };
  const threadId = data.id ?? input.threadId;
  return (data.messages ?? []).map((m) => ({
    id: m.id,
    threadId: m.threadId ?? threadId,
  }));
}

function headerValue(
  headers: { name: string; value: string }[] | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const found = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

function extractPlainBody(payload: {
  mimeType?: string;
  body?: { data?: string };
  parts?: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }[];
}): string {
  return extractEmailBodyFromPayload(payload as Parameters<typeof extractEmailBodyFromPayload>[0]);
}

export type GmailMessageDetail = {
  id: string;
  threadId: string;
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string;
  body: string;
  rfcMessageId: string | null;
  references: string | null;
  internalDate: Date;
  labelIds: string[];
};

export async function getGmailMessage(input: {
  accessToken: string;
  messageId: string;
}): Promise<GmailMessageDetail> {
  const res = await fetch(
    `${GMAIL_MESSAGES}/${encodeURIComponent(input.messageId)}?format=full`,
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail get failed: ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    threadId: string;
    internalDate?: string;
    labelIds?: string[];
    payload?: {
      mimeType?: string;
      headers?: { name: string; value: string }[];
      body?: { data?: string };
      parts?: {
        mimeType?: string;
        body?: { data?: string };
        parts?: unknown[];
      }[];
    };
  };

  const headers = data.payload?.headers;
  return {
    id: data.id,
    threadId: data.threadId,
    from: headerValue(headers, "From"),
    to: headerValue(headers, "To"),
    cc: headerValue(headers, "Cc"),
    subject: headerValue(headers, "Subject") ?? "(No subject)",
    body: data.payload ? extractPlainBody(data.payload) : "",
    rfcMessageId: normalizeRfcMessageId(headerValue(headers, "Message-ID")),
    references: headerValue(headers, "References"),
    internalDate: data.internalDate
      ? new Date(Number(data.internalDate))
      : new Date(),
    labelIds: data.labelIds ?? [],
  };
}

/** Extract bare email from "Name <email@x.com>" or plain address. */
export function parseEmailAddress(raw: string | null | undefined): string | null {
  const all = parseAllEmailAddresses(raw);
  return all[0] ?? null;
}

/** All emails from a header that may list multiple recipients. */
export function parseAllEmailAddresses(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) return [];
  const found = new Set<string>();
  const angled = [...raw.matchAll(/<([^>]+)>/g)];
  if (angled.length > 0) {
    for (const m of angled) {
      const email = m[1].trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) found.add(email);
    }
  } else {
    for (const part of raw.split(/[,;]/)) {
      const email = part.trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) found.add(email);
    }
  }
  return [...found];
}

export type GmailWatchResult = {
  historyId: string;
  expiration: Date;
};

/** Register Gmail Pub/Sub push (users.watch). Requires cloud-platform Pub/Sub topic IAM. */
export async function registerGmailWatch(input: {
  accessToken: string;
  topicName: string;
}): Promise<GmailWatchResult> {
  const res = await fetch(`${GMAIL_BASE}/watch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topicName: input.topicName,
      // No labelIds — customer replies may land in All Mail / archived.
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail watch failed: ${text}`);
  }
  const data = (await res.json()) as {
    historyId?: string;
    expiration?: string;
  };
  if (!data.historyId || !data.expiration) {
    throw new Error("Gmail watch returned incomplete payload");
  }
  return {
    historyId: String(data.historyId),
    expiration: new Date(Number(data.expiration)),
  };
}

/** Stop an active Gmail push watch for this OAuth token. */
export async function stopGmailWatch(accessToken: string): Promise<void> {
  const res = await fetch(`${GMAIL_BASE}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Gmail stop watch failed: ${text}`);
  }
}

export type GmailHistoryAddedResult = {
  messageIds: string[];
  /** Newest history id from the list response (advance watch cursor). */
  historyId: string | null;
};

/**
 * List message ids added since startHistoryId (exclusive).
 * Paginates until caught up or maxPages.
 */
export async function listGmailHistoryAddedMessages(input: {
  accessToken: string;
  startHistoryId: string;
  maxPages?: number;
}): Promise<GmailHistoryAddedResult> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let newestHistoryId: string | null = null;
  const maxPages = input.maxPages ?? 8;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      startHistoryId: input.startHistoryId,
      historyTypes: "messageAdded",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${GMAIL_BASE}/history?${params}`, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 404) {
      const err = new Error("GMAIL_HISTORY_EXPIRED") as Error & {
        code?: string;
      };
      err.code = "GMAIL_HISTORY_EXPIRED";
      throw err;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gmail history.list failed: ${text}`);
    }

    const data = (await res.json()) as {
      history?: Array<{
        messagesAdded?: Array<{ message?: { id?: string } }>;
      }>;
      historyId?: string;
      nextPageToken?: string;
    };

    for (const record of data.history ?? []) {
      for (const added of record.messagesAdded ?? []) {
        const id = added.message?.id?.trim();
        if (id) ids.add(id);
      }
    }
    if (data.historyId) newestHistoryId = data.historyId;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return { messageIds: [...ids], historyId: newestHistoryId };
}
