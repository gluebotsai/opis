/**
 * Microsoft Graph mail read helpers (inbound sync).
 * Send lives in send-email.ts; this module only lists / fetches messages.
 */

import { htmlToPlainText } from "@/lib/email-body";

const MS_GRAPH = "https://graph.microsoft.com/v1.0";

export type GraphMailMessage = {
  id: string;
  conversationId: string | null;
  internetMessageId: string | null;
  subject: string;
  body: string;
  from: string | null;
  to: string | null;
  cc: string | null;
  receivedAt: Date;
  isDraft: boolean;
  folder: "inbox" | "sent" | "trash" | "draft";
};

type GraphRecipient = {
  emailAddress?: { name?: string | null; address?: string | null } | null;
};

type GraphMessageRaw = {
  id: string;
  conversationId?: string | null;
  internetMessageId?: string | null;
  subject?: string | null;
  bodyPreview?: string | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  from?: GraphRecipient | null;
  sender?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  isDraft?: boolean | null;
  parentFolderId?: string | null;
};

function formatRecipient(r: GraphRecipient | null | undefined): string | null {
  const address = r?.emailAddress?.address?.trim();
  if (!address) return null;
  const name = r?.emailAddress?.name?.trim();
  return name && name !== address ? `${name} <${address}>` : address;
}

function formatRecipients(
  list: GraphRecipient[] | null | undefined,
): string | null {
  const parts = (list ?? [])
    .map((r) => formatRecipient(r))
    .filter((v): v is string => Boolean(v));
  return parts.length ? parts.join(", ") : null;
}

/** Extract every email address from a formatted header string. */
export function parseGraphEmailAddresses(
  header: string | null | undefined,
): string[] {
  if (!header?.trim()) return [];
  const matches = header.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
  return matches.map((m) => m.toLowerCase());
}

function graphErrorMessage(status: number, body: string): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string };
    };
    const msg = parsed.error?.message;
    const code = parsed.error?.code;
    if (msg) detail = code ? `${code}: ${msg}` : msg;
  } catch {
    /* keep raw body */
  }
  return `Microsoft mail read failed (${status}): ${detail || "No details"}`;
}

async function graphGet<T>(
  accessToken: string,
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${MS_GRAPH}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: graphErrorMessage(res.status, text) };
  }
  return { ok: true, data: (await res.json()) as T };
}

function toMessage(
  raw: GraphMessageRaw,
  folder: GraphMailMessage["folder"],
): GraphMailMessage {
  const contentType = raw.body?.contentType?.toLowerCase() ?? "text";
  const rawContent = raw.body?.content ?? raw.bodyPreview ?? "";
  // Store plain text so Inbox rendering matches the Gmail path.
  const body =
    contentType === "html" ? htmlToPlainText(rawContent) : rawContent;

  const when = raw.receivedDateTime || raw.sentDateTime;
  return {
    id: raw.id,
    conversationId: raw.conversationId?.trim() || null,
    internetMessageId: raw.internetMessageId?.trim() || null,
    subject: raw.subject?.trim() || "(No subject)",
    body: body.trim(),
    from: formatRecipient(raw.from ?? raw.sender),
    to: formatRecipients(raw.toRecipients),
    cc: formatRecipients(raw.ccRecipients),
    receivedAt: when ? new Date(when) : new Date(),
    isDraft: Boolean(raw.isDraft),
    folder,
  };
}

const SELECT_FIELDS =
  "id,conversationId,internetMessageId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft";

/** List recent messages from a well-known folder (inbox / sentitems). */
export async function listGraphFolderMessages(args: {
  accessToken: string;
  folder: "inbox" | "sentitems";
  top?: number;
}): Promise<
  | { ok: true; messages: GraphMailMessage[] }
  | { ok: false; status: number; error: string }
> {
  const top = Math.min(Math.max(args.top ?? 40, 1), 100);
  const path =
    `/me/mailFolders/${args.folder}/messages` +
    `?$select=${SELECT_FIELDS}&$top=${top}&$orderby=receivedDateTime desc`;

  const result = await graphGet<{ value: GraphMessageRaw[] }>(
    args.accessToken,
    path,
  );
  if (!result.ok) return result;

  const folder: GraphMailMessage["folder"] =
    args.folder === "sentitems" ? "sent" : "inbox";
  return {
    ok: true,
    messages: (result.data.value ?? []).map((raw) => toMessage(raw, folder)),
  };
}

/** Fetch all messages in one conversation so replies stay threaded. */
export async function listGraphConversationMessages(args: {
  accessToken: string;
  conversationId: string;
  top?: number;
}): Promise<
  | { ok: true; messages: GraphMailMessage[] }
  | { ok: false; status: number; error: string }
> {
  const top = Math.min(Math.max(args.top ?? 25, 1), 100);
  const filter = encodeURIComponent(`conversationId eq '${args.conversationId}'`);
  const path =
    `/me/messages?$select=${SELECT_FIELDS}&$filter=${filter}&$top=${top}`;

  const result = await graphGet<{ value: GraphMessageRaw[] }>(
    args.accessToken,
    path,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    messages: (result.data.value ?? []).map((raw) => toMessage(raw, "inbox")),
  };
}

/** Fetch one message by Graph id (for Reply all recipient headers). */
export async function getGraphMessage(args: {
  accessToken: string;
  messageId: string;
}): Promise<
  | { ok: true; message: GraphMailMessage }
  | { ok: false; status: number; error: string }
> {
  const path = `/me/messages/${encodeURIComponent(args.messageId)}?$select=${SELECT_FIELDS}`;
  const result = await graphGet<GraphMessageRaw>(args.accessToken, path);
  if (!result.ok) return result;
  return { ok: true, message: toMessage(result.data, "inbox") };
}
