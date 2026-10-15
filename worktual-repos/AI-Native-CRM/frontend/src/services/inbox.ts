import { api } from "./api";

export type InboxFolder = "inbox" | "sent" | "draft" | "trash";

export type InboxThreadMessage = {
  id: string;
  contactId: string;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  createdAt: string;
  folder: InboxFolder;
  threadId: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  emailDirection: "outbound" | "inbound" | null;
  needsManualResponse: boolean;
};

export type InboxItem = {
  id: string;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactTitle: string | null;
  companyName: string | null;
  companyIndustry: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  contactType: string | null;
  leadSource: string | null;
  ownerUserId: string | null;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  createdAt: string;
  /** Latest message folder (preview) */
  folder: InboxFolder;
  /** All folders that contain messages in this conversation */
  folders: InboxFolder[];
  threadId: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  emailDirection: "outbound" | "inbound" | null;
  needsManualResponse: boolean;
  messageCount: number;
  messages: InboxThreadMessage[];
};

export type InboxContactOption = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
};

export async function fetchInboxThreads(limit = 80) {
  const { data } = await api.get<{ ok: true; items: InboxItem[] }>(
    "/api/inbox/threads",
    {
      params: { limit, _t: Date.now() },
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    },
  );
  return data;
}

export async function fetchInboxThread(threadId: string) {
  const { data } = await api.get<{
    ok: true;
    item: InboxItem | null;
    messages: InboxThreadMessage[];
  } | { ok: false; error: string }>(
    `/api/inbox/threads/${encodeURIComponent(threadId)}`,
  );
  return data;
}

export async function fetchInboxContacts() {
  const { data } = await api.get<{
    ok: true;
    contacts: InboxContactOption[];
  }>("/api/inbox/contacts");
  return data;
}

export async function syncInbox() {
  const { data } = await api.post("/api/inbox/sync");
  return data as
    | {
        ok: true;
        imported: number;
        needsReconnect?: boolean;
        error?: string;
      }
    | { ok: false; error: string; needsReconnect?: boolean };
}

export async function sendInboxEmail(body: {
  contactId?: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  threadId?: string | null;
  gmailThreadId?: string | null;
  inReplyToRfcMessageId?: string | null;
  inReplyToGmailMessageId?: string | null;
  attachments?: { filename: string; contentType: string; content: string }[];
  salesObjection?: {
    kind: string;
    customerLine: string;
    reply: string;
    proofPoint: string | null;
    question: string | null;
  } | null;
}) {
  const { data } = await api.post("/api/inbox/send", body);
  return data as
    | {
        ok: true;
        via: "google" | "microsoft";
        fromEmail: string | null;
        gmailMessageId: string;
        gmailThreadId: string;
        rfcMessageId: string | null;
        contactId: string | null;
      }
    | { ok: false; error: string; needsConnect?: boolean };
}

/** Move a conversation to another folder (e.g. trash it, or restore to inbox). */
export async function updateInboxFolder(id: string, folder: InboxFolder) {
  const { data } = await api.patch(`/api/inbox/${id}/folder`, { folder });
  return data as { ok: true; id: string } | { ok: false; error: string };
}

/** Permanently delete a conversation that is already in Trash. */
export async function purgeInboxTrash(id: string) {
  const { data } = await api.delete(`/api/inbox/${id}`);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

/** Resolve To/Cc for Reply all from the parent message headers. */
export async function fetchReplyAllRecipients(activityId: string) {
  const { data } = await api.get(`/api/inbox/${activityId}/reply-all-recipients`);
  return data as
    | {
        ok: true;
        to: string;
        cc: string[];
        resolvedFromProvider: boolean;
        recipientNotice?: string;
      }
    | { ok: false; error: string };
}

/** Create or update a draft email/call while composing. */
export async function saveInboxDraft(input: {
  draftId?: string | null;
  /** Optional — server uses an Unassigned placeholder when omitted. */
  contactId?: string | null;
  type: "email" | "call";
  subject: string;
  body?: string | null;
  /** Link reply drafts to the conversation thread so Reply reuses one draft. */
  threadId?: string | null;
}) {
  const { data } = await api.post("/api/inbox/draft", input);
  return data as { ok: true; id: string } | { ok: false; error: string };
}

/** AI (or heuristic) suggested reply body for an inbound email thread. */
export async function draftInboxReply(input: {
  contactId?: string | null;
  contactName: string;
  subject: string;
  inboundBody: string;
}) {
  const { data } = await api.post("/api/inbox/draft-reply", input);
  return data as
    | { ok: true; source: "ai" | "heuristic"; draft: string }
    | { ok: false; error: string };
}

export async function scheduleInboxEmail(input: {
  to: string;
  subject: string;
  body: string;
  contactId?: string | null;
  draftId?: string | null;
  sendAt: string;
}) {
  const { data } = await api.post("/api/inbox/schedule", input);
  return data as
    | { ok: true; id: string; sendAt: string }
    | { ok: false; error: string };
}

export async function cancelScheduledInboxEmail(input: {
  id?: string | null;
  draftId?: string | null;
}) {
  const { data } = await api.post("/api/inbox/schedule/cancel", input);
  return data as
    | { ok: true; cancelled: number }
    | { ok: false; error: string };
}

/** Freeform AI compose assist — fills subject + body from a natural-language instruction. */
export async function composeInboxAssist(input: {
  instruction: string;
  contactId?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  subject?: string | null;
  /** Draft already on screen. When set, the instruction revises it. */
  currentBody?: string | null;
  inboundBody?: string | null;
  isReply?: boolean;
}) {
  const { data } = await api.post("/api/inbox/compose-assist", input);
  return data as
    | {
        ok: true;
        source: "ai" | "heuristic";
        subject: string;
        body: string;
      }
    | { ok: false; error: string };
}

/** Resolve (or create) a contact by phone number for outbound call composing. */
export async function resolveContactForPhone(phone: string) {
  const { data } = await api.post("/api/inbox/resolve-phone", { phone });
  return data as
    | { ok: true; contactId: string }
    | { ok: false; error: string };
}

/** Resolve (or create) a contact by email address (used when saving a draft). */
export async function resolveContactForEmail(email: string) {
  const { data } = await api.post("/api/inbox/resolve-email", { email });
  return data as
    | { ok: true; contactId: string }
    | { ok: false; error: string };
}
