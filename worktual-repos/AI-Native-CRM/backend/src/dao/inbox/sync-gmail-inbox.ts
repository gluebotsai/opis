import type { EmailDirection } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import { findCrmContactIdByEmails } from "@/dao/inbox/contact-by-email";
import {
  getContactProfileCreatedAt,
  isGmailMessageBeforeContactCreation,
} from "@/dao/inbox/inbox-contact-age";
import { clearManualResponseNeededForThread } from "@/dao/inbox/inbox-service";
import { getSetupUserById } from "@/service/account/setup-users";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { triggerEmailAutoReply } from "@/service/ai/email-auto-reply-trigger";
import {
  getValidGoogleAccessToken,
  googleHasGmailReadScope,
} from "@/service/google/access-token";
import {
  getGmailMessage,
  listGmailMessages,
  listGmailThreadMessages,
  parseAllEmailAddresses,
  type GmailMessageDetail,
} from "@/service/google/gmail";
import {
  hasHtmlArtifacts,
  hasEncodedHtmlEntities,
  htmlToPlainText,
  isHtmlEmailBody,
} from "@/lib/email-body";

export type SyncInboundGmailResult =
  | { ok: true; imported: number; needsReconnect?: false }
  | { ok: true; imported: 0; needsReconnect: true; error: string }
  | { ok: false; error: string; needsReconnect?: boolean };

/**
 * Gmail message ids with no CRM contact.
 *
 * We skip them so we don't waste the 60-fetch budget on messages we can't
 * attach right now, but we MUST NOT skip forever:
 * - if a contact is deleted/recreated, we should re-try matching
 * - otherwise bot auto-replies can appear to "never happen"
 */
const SKIPPED_NO_CONTACT_TTL_MS = 30 * 60_000; // 30 minutes

// messageId -> firstSeenAtMs (used for TTL pruning)
const skippedNoContactByUser = new Map<string, Map<string, number>>();

function skippedNoContact(userId: string): Map<string, number> {
  let map = skippedNoContactByUser.get(userId);
  if (!map) {
    map = new Map();
    skippedNoContactByUser.set(userId, map);
  }

  const now = Date.now();
  // Prune expired entries so we can re-import if a contact is created later.
  for (const [messageId, firstSeenAtMs] of map.entries()) {
    if (now - firstSeenAtMs > SKIPPED_NO_CONTACT_TTL_MS) {
      map.delete(messageId);
    }
  }

  // Cap memory — drop oldest-ish by clearing when huge.
  if (map.size > 2000) map.clear();
  return map;
}

