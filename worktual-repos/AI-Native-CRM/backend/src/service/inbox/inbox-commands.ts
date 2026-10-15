/**
 * Framework-agnostic inbox commands for Fastify Wave 7.
 */

import { getServerUserId } from "@/service/account/session-cookie";
import { getSetupUserById } from "@/service/account/setup-users";
import { listContactsForSelect } from "@/dao/contacts/contact-service";
import {
  createContactActivity,
  updateContactActivityDraft,
  updateContactActivityFolder,
  purgeContactActivityFromTrash,
} from "@/dao/contacts/contact-activity-service";
import {
  clearManualResponseNeededForThread,
  getInboxItemForThread,
  listInboxItems,
  type InboxFolder,
  type InboxItem,
  type InboxThreadMessage,
} from "@/dao/inbox/inbox-service";
import { syncConnectedMailboxesForUser } from "@/dao/inbox/sync-mailboxes";
import { findOrCreateContactByEmail } from "@/dao/inbox/contact-by-email";
import { findOrCreateContactByPhone } from "@/dao/inbox/contact-by-phone";
import { sendConnectedEmailForUser } from "@/service/email/send-connected-email";
import { resolveGmailThreadIdFromActivities } from "@/service/email/inbound-thread-headers";
import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { heuristicReplyDraft } from "@/service/ai/heuristics";
import { resolveRequestOrganizationId } from "@/service/auth/require-role";
import { normalizeEmailSubject } from "@/lib/outbound-email";
import { prisma } from "@/dao/db/prisma";
import {
  getGmailMessage,
  parseAllEmailAddresses,
  trashGmailMessage,
} from "@/service/google/gmail";
import {
  getValidGoogleAccessToken,
  googleHasGmailModifyScope,
} from "@/service/google/access-token";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import {
  getGraphMessage,
  parseGraphEmailAddresses,
} from "@/service/microsoft/graph-mail";
import { getValidMicrosoftAccessToken } from "@/service/microsoft/send-email";

export type InboxContactOption = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
};

export type InboxActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function listInboxCommand(options?: {
  limit?: number;
}): Promise<{ items: InboxItem[] }> {
  const userId = await getServerUserId();
  if (!userId) return { items: [] };
  const items = await listInboxItems({
    limit: options?.limit ?? 80,
    userId,
  });
  return { items };
}

export async function getInboxThreadCommand(
  threadId: string,
): Promise<
  | { ok: true; messages: InboxThreadMessage[]; item: InboxItem | null }
  | { ok: false; error: string; status?: number }
> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, error: "Sign in again." };

  let item = await getInboxItemForThread(threadId, { userId });
  if (!item) {
    const candidate = await getInboxItemForThread(threadId);
    if (candidate) {
      const { getContactCommand } = await import(
        "@/service/contacts/contact-commands"
      );
      const access = await getContactCommand(candidate.contactId);
      if (!access.ok) {
        return {
          ok: false,
          error: "You do not have access to this email.",
          status: access.status === 404 ? 404 : 403,
        };
      }
      item = candidate;
    }
  }

  return { ok: true, messages: item?.messages ?? [], item };
}

export async function listInboxContactsCommand(): Promise<{
  contacts: InboxContactOption[];
}> {
  const contacts = await listContactsForSelect({ limit: 200 });
  return {
    contacts: contacts.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      email: c.email ?? "",
      phone: c.phone ?? null,
    })),
  };
}

export async function syncInboxCommand(): Promise<
  | {
      ok: true;
      imported: number;
      needsReconnect?: boolean;
      error?: string;
      autoReplyEnqueued?: number;
      autoReplyProcessed?: number;
    }
  | { ok: false; error: string; needsReconnect?: boolean }
> {
  const userId = await getServerUserId();
  if (!userId) {
    return {
      ok: false,
      error: "Sign in again to sync your mailbox.",
      needsReconnect: true,
    };
  }

  const result = await syncConnectedMailboxesForUser(userId, {
    // Inbox poll must return quickly so the UI can reload threads. Auto-reply
    // LLM turns run in the background / via cron instead of blocking sync.
    processAutoReply: false,
  });

  if (result.imported === 0 && result.errors.length > 0 && !result.anyConnected) {
    return {
      ok: true,
      imported: 0,
      needsReconnect: true,
      error: result.errors[0],
    };
  }
  return {
    ok: true,
    imported: result.imported,
    autoReplyEnqueued: result.autoReplyEnqueued,
    autoReplyProcessed: result.autoReplyProcessed,
  };
}

