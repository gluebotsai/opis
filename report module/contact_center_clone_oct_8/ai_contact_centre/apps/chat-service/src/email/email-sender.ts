import type { GmailRuntimeCredentials } from "./credential-store.js";
import { GmailClient } from "./gmail-client.js";

export type SendEmailInput = {
  credentials: GmailRuntimeCredentials;
  to: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  attachment?: {
    fileName: string;
    mimeType: string;
    contentBase64: string;
  } | null;
};

export type SendEmailResult = {
  providerMessageId: string;
  threadId: string | null;
  rfcMessageId: string | null;
};

export class EmailSender {
  private readonly gmail = new GmailClient();

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (input.threadId) {
      const providerMessageId = await this.gmail.sendReply({
        credentials: input.credentials,
        to: input.to,
        subject: input.subject,
        body: input.body,
        threadId: input.threadId,
        inReplyTo: input.inReplyTo,
        references: input.references,
        attachment: input.attachment,
      });
      let rfcMessageId: string | null = null;
      try {
        rfcMessageId = (
          await this.gmail.getMessageMetadata(input.credentials, providerMessageId)
        ).messageHeaderId;
      } catch {
        // Delivery succeeded; RFC metadata can be reconciled asynchronously.
      }
      return { providerMessageId, threadId: input.threadId, rfcMessageId };
    }

    const providerMessageId = await this.gmail.sendMessage({
      credentials: input.credentials,
      to: input.to,
      subject: input.subject,
      body: input.body,
      attachment: input.attachment,
    });
    return { providerMessageId, threadId: null, rfcMessageId: null };
  }
}
