import type { EmailDirection } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import { getCalendarConnection } from "@/dao/calendar/token-repository";
import { findCrmContactIdByEmails } from "@/dao/inbox/contact-by-email";
import { clearManualResponseNeededForThread } from "@/dao/inbox/inbox-service";
import { getSetupUserById } from "@/service/account/setup-users";
import { triggerLeadLifecycle } from "@/service/ai/lead-lifecycle-trigger";
import { triggerEmailAutoReply } from "@/service/ai/email-auto-reply-trigger";
import {
  isMicrosoftGuestMailbox,
  microsoftHasMailReadScope,
} from "@/service/microsoft/oauth";
import { getValidMicrosoftAccessToken } from "@/service/microsoft/send-email";
import {
  listGraphConversationMessages,
  listGraphFolderMessages,
  parseGraphEmailAddresses,
  type GraphMailMessage,
} from "@/service/microsoft/graph-mail";

export type SyncInboundMicrosoftResult =
  | { ok: true; imported: number; needsReconnect?: false }
  | { ok: true; imported: 0; needsReconnect: true; error: string }
  | { ok: false; error: string; needsReconnect?: boolean };

/**
 * Pull recent Microsoft Graph mail into the CRM inbox.
 * Links mail only to existing CRM contacts — never auto-creates leads from mailbox noise.
 */