export async function sendInboxEmailCommand(input: {
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
    kind?: string;
    customerLine?: string;
    reply?: string;
    proofPoint?: string | null;
    question?: string | null;
  } | null;
}): Promise<
  | {
      ok: true;
      via: "google" | "microsoft";
      fromEmail: string | null;
      gmailMessageId: string;
      gmailThreadId: string;
      rfcMessageId: string | null;
      contactId: string | null;
    }
  | { ok: false; error: string; needsConnect?: boolean }
> {
  const userId = await getServerUserId();
  if (!userId) {
    return {
      ok: false,
      error: "Sign in again to send email.",
      needsConnect: true,
    };
  }

  let contactId = input.contactId?.trim() || null;
  if (!contactId) {
    contactId = await findOrCreateContactByEmail({
      email: input.to.trim(),
      ownerUserId: userId,
      leadSource: "email_outbound",
    });
  }
  if (!contactId) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const subject = normalizeEmailSubject(input.subject || "Message");

  // Resolve Gmail threading ids from the CRM conversation when the client
  // omitted them (common after draft reuse / older synced messages).
  let gmailThreadId = input.gmailThreadId?.trim() || null;
  let inReplyToRfc = input.inReplyToRfcMessageId?.trim() || null;
  let inReplyToGmail = input.inReplyToGmailMessageId?.trim() || null;

  if (input.threadId?.trim() && (!gmailThreadId || (!inReplyToRfc && !inReplyToGmail))) {
    try {
      const threadRows = await prisma.$queryRawUnsafe<
        Array<{
          gmail_thread_id: string | null;
          gmail_message_id: string | null;
          rfc_message_id: string | null;
          email_direction: string | null;
          created_by_user_id: string | null;
          created_at: Date;
        }>
      >(
        `
        SELECT gmail_thread_id, gmail_message_id, rfc_message_id,
               email_direction::text AS email_direction,
               created_by_user_id::text AS created_by_user_id,
               created_at
        FROM contact_activities
        WHERE type = 'email'
          AND (thread_id = $1 OR id = $1)
        ORDER BY created_at DESC
        LIMIT 20
        `,
        input.threadId.trim(),
      );
      if (!gmailThreadId) {
        gmailThreadId = resolveGmailThreadIdFromActivities(threadRows, {
          mailboxUserId: userId,
        });
      }
      if (!inReplyToRfc && !inReplyToGmail) {
        const parent =
          threadRows.find(
            (r) =>
              r.email_direction === "inbound" &&
              (r.rfc_message_id || r.gmail_message_id) &&
              String(r.created_by_user_id ?? "") === String(userId),
          ) ??
          threadRows.find(
            (r) =>
              r.email_direction === "inbound" &&
              (r.rfc_message_id || r.gmail_message_id),
          ) ??
          threadRows.find((r) => r.rfc_message_id || r.gmail_message_id);
        if (parent) {
          inReplyToRfc = parent.rfc_message_id;
          inReplyToGmail = parent.gmail_message_id;
        }
      }
    } catch {
      // best-effort — still send without thread linkage
    }
  }

  const result = await sendConnectedEmailForUser({
    userId,
    to: input.to,
    subject,
    body: input.body,
    cc: input.cc,
    gmailThreadId,
    inReplyToRfcMessageId: inReplyToRfc,
    inReplyToGmailMessageId: inReplyToGmail,
    attachments: input.attachments,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      needsConnect: result.needsConnect,
    };
  }

  const logBody = [
    input.body,
    input.cc?.trim() ? `Cc: ${input.cc.trim()}` : null,
    result.fromEmail
      ? `Sent via ${result.via === "google" ? "Gmail" : "Microsoft"} (${result.fromEmail})`
      : `Sent via ${result.via === "google" ? "Gmail" : "Microsoft"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const logged = await createContactActivity(contactId, {
    type: "email",
    subject,
    body: logBody,
    folder: "sent",
    threadId: input.threadId ?? null,
    gmailMessageId: result.messageId ?? null,
    gmailThreadId: result.threadId ?? input.gmailThreadId ?? null,
    providerMessageId: result.messageId ?? null,
    providerThreadId: result.threadId ?? input.gmailThreadId ?? null,
    mailProvider: result.via === "google" ? "google" : "microsoft",
    rfcMessageId: result.rfcMessageId ?? null,
    emailDirection: "outbound",
    createdByUserId: userId,
  });
  if (input.salesObjection?.reply) {
    const { recordSalesObjection } = await import("@/service/contacts/sales-guide");
    await recordSalesObjection(logged.id, input.salesObjection).catch(() => undefined);
  }

  await clearManualResponseNeededForThread({
    contactId,
    threadId: input.threadId,
    gmailThreadId: result.threadId ?? input.gmailThreadId,
  });

  // Keep CRM thread_id aligned for every activity that shares this Gmail thread.
  const providerThread = result.threadId ?? input.gmailThreadId ?? null;
  const crmThread = input.threadId?.trim() || null;
  if (providerThread && crmThread) {
    try {
      await prisma.$executeRawUnsafe(
        `
        UPDATE contact_activities
        SET thread_id = $1, updated_at = NOW()
        WHERE created_by_user_id = $2::bigint
          AND (
            gmail_thread_id = $3
            OR provider_thread_id = $3
          )
          AND (thread_id IS DISTINCT FROM $1)
        `,
        crmThread,
        userId,
        providerThread,
      );
    } catch {
      // best-effort
    }
  }

  return {
    ok: true,
    via: result.via,
    fromEmail: result.fromEmail,
    gmailMessageId: result.messageId ?? "",
    gmailThreadId: result.threadId ?? "",
    rfcMessageId: result.rfcMessageId ?? null,
    contactId,
  };
}

/** Move an inbox conversation to another folder (trash / restore / draft). */
export async function updateInboxFolderCommand(
  activityId: string,
  folder: InboxFolder,
): Promise<InboxActionResult> {
  try {
    const updated = await updateContactActivityFolder(activityId, folder);
    return { ok: true, id: updated.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update folder.",
    };
  }
}

/**
 * Best-effort: also trash the underlying Gmail message(s) so the next mailbox
 * sync doesn't reimport what the user just deleted forever from CRM. Never
 * blocks or fails the CRM delete — Gmail API issues are swallowed.
 */
async function trashGmailSiblingsBeforePurge(
  activityId: string,
  userId: string,
): Promise<void> {
  try {
    const existing = await prisma.contactActivity.findUnique({
      where: { id: activityId },
      select: { threadId: true, folder: true },
    });
    if (existing?.folder !== "trash") return;

    const siblings = existing.threadId
      ? await prisma.contactActivity.findMany({
          where: { threadId: existing.threadId, folder: "trash" },
          select: { gmailMessageId: true },
        })
      : await prisma.contactActivity.findMany({
          where: { id: activityId },
          select: { gmailMessageId: true },
        });

    const gmailIds = [
      ...new Set(
        siblings
          .map((s) => s.gmailMessageId)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    if (gmailIds.length === 0) return;

    const conn = await getCalendarConnection(userId, "google");
    if (!conn || !googleHasGmailModifyScope(conn.scope)) return;

    const accessToken = await getValidGoogleAccessToken(userId).catch(
      () => null,
    );
    if (!accessToken) return;

    for (const messageId of gmailIds) {
      await trashGmailMessage({ accessToken, messageId }).catch(() => {
        // best-effort per message
      });
    }
  } catch {
    // best-effort only — never block a CRM delete on Gmail API issues
  }
}

/** Permanently delete a conversation that is already in Trash. */
export async function purgeInboxTrashCommand(
  activityId: string,
): Promise<InboxActionResult> {
  try {
    const userId = await getServerUserId();
    if (userId) {
      await trashGmailSiblingsBeforePurge(activityId, userId);
    }
    const deleted = await purgeContactActivityFromTrash(activityId);
    return { ok: true, id: deleted.id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to delete permanently.",
    };
  }
}

/** Persist (create or update) a draft when the user leaves compose without sending. */
/** Placeholder contact for drafts saved before the user picks a recipient. */
export const INBOX_DRAFT_UNASSIGNED_EMAIL = "unassigned@draft.local";

export async function saveInboxDraftCommand(input: {
  draftId?: string | null;
  contactId?: string | null;
  type: "email" | "call";
  subject: string;
  body?: string | null;
  threadId?: string | null;
}): Promise<InboxActionResult> {
  try {
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };

    let contactId = input.contactId?.trim() || null;
    if (!contactId) {
      contactId = await findOrCreateContactByEmail({
        email: INBOX_DRAFT_UNASSIGNED_EMAIL,
        ownerUserId: userId,
        displayName: "Unassigned",
        leadSource: "email_draft",
      });
    }
    if (!contactId) {
      return { ok: false, error: "Could not save draft without a recipient." };
    }

    const subject =
      input.subject.trim() ||
      (input.type === "email" ? "Draft email" : "Draft call notes");

    if (input.draftId) {
      await updateContactActivityDraft(input.draftId, {
        contactId,
        subject,
        body: input.body ?? null,
      });
      return { ok: true, id: input.draftId };
    }

    const activity = await createContactActivity(contactId, {
      type: input.type,
      subject,
      body: input.body ?? null,
      folder: "draft",
      createdByUserId: userId,
      threadId: input.threadId?.trim() || null,
    });
    return { ok: true, id: activity.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save draft.",
    };
  }
}

export type DraftInboxReplyResult =
  | { ok: true; source: "ai" | "heuristic"; draft: string }
  | { ok: false; error: string };

export type ComposeInboxEmailResult =
  | {
      ok: true;
      source: "ai" | "heuristic";
      subject: string;
      body: string;
    }
  | { ok: false; error: string };

/** Active tenant product names only (no descriptions/prices) for compose grounding. */
async function loadProductCatalogForCompose(): Promise<string> {
  try {
    const { listProducts } = await import("@/dao/products/product-service");
    const page = await listProducts({
      page: 1,
      pageSize: 12,
      status: "active",
    });
    const names: string[] = [];
    for (const p of page.items ?? []) {
      const name = String(p.name || "").trim();
      if (!name) continue;
      names.push(name);
    }
    return names.join("\n");
  } catch (err) {
    console.warn("compose-email: product catalog load failed", err);
    return "";
  }
}

function localHeuristicCompose(input: {
  instruction: string;
  contactName: string;
  companyName?: string | null;
  subject?: string;
  isReply?: boolean;
}): { subject: string; body: string } {
  const rawName = input.contactName.trim();
  const hasName = Boolean(rawName) && rawName.toLowerCase() !== "there";
  const first = hasName ? rawName.split(/\s+/)[0]! : null;
  const instr = input.instruction.trim() || "Write a short professional email.";

  let subject: string;
  if (input.isReply) {
    const base = (input.subject || "").trim();
    subject = base.toLowerCase().startsWith("re:")
      ? base
      : base
        ? `Re: ${base}`
        : "Re: Your message";
  } else {
    let cleaned = instr
      .replace(
        /^(write|draft|compose|create|send)\s+(an?\s+)?(email|mail)\s*(about|asking|regarding|for|to|on)?\s*/i,
        "",
      )
      .trim()
      .replace(/\baskig\b/gi, "asking")
      .replace(/\bhie\b/gi, "his");
    subject = (cleaned || "Following up").slice(0, 72);
    subject = subject.charAt(0).toUpperCase() + subject.slice(1);
  }

  const low = instr.toLowerCase();
  let opening: string;
  if (input.isReply) {
    opening =
      "Thank you for your message — I wanted to follow up with next steps.";
  } else if (/(product|catalog|offering|solution)/.test(low)) {
    opening =
      "I wanted to follow up regarding your interest in our products and how they might support your needs.";
  } else if (/(proposal|quotation|quote|rfq)/.test(low)) {
    opening =
      "I wanted to follow up regarding a proposal and make sure we cover what you need.";
  } else if (/invoice/.test(low)) {
    opening = "I wanted to follow up regarding your invoice request.";
  } else {
    opening = "I wanted to reach out and continue our conversation.";
  }

  const salutation = first ? `Hi ${first},` : "Hi,";
  const body = [
    salutation,
    "",
    opening,
    "",
    "I'd be glad to share more about how we can help and align on the best next step.",
    "",
    "Would you be open to a short call this week, or should I send more detail first?",
    "",
    "Best regards,",
  ].join("\n");

  return { subject: subject.slice(0, 180), body };
}

/** Python compose-email agent → subject + body for Inbox compose. */
export async function composeInboxEmailCommand(input: {
  instruction: string;
  contactId?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  subject?: string | null;
  currentBody?: string | null;
  inboundBody?: string | null;
  isReply?: boolean;
  /** When true, do not fall back to a canned body if the LLM is down. */
  requireAi?: boolean;
}): Promise<ComposeInboxEmailResult> {
  try {
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };

    const instruction = input.instruction.trim();
    if (!instruction) {
      return { ok: false, error: "Describe the email you want to write." };
    }

    const contactName = (input.contactName || "there").trim() || "there";
    const fallback = localHeuristicCompose({
      instruction,
      contactName,
      companyName: input.companyName,
      subject: input.subject ?? undefined,
      isReply: Boolean(input.isReply),
    });

    let organizationId: string | null = null;
    try {
      organizationId = await resolveRequestOrganizationId();
    } catch {
      organizationId = null;
    }

    const setupUser = await getSetupUserById(userId).catch(() => null);
    const senderOrganizationName =
      setupUser?.org_name?.trim() || "Worktual";

    const productCatalog = await loadProductCatalogForCompose();

    const py = await callAiServiceAgent<{
      ok?: boolean;
      subject?: string;
      body?: string;
      source?: string;
      reason?: string;
    }>(
      "compose-email",
      {
        instruction,
        contactId: input.contactId ?? undefined,
        contactName,
        companyName: input.companyName ?? undefined,
        senderOrganizationName,
        subject: input.subject ?? undefined,
        currentBody: input.currentBody ?? undefined,
        inboundBody: input.inboundBody ?? undefined,
        isReply: Boolean(input.isReply),
        organizationId: organizationId ?? undefined,
        productCatalog: productCatalog || undefined,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    if (py?.ok && py.subject?.trim() && py.body?.trim()) {
      const source = py.source === "ai" ? "ai" : ("heuristic" as const);
      if (source !== "ai") {
        console.warn(
          "compose-email returned non-AI source",
          py.source,
          py.reason,
        );
        if (input.requireAi || input.currentBody?.trim()) {
          return {
            ok: false,
            error: input.currentBody?.trim()
              ? "Could not update that draft. Try again."
              : "Could not draft that follow-up. Try again.",
          };
        }
      }
      return {
        ok: true,
        source,
        subject: py.subject.trim().slice(0, 180),
        body: py.body.trim().slice(0, 4000),
      };
    }

    if (input.requireAi || input.currentBody?.trim()) {
      return {
        ok: false,
        error: input.currentBody?.trim()
          ? "Could not update that draft. Try again."
          : "Could not draft that follow-up. Try again.",
      };
    }

    return { ok: true, source: "heuristic", ...fallback };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Compose assist failed.",
    };
  }
}

/** AI-assisted (or heuristic fallback) reply suggestion for an inbound email. */
export async function draftInboxReplyCommand(input: {
  contactId?: string | null;
  contactName: string;
  subject: string;
  inboundBody: string;
}): Promise<DraftInboxReplyResult> {
  try {
    const userId = await getServerUserId();
    if (!userId) return { ok: false, error: "Sign in again." };

    const snippet = input.inboundBody.replace(/<[^>]+>/g, " ").slice(0, 1200);
    const composed = await composeInboxEmailCommand({
      instruction: "Write a short professional reply",
      contactId: input.contactId,
      contactName: input.contactName,
      subject: input.subject,
      inboundBody: snippet,
      isReply: true,
    });
    if (composed.ok) {
      return {
        ok: true,
        source: composed.source,
        draft: composed.body,
      };
    }

    const heuristic = heuristicReplyDraft({
      contactName: input.contactName,
      subject: input.subject,
      inboundSnippet: snippet,
    });
    return { ok: true, source: "heuristic", draft: heuristic };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Draft failed.",
    };
  }
}

/** Resolve (or create) a contact by email address for drafting/composing. */
export async function resolveContactForEmailCommand(
  email: string,
): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, error: "Sign in again." };
  if (!email.trim()) return { ok: false, error: "Enter an email address." };

  const contactId = await findOrCreateContactByEmail({
    email,
    ownerUserId: userId,
    leadSource: "email_outbound",
  });
  if (!contactId) {
    return { ok: false, error: "Enter a valid email address." };
  }
  return { ok: true, contactId };
}

/** Resolve (or create) a contact by phone number for outbound call composing. */
export async function resolveContactForPhoneCommand(
  phone: string,
): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, error: "Sign in again." };
  if (!phone.trim()) return { ok: false, error: "Enter a phone number." };

  const contactId = await findOrCreateContactByPhone({
    phone,
    ownerUserId: userId,
    leadSource: "call_outbound",
  });
  if (!contactId) {
    return { ok: false, error: "Enter a valid phone number." };
  }
  return { ok: true, contactId };
}

export type ReplyAllRecipientsResult =
  | {
      ok: true;
      to: string;
      cc: string[];
      /** True when headers came from Gmail/Graph API. */
      resolvedFromProvider: boolean;
      /** Soft notice when we could not restore full To/Cc (not a send blocker). */
      recipientNotice?: string;
    }
  | { ok: false; error: string };

function parseStoredEmailHeaders(body: string): {
  fromEmails: string[];
  toEmails: string[];
  ccEmails: string[];
} {
  const fromMatch = body.match(/^From:\s*(.+)$/im);
  const toMatch = body.match(/^To:\s*(.+)$/im);
  const ccMatch = body.match(/^Cc:\s*(.+)$/im);
  const ccRaw = ccMatch?.[1]?.trim() ?? "";
  const ccEmails =
    ccRaw && ccRaw !== "—" && ccRaw !== "-"
      ? parseAllEmailAddresses(ccRaw)
      : [];
  return {
    fromEmails: fromMatch ? parseAllEmailAddresses(fromMatch[1]) : [],
    toEmails: toMatch ? parseAllEmailAddresses(toMatch[1]) : [],
    ccEmails,
  };
}

function uniqEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (!e.includes("@") || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/**
 * Build Reply-all To/Cc like Gmail/Outlook:
 * - To = original From (inbound) or first counterpart (outbound)
 * - Cc = everyone else on To/Cc except the mailbox owner and To
 */
export async function resolveReplyAllRecipientsCommand(
  activityId: string,
): Promise<ReplyAllRecipientsResult> {
  const userId = await getServerUserId();
  if (!userId) return { ok: false, error: "Sign in again." };

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      contact_id: string;
      thread_id: string | null;
      body: string | null;
      email_direction: string | null;
      gmail_message_id: string | null;
      provider_message_id: string | null;
      mail_provider: string | null;
      created_by_user_id: string | null;
    }>
  >(
    `
    SELECT id, contact_id::text AS contact_id, thread_id::text AS thread_id, body,
           email_direction::text AS email_direction,
           gmail_message_id, provider_message_id,
           mail_provider::text AS mail_provider,
           created_by_user_id::text AS created_by_user_id
    FROM contact_activities
    WHERE id = $1 AND type = 'email'
    LIMIT 1
    `,
    activityId,
  );
  const activity = rows[0];
  if (!activity) return { ok: false, error: "Message not found." };

  const mailboxUserId = activity.created_by_user_id || userId;

  const connRows = await prisma.$queryRawUnsafe<
    Array<{ provider: string; account_email: string | null }>
  >(
    `
    SELECT provider::text AS provider, account_email
    FROM user_integration_connections
    WHERE user_id = $1::bigint
    ORDER BY updated_at DESC
    LIMIT 5
    `,
    mailboxUserId,
  );

  const myEmail =
    connRows
      .map((c) => c.account_email?.trim().toLowerCase())
      .find((e): e is string => Boolean(e)) ?? null;

  let fromEmails: string[] = [];
  let toEmails: string[] = [];
  let ccEmails: string[] = [];
  let resolvedFromProvider = false;
  let usedContactFallback = false;

  let gmailId = activity.gmail_message_id || activity.provider_message_id;
  if (!gmailId && activity.thread_id) {
    const sibling = await prisma.$queryRawUnsafe<
      Array<{ gmail_message_id: string | null; provider_message_id: string | null }>
    >(
      `
      SELECT gmail_message_id, provider_message_id
      FROM contact_activities
      WHERE type = 'email'
        AND id <> $1
        AND thread_id = $2
        AND (gmail_message_id IS NOT NULL OR provider_message_id IS NOT NULL)
      ORDER BY created_at DESC
      LIMIT 1
      `,
      activityId,
      activity.thread_id,
    );
    const row = sibling[0];
    if (row) {
      gmailId = row.gmail_message_id || row.provider_message_id;
    }
  }
  const preferGoogle =
    activity.mail_provider === "google" ||
    Boolean(activity.gmail_message_id) ||
    connRows.some((c) => c.provider === "google");

  if (preferGoogle && gmailId) {
    try {
      const accessToken = await getValidGoogleAccessToken(mailboxUserId);
      if (accessToken) {
        const detail = await getGmailMessage({
          accessToken,
          messageId: gmailId,
        });
        fromEmails = parseAllEmailAddresses(detail.from);
        toEmails = parseAllEmailAddresses(detail.to);
        ccEmails = parseAllEmailAddresses(detail.cc);
        resolvedFromProvider = true;
      }
    } catch {
      // fall through
    }
  }

  const graphId = activity.provider_message_id || activity.gmail_message_id;
  if (!resolvedFromProvider && graphId) {
    try {
      const accessToken = await getValidMicrosoftAccessToken(mailboxUserId);
      if (accessToken) {
        const got = await getGraphMessage({
          accessToken,
          messageId: graphId,
        });
        if (got.ok) {
          fromEmails = parseGraphEmailAddresses(got.message.from);
          toEmails = parseGraphEmailAddresses(got.message.to);
          ccEmails = parseGraphEmailAddresses(got.message.cc);
          resolvedFromProvider = true;
        }
      }
    } catch {
      // fall through
    }
  }

  if (!resolvedFromProvider && activity.body) {
    const parsed = parseStoredEmailHeaders(activity.body);
    if (parsed.fromEmails.length) fromEmails = parsed.fromEmails;
    if (parsed.toEmails.length) toEmails = parsed.toEmails;
    if (parsed.ccEmails.length) ccEmails = parsed.ccEmails;
  }

  if (fromEmails.length === 0 && toEmails.length === 0) {
    const { getPeopleByIds } = await import("@/dao/account/account-repository");
    const people = await getPeopleByIds([activity.contact_id]);
    const email = people[0]?.email?.trim().toLowerCase();
    if (!email) {
      return { ok: false, error: "No recipients found for Reply all." };
    }
    usedContactFallback = true;
    return {
      ok: true,
      to: email,
      cc: [],
      resolvedFromProvider: false,
      recipientNotice:
        "Could not load all recipients from the original message; replying to the contact only. Add Cc manually if needed.",
    };
  }

  const isOutbound = activity.email_direction === "outbound";
  const exclude = new Set<string>();
  if (myEmail) exclude.add(myEmail);

  let to: string | undefined;
  if (isOutbound) {
    to = toEmails.find((e) => !exclude.has(e)) || toEmails[0] || fromEmails[0];
  } else {
    to = fromEmails.find((e) => !exclude.has(e)) || fromEmails[0];
  }
  if (!to) {
    return { ok: false, error: "No recipients found for Reply all." };
  }
  exclude.add(to.toLowerCase());

  const cc = uniqEmails([...toEmails, ...ccEmails, ...fromEmails]).filter(
    (e) => !exclude.has(e),
  );

  let recipientNotice: string | undefined;
  if (activity.body) {
    const ccLine = activity.body.match(/^Cc:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const ccHint =
      ccLine && ccLine !== "—" && ccLine !== "-" && ccLine.length > 1;
    if (ccHint && cc.length === 0 && !resolvedFromProvider) {
      recipientNotice =
        "Some Cc recipients could not be loaded from the original message. Add Cc manually if needed.";
    }
  }

  return {
    ok: true,
    to: to.toLowerCase(),
    cc,
    resolvedFromProvider,
    recipientNotice,
  };
}
