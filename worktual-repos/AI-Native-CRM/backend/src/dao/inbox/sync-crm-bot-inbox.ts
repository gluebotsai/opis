import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { resolveCrmBotMailbox } from "@/dao/account/crm-bot-mailbox";
import { triggerEmailAutoReply } from "@/service/ai/email-auto-reply-trigger";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import {
  getGmailMessage,
  listGmailMessages,
  parseAllEmailAddresses,
  type GmailMessageDetail,
} from "@/service/google/gmail";
import { findCrmContactIdByEmails } from "@/dao/inbox/contact-by-email";
import {
  getContactProfileCreatedAt,
  isGmailMessageBeforeContactCreation,
} from "@/dao/inbox/inbox-contact-age";
import { getValidOauthAccessToken } from "@/service/email/send-crm-bot-email";
import {
  backfillUnownedEmailActivityUserIdsOnce,
  resolveContactOwnerUserId,
} from "@/dao/inbox/email-activity-user";

const SKIPPED_NO_CONTACT_TTL_MS = 30 * 60_000; // 30 minutes

// messageId -> firstSeenAtMs (used for TTL pruning)
const skippedNoContactByBot = new Map<string, Map<string, number>>();

function skippedNoContact(organizationId: string): Map<string, number> {
  let map = skippedNoContactByBot.get(organizationId);
  if (!map) {
    map = new Map();
    skippedNoContactByBot.set(organizationId, map);
  }

  const now = Date.now();
  for (const [messageId, firstSeenAtMs] of map.entries()) {
    if (now - firstSeenAtMs > SKIPPED_NO_CONTACT_TTL_MS) {
      map.delete(messageId);
    }
  }

  // Cap memory — drop oldest-ish by clearing when huge.
  if (map.size > 2000) map.clear();
  return map;
}

async function importGmailMessageDetailForCrmBot(input: {
  organizationId: string;
  myEmail: string | null;
  detail: GmailMessageDetail;
  skipNoContact: Map<string, number>;
}): Promise<boolean> {
  const { organizationId, myEmail, detail, skipNoContact } = input;

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
    isFromMe
      ? [...toEmails, ...ccEmails]
      : [...fromEmails, ...toEmails, ...ccEmails]
  ).filter((e) => !myEmail || e !== myEmail);

  const contactId = await findCrmContactIdByEmails(
    counterpartEmails,
    organizationId,
  );
  if (!contactId) {
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

  const direction = isFromMe ? ("outbound" as const) : ("inbound" as const);
  const folder =
    direction === "outbound"
      ? "sent"
      : detail.labelIds.includes("TRASH")
        ? "trash"
        : "inbox";

  const header = `From: ${detail.from ?? "—"}\nTo: ${detail.to ?? "—"}\nCc: ${
    detail.cc ?? "—"
  }\n\n`;
  const trimmed = detail.body.trim();
  const body = trimmed ? header + trimmed : `(No message body)\n\n${header}`;
  const {
    resolveCanonicalEmailThreadForContact,
    backfillContactEmailThread,
  } = await import("@/dao/inbox/email-thread-canonical");
  const canonicalThread =
    (await resolveCanonicalEmailThreadForContact(
      contactId,
      detail.subject,
      detail.threadId,
    )) ??
    detail.threadId ??
    null;
  const ownerUserId = await resolveContactOwnerUserId(contactId);

  try {
    const row = await prisma.contactActivity.create({
      data: {
        organizationId: Number(organizationId),
        contactId,
        type: "email",
        folder,
        subject: detail.subject,
        body,
        gmailMessageId: detail.id,
        gmailThreadId: detail.threadId,
        rfcMessageId: detail.rfcMessageId,
        emailDirection: direction,
        threadId: canonicalThread,
        createdAt: detail.internalDate,
        createdByUserId: ownerUserId ? BigInt(ownerUserId) : null,
      },
    });

    const resolvedThread = canonicalThread ?? row.id;

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
      resolvedThread,
    );

    await backfillContactEmailThread(
      contactId,
      detail.subject,
      resolvedThread,
    ).catch((err) =>
      console.error("[crm-bot-inbox] thread backfill failed", err),
    );

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
        console.error("[crm-bot-inbox] rescore after inbound failed", err),
      );
    }

    triggerLeadLifecycle({
      contactId,
      organizationId,
      triggerReason: `inbox:${direction}`,
    });

    if (direction === "inbound" && folder === "inbox") {
      await triggerEmailAutoReply({
        activityId: row.id,
        contactId,
        mailboxUserId: null,
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
      if (ownerUserId) {
        await prisma.contactActivity.updateMany({
          where: {
            gmailMessageId: detail.id,
            createdByUserId: null,
          },
          data: { createdByUserId: BigInt(ownerUserId) },
        }).catch(() => undefined);
      }
      return false;
    }
    console.error("[crm-bot-inbox] insert failed", detail.id, err);
    return false;
  }
}