async function importGmailMessageDetailForUser(input: {
  userId: string;
  organizationId: string;
  myEmail: string | null;
  detail: GmailMessageDetail;
  skipNoContact: Map<string, number>;
}): Promise<boolean> {
  const { userId, organizationId, myEmail, detail, skipNoContact } = input;

  if (
    detail.labelIds.includes("SPAM") ||
    detail.labelIds.includes("TRASH")
  ) {
    return false;
  }

  const fromEmails = parseAllEmailAddresses(detail.from);
  const toEmails = parseAllEmailAddresses(detail.to);
  const ccEmails = parseAllEmailAddresses(detail.cc);
  const isFromMe = Boolean(myEmail && fromEmails.some((e) => e === myEmail));

  const counterpartEmails = (
    isFromMe ? [...toEmails, ...ccEmails] : [...fromEmails, ...toEmails, ...ccEmails]
  ).filter((e) => !myEmail || e !== myEmail);

  const sibling = await prisma.contactActivity.findFirst({
    where: { gmailThreadId: detail.threadId, createdByUserId: userId },
    orderBy: { createdAt: "asc" },
    select: { threadId: true, contactId: true },
  });

  let contactId = sibling?.contactId ?? null;
  if (!contactId) {
    contactId = await findCrmContactIdByEmails(counterpartEmails, organizationId);
  }
  if (!contactId) {
    const policy =
      process.env.INBOX_UNKNOWN_SENDER_POLICY?.trim().toLowerCase() || "skip";
    if (policy === "suggest") {
      console.info(
        "[inbox-sync] unknown sender suggest",
        counterpartEmails[0] || detail.from,
      );
    }
    skipNoContact.set(detail.id, Date.now());
    return false;
  }

  const contactCreatedAt = await getContactProfileCreatedAt(
    contactId,
    organizationId,
  );
  if (
    isGmailMessageBeforeContactCreation(detail.internalDate, contactCreatedAt)
  ) {
    skipNoContact.set(detail.id, Date.now());
    return false;
  }

  const direction: EmailDirection = isFromMe ? "outbound" : "inbound";
  const folder = isFromMe
    ? "sent"
    : detail.labelIds.includes("TRASH")
      ? "trash"
      : "inbox";

  const header = `From: ${detail.from ?? "—"}\nTo: ${detail.to ?? "—"}\nCc: ${
    detail.cc ?? "—"
  }\n\n`;
  const trimmed = detail.body.trim();
  const body = trimmed ? header + trimmed : `(No message body)\n\n${header}`;

  const existing = await prisma.contactActivity.findFirst({
    where: {
      OR: [
        { gmailMessageId: detail.id },
        { providerMessageId: detail.id },
        ...(detail.rfcMessageId
          ? [{ rfcMessageId: detail.rfcMessageId }]
          : []),
      ],
    },
    select: {
      id: true,
      body: true,
      createdByUserId: true,
      gmailMessageId: true,
      providerMessageId: true,
      rfcMessageId: true,
    },
  });

  if (existing) {
    if (
      existing.createdByUserId != null &&
      String(existing.createdByUserId) !== String(userId)
    ) {
      // Still backfill provider/gmail ids onto a prior send log so the next
      // sync does not create a second row for the same message.
      await prisma.$executeRawUnsafe(
        `UPDATE contact_activities SET
           gmail_message_id = COALESCE(gmail_message_id, $2),
           provider_message_id = COALESCE(provider_message_id, $2),
           gmail_thread_id = COALESCE(gmail_thread_id, $3),
           provider_thread_id = COALESCE(provider_thread_id, $3),
           rfc_message_id = COALESCE(rfc_message_id, $4),
           mail_provider = COALESCE(mail_provider, 'google'::"MailProvider"),
           updated_at = NOW()
         WHERE id = $1`,
        existing.id,
        detail.id,
        detail.threadId,
        detail.rfcMessageId,
      );
      return false;
    }
    const currentBody = existing.body ?? "";
    const shouldUpgrade =
      (isHtmlEmailBody(body) && !isHtmlEmailBody(currentBody)) ||
      (hasHtmlArtifacts(currentBody) &&
        (isHtmlEmailBody(body) || !hasHtmlArtifacts(body))) ||
      (hasEncodedHtmlEntities(currentBody) &&
        (isHtmlEmailBody(body) ||
          htmlToPlainText(body).length > currentBody.length * 1.2));
    const patch: {
      body?: string;
      createdByUserId?: string;
      gmailMessageId?: string;
      gmailThreadId?: string;
      rfcMessageId?: string;
    } = {};
    if (shouldUpgrade && body !== currentBody) {
      patch.body = body;
    }
    if (!existing.createdByUserId) {
      patch.createdByUserId = userId;
    }
    if (!existing.gmailMessageId) patch.gmailMessageId = detail.id;
    if (!existing.rfcMessageId && detail.rfcMessageId) {
      patch.rfcMessageId = detail.rfcMessageId;
    }
    if (detail.threadId) patch.gmailThreadId = detail.threadId;
    if (Object.keys(patch).length > 0) {
      await prisma.contactActivity.update({
        where: { id: existing.id },
        data: patch,
      });
    }
    await prisma.$executeRawUnsafe(
      `UPDATE contact_activities SET
         provider_message_id = COALESCE(provider_message_id, $2),
         provider_thread_id = COALESCE(provider_thread_id, $3),
         mail_provider = COALESCE(mail_provider, 'google'::"MailProvider"),
         updated_at = NOW()
       WHERE id = $1`,
      existing.id,
      detail.id,
      detail.threadId,
    );
    return false;
  }

  try {
    const row = await prisma.contactActivity.create({
      data: {
        organizationId,
        contactId,
        type: "email",
        folder,
        subject: detail.subject,
        body,
        gmailMessageId: detail.id,
        gmailThreadId: detail.threadId,
        rfcMessageId: detail.rfcMessageId,
        emailDirection: direction,
        threadId: sibling?.threadId ?? undefined,
        createdAt: detail.internalDate,
        createdByUserId: userId,
      },
    });

    await prisma.$executeRawUnsafe(
      `UPDATE contact_activities SET
         provider_message_id = COALESCE($2, provider_message_id),
         provider_thread_id = COALESCE($3, provider_thread_id),
         mail_provider = COALESCE(mail_provider, 'google'::"MailProvider"),
         thread_id = COALESCE(thread_id, $4, $1)
       WHERE id = $1`,
      row.id,
      detail.id,
      detail.threadId,
      sibling?.threadId ?? null,
    );

    if (detail.threadId) {
      const canonical = sibling?.threadId || row.threadId || row.id;
      await prisma.$executeRawUnsafe(
        `
        UPDATE contact_activities
        SET thread_id = $1, updated_at = NOW()
        WHERE created_by_user_id = $2::bigint
          AND gmail_thread_id = $3
          AND (thread_id IS DISTINCT FROM $1)
        `,
        canonical,
        userId,
        detail.threadId,
      );
    }

    triggerLeadLifecycle({
      contactId,
      organizationId,
      triggerReason: `inbox:${direction}`,
    });

    if (direction === "outbound") {
      await clearManualResponseNeededForThread({
        contactId,
        threadId: sibling?.threadId ?? row.threadId,
        gmailThreadId: detail.threadId,
      });
    }

    if (direction === "inbound" && folder === "inbox") {
      const { scheduleCustomerBantCapture } = await import(
        "@/service/ai/contact-bant-from-communication"
      );
      scheduleCustomerBantCapture({
        contactId,
        type: "email",
        subject: detail.subject,
        body,
        emailDirection: "inbound",
      });
      const { enqueueLeadScoring } = await import(
        "@/service/ai/lead-scoring-job"
      );
      void enqueueLeadScoring({
        contactId,
        organizationId,
        triggerReason: "inbound_email",
        processImmediately: true,
      }).catch((err) =>
        console.error("gmail inbound rescore enqueue failed", err),
      );

      await triggerEmailAutoReply({
        activityId: row.id,
        contactId,
        mailboxUserId: userId,
        organizationId,
        processImmediately: true,
      });
    }

    return true;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return false;
    }
    console.error("gmail inbound insert failed", detail.id, err);
    return false;
  }
}

