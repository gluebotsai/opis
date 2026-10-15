import type { Logger } from "pino";

import { GmailCredentialStore } from "./credential-store.js";
import { EmailSender } from "./email-sender.js";
import {
  claimEmailDeliveries,
  updateEmailDelivery,
} from "../services/cc-core-email-client.js";

export class EmailDeliveryWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly sender = new EmailSender();

  constructor(
    private readonly credentials: GmailCredentialStore,
    private readonly logger: Logger,
  ) {}

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deliveries = await claimEmailDeliveries(10);
      for (const delivery of deliveries) {
        const credentials = await this.credentials.getByConnectionId(delivery.connectionId);
        if (!credentials || credentials.organizationId !== delivery.organizationId) {
          await updateEmailDelivery(delivery.organizationId, delivery.id, {
            status: "failed",
            error: "Configured Gmail connection is unavailable or belongs to another tenant",
          });
          continue;
        }
        try {
          const sent = await this.sender.send({
            credentials,
            to: delivery.recipientEmail,
            subject: delivery.subject,
            body: delivery.body,
            threadId: delivery.providerThreadId,
            inReplyTo: delivery.inReplyTo,
            references: delivery.references,
          });
          await updateEmailDelivery(delivery.organizationId, delivery.id, {
            status: "sent",
            providerMessageId: sent.providerMessageId,
            providerRfcMessageId: sent.rfcMessageId,
          });
        } catch (error) {
          const exhausted = delivery.attemptCount + 1 >= 5;
          await updateEmailDelivery(delivery.organizationId, delivery.id, {
            status: exhausted ? "failed" : "retry",
            error: error instanceof Error ? error.message : "Gmail delivery failed",
            retryAfterSeconds: Math.min(3_600, 30 * 2 ** delivery.attemptCount),
          });
          this.logger.warn(
            { err: error, deliveryId: delivery.id, exhausted },
            "email outbox delivery failed",
          );
        }
      }
    } catch (error) {
      this.logger.error({ err: error }, "email outbox worker failed");
    } finally {
      this.running = false;
    }
  }
}