/** Incremental import for Gmail Pub/Sub push (CRM bot mailbox). */
export async function syncGmailMessageIdsForCrmBot(
  organizationId: string,
  messageIds: string[],
): Promise<{ imported: number }> {
  const ids = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { imported: 0 };
  await backfillUnownedEmailActivityUserIdsOnce();

  const orgId = organizationId?.trim();
  if (!orgId) return { imported: 0 };

  const mailbox = await resolveCrmBotMailbox(orgId).catch(() => null);
  if (!mailbox || mailbox.oauthProvider !== "google") return { imported: 0 };

  const token = await getValidOauthAccessToken(mailbox);
  if (!token.ok) return { imported: 0 };

  const myEmail = token.fromEmail?.toLowerCase() ?? null;
  const skipNoContact = skippedNoContact(orgId);
  let imported = 0;

  for (const messageId of ids.slice(0, 30)) {
    let detail: GmailMessageDetail;
    try {
      detail = await getGmailMessage({
        accessToken: token.accessToken,
        messageId,
      });
    } catch {
      continue;
    }
    const didImport = await importGmailMessageDetailForCrmBot({
      organizationId: orgId,
      myEmail,
      detail,
      skipNoContact,
    });
    if (didImport) imported += 1;
  }

  return { imported };
}

/**
 * Sync inbound customer replies for the CRM bot mailbox configured in Accounts.
 *
 * The bot mailbox is not a user integration. Each imported email is stored
 * under the contact owner so it shows in that user's inbox. Auto-reply still
 * sends from the bot mailbox when the message headers name that address.
 */
export async function syncCrmBotInboxForOrganization(
  organizationId: string,
): Promise<{ imported: number; needsReconnect?: boolean; error?: string }> {
  const orgId = organizationId?.trim();
  if (!orgId) return { imported: 0 };
  await backfillUnownedEmailActivityUserIdsOnce();

  const mailbox = await resolveCrmBotMailbox(orgId).catch(() => null);
  if (!mailbox) return { imported: 0 };

  // Only Google is implemented for now.
  if (mailbox.oauthProvider !== "google") return { imported: 0 };

  const token = await getValidOauthAccessToken(mailbox);
  if (!token.ok) {
    return {
      imported: 0,
      needsReconnect: token.needsConnect ?? true,
      error: token.error,
    };
  }

  const myEmail = token.fromEmail?.toLowerCase() ?? null;

  // Fast live path: recent inbox-ish, excluding spam/trash.
  // (We still infer folder from TRASH label when storing the CRM activity.)
  const listed = await listGmailMessages({
    accessToken: token.accessToken,
    query: "newer_than:7d -in:spam -in:trash",
    maxResults: 40,
  }).catch(() => []);

  if (listed.length === 0) return { imported: 0 };

  const listedIds = listed.map((m) => m.id);
  const existingIds = new Set(
    (
      await prisma.contactActivity.findMany({
        where: { gmailMessageId: { in: listedIds } },
        select: { gmailMessageId: true },
      })
    )
      .map((r) => r.gmailMessageId)
      .filter(Boolean) as string[],
  );

  const skipNoContact = skippedNoContact(orgId);

  const unknown = listed.filter(
    (m) => !existingIds.has(m.id) && !skipNoContact.has(m.id),
  );

  const toFetch = unknown.slice(0, 20);
  let imported = 0;

  for (const item of toFetch) {
    let detail: GmailMessageDetail | null = null;
    try {
      detail = await getGmailMessage({
        accessToken: token.accessToken,
        messageId: item.id,
      });
    } catch {
      continue;
    }

    const didImport = await importGmailMessageDetailForCrmBot({
      organizationId: orgId,
      myEmail,
      detail,
      skipNoContact,
    });
    if (didImport) imported += 1;
  }

  return { imported };
}