export async function syncInboundMicrosoftForUser(
  userId: string,
): Promise<SyncInboundMicrosoftResult> {
  try {
    const setupUser = await getSetupUserById(userId);
    const organizationId = setupUser?.organization_id?.trim() || null;
    if (!organizationId) {
      return { ok: false, error: "Organization not found for this user." };
    }

    const conn = await getCalendarConnection(userId, "microsoft");
    if (!conn) {
      return {
        ok: true,
        imported: 0,
        needsReconnect: true,
        error: "Connect Microsoft in Configuration → Email to receive replies.",
      };
    }

    if (!microsoftHasMailReadScope(conn.scope)) {
      return {
        ok: true,
        imported: 0,
        needsReconnect: true,
        error:
          "Reconnect Microsoft in Configuration → Email to grant read access so customer replies appear in Inbox.",
      };
    }

    if (isMicrosoftGuestMailbox(conn.accountEmail)) {
      return {
        ok: true,
        imported: 0,
        needsReconnect: true,
        error:
          "Your Microsoft account is linked as a guest and has no mailbox. Reconnect with an account that has a real inbox.",
      };
    }

    let accessToken: string | null;
    try {
      accessToken = await getValidMicrosoftAccessToken(userId);
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to refresh Microsoft access token.",
        needsReconnect: true,
      };
    }
    if (!accessToken) {
      return {
        ok: true,
        imported: 0,
        needsReconnect: true,
        error:
          "Microsoft session expired. Reconnect Microsoft in Configuration → Email.",
      };
    }

    const myEmail = conn.accountEmail?.toLowerCase() ?? null;

    const collected = new Map<string, GraphMailMessage>();
    for (const folder of ["inbox", "sentitems"] as const) {
      const result = await listGraphFolderMessages({
        accessToken,
        folder,
        top: folder === "inbox" ? 60 : 40,
      });
      if (!result.ok) {
        // A single folder failure should not kill the whole sync.
        if (folder === "inbox") {
          return {
            ok: false,
            error: result.error,
            needsReconnect: result.status === 401,
          };
        }
        continue;
      }
      for (const msg of result.messages) collected.set(msg.id, msg);
    }

    // Refresh recent known conversations so mid-thread replies are not missed.
    const knownThreads = await prisma.contactActivity.findMany({
      where: {
        mailProvider: "microsoft",
        providerThreadId: { not: null },
        type: "email",
        createdByUserId: userId,
      },
      select: { providerThreadId: true },
      distinct: ["providerThreadId"],
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    for (const t of knownThreads) {
      const conversationId = t.providerThreadId;
      if (!conversationId) continue;
      const result = await listGraphConversationMessages({
        accessToken,
        conversationId,
      });
      if (!result.ok) continue;
      for (const msg of result.messages) {
        if (!collected.has(msg.id)) collected.set(msg.id, msg);
      }
    }

    const messages = [...collected.values()].filter((m) => !m.isDraft);
    if (messages.length === 0) return { ok: true, imported: 0 };

    const existingIds = new Set(
      (
        await prisma.contactActivity.findMany({
          where: { providerMessageId: { in: messages.map((m) => m.id) } },
          select: { providerMessageId: true },
        })
      )
        .map((r) => r.providerMessageId)
        .filter(Boolean) as string[],
    );

    const toImport = messages
      .filter((m) => !existingIds.has(m.id))
      .slice(0, 60);

    let imported = 0;

    for (const message of toImport) {
      const fromEmails = parseGraphEmailAddresses(message.from);
      const toEmails = parseGraphEmailAddresses(message.to);
      const ccEmails = parseGraphEmailAddresses(message.cc);
      const isFromMe =
        message.folder === "sent" ||
        Boolean(myEmail && fromEmails.includes(myEmail));

      const counterpartEmails = (
        isFromMe
          ? [...toEmails, ...ccEmails]
          : [...fromEmails, ...toEmails, ...ccEmails]
      ).filter((e) => !myEmail || e !== myEmail);

      const sibling = message.conversationId
        ? await prisma.contactActivity.findFirst({
            where: {
              providerThreadId: message.conversationId,
              createdByUserId: userId,
            },
            orderBy: { createdAt: "asc" },
            select: { threadId: true, contactId: true },
          })
        : null;

      let contactId = sibling?.contactId ?? null;
      if (!contactId) {
        contactId = await findCrmContactIdByEmails(
          counterpartEmails,
          organizationId,
        );
      }
      if (!contactId) {
        // Unknown-sender policy: default skip (no silent spam contacts).
        // INBOX_UNKNOWN_SENDER_POLICY=suggest logs for coworker create suggestion.
        const policy =
          process.env.INBOX_UNKNOWN_SENDER_POLICY?.trim().toLowerCase() ||
          "skip";
        if (policy === "suggest" && counterpartEmails[0]) {
          console.info(
            "[inbox-sync-ms] unknown sender suggest",
            counterpartEmails[0],
          );
        }
        continue;
      }

      const direction: EmailDirection = isFromMe ? "outbound" : "inbound";
      const body =
        message.body ||
        `(No message body)\n\nFrom: ${message.from ?? "—"}\nTo: ${message.to ?? "—"}`;

      try {
        const row = await prisma.contactActivity.create({
          data: {
            organizationId,
            contactId,
            type: "email",
            folder: message.folder === "sent" ? "sent" : "inbox",
            subject: message.subject,
            body,
            providerMessageId: message.id,
            providerThreadId: message.conversationId,
            mailProvider: "microsoft",
            rfcMessageId: message.internetMessageId,
            emailDirection: direction,
            threadId: sibling?.threadId ?? undefined,
            createdAt: message.receivedAt,
            createdByUserId: userId,
          },
        });

        if (!row.threadId) {
          await prisma.contactActivity.update({
            where: { id: row.id },
            data: { threadId: row.id },
          });
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
            providerThreadId: message.conversationId,
          });
        }

        if (direction === "inbound") {
          const { scheduleCustomerBantCapture } = await import(
            "@/service/ai/contact-bant-from-communication"
          );
          scheduleCustomerBantCapture({
            contactId,
            type: "email",
            subject: message.subject,
            body,
            emailDirection: "inbound",
          });
          await triggerEmailAutoReply({
            activityId: row.id,
            contactId,
            mailboxUserId: userId,
            organizationId,
            processImmediately: true,
          });
        }

        imported += 1;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          continue;
        }
        continue;
      }
    }

    return { ok: true, imported };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Microsoft mail sync failed.",
    };
  }
}