/**
 * Incremental import for Gmail Pub/Sub push (specific message ids).
 */
export async function syncGmailMessageIdsForUser(
  userId: string,
  messageIds: string[],
): Promise<{ imported: number }> {
  const ids = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { imported: 0 };

  const setupUser = await getSetupUserById(userId);
  const organizationId = setupUser?.organization_id?.trim() || null;
  if (!organizationId) return { imported: 0 };

  const conn = await getCalendarConnection(userId, "google");
  if (!conn || !googleHasGmailReadScope(conn.scope)) return { imported: 0 };

  let accessToken: string | null;
  try {
    accessToken = await getValidGoogleAccessToken(userId);
  } catch {
    return { imported: 0 };
  }
  if (!accessToken) return { imported: 0 };

  const myEmail = conn.accountEmail?.toLowerCase() ?? null;
  const skipNoContact = skippedNoContact(userId);
  let imported = 0;

  for (const messageId of ids.slice(0, 30)) {
    let detail: GmailMessageDetail;
    try {
      detail = await getGmailMessage({ accessToken, messageId });
    } catch {
      continue;
    }
    const didImport = await importGmailMessageDetailForUser({
      userId,
      organizationId,
      myEmail,
      detail,
      skipNoContact,
    });
    if (didImport) imported += 1;
  }

  return { imported };
}

/**
 * Pull recent Gmail messages into CRM inbox.
 * Links mail only to existing CRM contacts — never auto-creates leads from mailbox noise.
 */
