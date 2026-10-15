import type { Logger } from "pino";

import { createEmailProcessLog } from "@ai-contact-center/observability";

import type { GmailCredentialStore } from "./credential-store.js";
import {
  storeTicketingAttachment,
  ticketingAttachmentsRoot,
} from "./attachment-storage.js";
import { EmailOrchestrator } from "./email-orchestrator.js";
import { GmailClient } from "./gmail-client.js";
import { ingestInboundEmailConversation } from "../services/cc-core-email-client.js";

export class GmailInboundProcessor {
  private readonly gmail = new GmailClient();
  private readonly orchestrator: EmailOrchestrator;

  constructor(
    private readonly credentials: GmailCredentialStore,
    private readonly logger: Logger,
  ) {
    this.orchestrator = new EmailOrchestrator(logger);
  }

  async processNotification(input: {
    emailAddress: string;
    historyId?: string | null;
  }): Promise<number> {
    const runtime = await this.credentials.getByAccountEmail(input.emailAddress);
    if (!runtime) {
      this.logger.warn({ emailAddress: input.emailAddress }, "no gmail connection for mailbox");
      return 0;
    }

    let messageIds: string[] = [];
    if (input.historyId) {
      const startHistoryId = String(Math.max(1, Number(input.historyId) - 10));
      try {
        messageIds = await this.gmail.listHistory(runtime, startHistoryId);
      } catch (error) {
        this.logger.warn({ err: error, emailAddress: input.emailAddress }, "history.list failed");
      }
    }

    if (messageIds.length === 0) {
      messageIds = await this.gmail.listUnreadInbox(runtime);
    }

    let accepted = 0;
    for (const messageId of messageIds) {
      if (await this.processMessageId(runtime, messageId)) {
        accepted += 1;
      }
    }
    return accepted;
  }

  private async processMessageId(
    runtime: Awaited<ReturnType<GmailCredentialStore["getByAccountEmail"]>>,
    messageId: string,
  ): Promise<boolean> {
    if (!runtime) return false;

    try {
      const metadata = await this.gmail.getMessageMetadata(runtime, messageId);
      if (!metadata.labelIds.includes("INBOX") || !metadata.labelIds.includes("UNREAD")) {
        return false;
      }
      if (metadata.labelIds.includes("SENT") || metadata.labelIds.includes("DRAFT")) {
        return false;
      }
      if (
        !metadata.senderEmail ||
        metadata.senderEmail.toLowerCase() === runtime.accountEmail.toLowerCase()
      ) {
        return false;
      }

      const occurredAt = metadata.dateHeader
        ? new Date(metadata.dateHeader).toISOString()
        : new Date().toISOString();

      const processLog = createEmailProcessLog(
        {
          organizationId: runtime.organizationId,
          from: metadata.senderEmail,
          to: runtime.accountEmail,
          mail: metadata.body || metadata.subject || "(empty email)",
          subject: metadata.subject,
          messageId: metadata.messageId,
        },
        this.logger,
      );
      processLog.step("gmail_metadata_fetched", { threadId: metadata.threadId });

      const attachmentStorageEnabled = Boolean(ticketingAttachmentsRoot());
      const attachments = await Promise.all(
        metadata.attachments.map(async (attachment, index) => {
          let storageKey: string | undefined;
          if (attachmentStorageEnabled) {
            try {
              const content = attachment.inlineData
                ? Buffer.from(
                    attachment.inlineData.replace(/-/g, "+").replace(/_/g, "/"),
                    "base64",
                  )
                : attachment.attachmentId
                  ? await this.gmail.downloadAttachment(
                      runtime,
                      metadata.messageId,
                      attachment.attachmentId,
                    )
                  : null;
              if (content) {
                storageKey =
                  (await storeTicketingAttachment({
                    organizationId: runtime.organizationId,
                    threadId: metadata.threadId,
                    messageId: metadata.messageId,
                    attachmentIndex: index,
                    fileName: attachment.fileName,
                    content,
                  })) ?? undefined;
              }
            } catch (error) {
              this.logger.warn(
                {
                  err: error,
                  messageId,
                  fileName: attachment.fileName,
                  organizationId: runtime.organizationId,
                },
                "failed to store inbound email attachment",
              );
            }
          }
          return {
            attachmentId: attachment.attachmentId,
            fileName: attachment.fileName,
            contentType: attachment.contentType,
            byteSize: attachment.byteSize,
            storageKey,
          };
        }),
      );

      const result = await ingestInboundEmailConversation({
        organizationId: runtime.organizationId,
        externalThreadId: metadata.threadId,
        externalMessageId: metadata.messageId,
        customerEmail: metadata.senderEmail,
        customerName: metadata.from,
        subject: metadata.subject || "(no subject)",
        body: (metadata.body || metadata.subject || "(empty email)").slice(0, 200_000),
        occurredAt,
        mailboxConnectionId: runtime.connectionId,
        mailboxEmail: runtime.accountEmail,
        rfcMessageId: metadata.messageHeaderId,
        inReplyTo: metadata.inReplyTo,
        references: metadata.references,
        providerHeaders: metadata.headers,
        attachments,
      });

      if (!result) {
        processLog.fail("cc_core_ingest", "ingest returned null");
        this.logger.error(
          { messageId, organizationId: runtime.organizationId },
          "failed to ingest inbound email conversation",
        );
        return false;
      }

      processLog.step("cc_core_ingest_complete", {
        conversationId: result.conversationId,
        duplicate: result.duplicate,
        status: result.conversation.status,
        botActive: result.conversation.botActive,
      });

      processLog.step("orchestrator_started");
      await this.orchestrator.handleInbound({ credentials: runtime, metadata, ingest: result, processLog });

      try {
        await this.gmail.markAsRead(runtime, messageId);
      } catch (error) {
        this.logger.warn(
          { err: error, messageId, organizationId: runtime.organizationId },
          "failed to mark gmail message as read (missing gmail.modify scope?)",
        );
      }

      this.logger.info(
        {
          organizationId: runtime.organizationId,
          conversationId: result.conversationId,
          messageId: result.messageId,
          externalMessageId: metadata.messageId,
        },
        "inbound email conversation ingested",
      );
      processLog.complete({ conversationId: result.conversationId });
      return true;
    } catch (error) {
      this.logger.error({ err: error, messageId }, "failed to process gmail message");
      throw error;
    }
  }
}