export async function syncInboundGmailForUser(
  userId: string,
): Promise<SyncInboundGmailResult> {
  try {
    const setupUser = await getSetupUserById(userId);
    const organizationId = setupUser?.organization_id?.trim() || null;
    if (!organizationId) {
      return { ok: false, error: "Organization not found for this user." };
    }

    const conn = await getCalendarConnection(userId, "google");
    if (!conn) {
      return {
        ok: true,
        imported: 0,
        needsReconnect: true,
        error: "Connect Google in Configuration → Email to receive replies.",
      };
    }

    if (!googleHasGmailReadScope(conn.scope)) {
      return {
        ok: true,
        imported: 0,
        needsReconnect: true,
        error:
          "Reconnect Google in Configuration → Email to grant read access so customer replies appear in Inbox.",
      };
    }

    let accessToken: string | null;
    try {
      accessToken = await getValidGoogleAccessToken(userId);
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to refresh Google access token.",
        needsReconnect: true,
      };
    }
    if (!accessToken) {
      return {
        ok: true,
        imported: 0,
        needsReconnect: true,
        error: "Connect Google in Configuration → Email first.",
      };
    }

    const myEmail = conn.accountEmail?.toLowerCase() ?? null;

    const knownThreads = await prisma.contactActivity.findMany({
      where: {
        gmailThreadId: { not: null },
        type: "email",
        createdByUserId: userId,
      },
      select: { gmailThreadId: true },
      distinct: ["gmailThreadId"],
      orderBy: { updatedAt: "desc" },
      take: 12,
    });

    const listedMap = new Map<string, { id: string; threadId: string }>();
    const addListed = (rows: { id: string; threadId: string }[]) => {
      for (const m of rows) listedMap.set(m.id, m);
    };

    const knownThreadIds = new Set(
      knownThreads
        .map((t) => t.gmailThreadId)
        .filter((id): id is string => Boolean(id)),
    );

    try {
      // Fast live path: recent inbox first (customer replies), then known threads.
      // Avoid wide 90d sent/all queries on every poll — those made sync take ~70s
      // and starved new inbound behind unmatched backlog.
      addListed(
        await listGmailMessages({
          accessToken,
            // Don’t rely on the message being in Gmail's INBOX label.
            // Customer replies may arrive in "All Mail"/Archived while still
            // needing an auto-reply. We exclude spam + trash to avoid noise.
            query: "newer_than:7d -in:spam -in:trash",
          maxResults: 40,
        }),
      );
      addListed(
        await listGmailMessages({
          accessToken,
          query: "in:sent newer_than:3d",
          maxResults: 20,
        }),
      );
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "Failed to list Gmail messages.",
      };
    }

    // Parallelize known-thread expands — sequential calls made live sync ~1min.
    await Promise.all(
      [...knownThreadIds].map(async (tid) => {
        try {
          addListed(
            await listGmailThreadMessages({ accessToken, threadId: tid }),
          );
        } catch {
          // ignore per-thread failures
        }
      }),
    );

    const listed = [...listedMap.values()];
    const skipNoContact = skippedNoContact(userId);
    const existingIds = new Set(
      (
        await prisma.contactActivity.findMany({
          where: { gmailMessageId: { in: listed.map((m) => m.id) } },
          select: { gmailMessageId: true },
        })
      )
        .map((r) => r.gmailMessageId)
        .filter(Boolean) as string[],
    );

    const unknown = listed.filter(
      (m) => !existingIds.has(m.id) && !skipNoContact.has(m.id),
    );
    // Known CRM threads first so customer replies land even when backlog exists.
    const priority = unknown.filter((m) => knownThreadIds.has(m.threadId));
    const rest = unknown.filter((m) => !knownThreadIds.has(m.threadId));
    const toFetch = [...priority, ...rest].slice(0, 20);
    let imported = 0;

    for (const item of toFetch) {
      let detail;
      try {
        detail = await getGmailMessage({
          accessToken,
          messageId: item.id,
        });
      } catch {
        continue;
      }

      const didImport = await importGmailMessageDetailForUser({
        userId,
        organizationId,
        myEmail,
        detail,
        skipNoContact,
      });
      if (didImport) imported += 1;
    }

    return { ok: true, imported };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gmail sync failed.",
    };
  }
}
