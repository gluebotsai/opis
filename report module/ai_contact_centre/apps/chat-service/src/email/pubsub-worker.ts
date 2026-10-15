import { PubSub } from "@google-cloud/pubsub";
import type { Logger } from "pino";

import type { ChatServiceConfig } from "../config.js";
import type { GmailInboundProcessor } from "./inbound-processor.js";

type PubSubNotification = {
  emailAddress?: string;
  historyId?: string | number;
};

export class GmailPubSubWorker {
  private pubsub: PubSub | null = null;
  private subscription: ReturnType<PubSub["subscription"]> | null = null;
  private readonly mailboxTails = new Map<string, Promise<void>>();

  constructor(
    private readonly config: ChatServiceConfig,
    private readonly processor: GmailInboundProcessor,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (!this.config.gmailPubSub) {
      this.logger.info("gmail pubsub worker disabled (missing GMAIL_PUBSUB_* env)");
      return;
    }

    this.pubsub = new PubSub({
      projectId: this.config.gmailPubSub.projectId,
      keyFilename: this.config.gmailPubSub.credentialsPath,
    });
    this.subscription = this.pubsub.subscription(this.config.gmailPubSub.subscription, {
      // Keep unrelated mailboxes moving while one email is doing NLP or retrying.
      flowControl: { maxMessages: 8 },
    });

    this.subscription.on("message", (message) => {
      void this.handleMessage(message);
    });
    this.subscription.on("error", (error) => {
      this.logger.error({ err: error }, "gmail pubsub subscription error");
    });

    this.logger.info(
      {
        projectId: this.config.gmailPubSub.projectId,
        topic: this.config.gmailPubSub.topic,
        subscription: this.config.gmailPubSub.subscription,
        deliveryMode: "pubsub_pull",
      },
      "gmail pubsub worker listening (pull subscription — no webhook URL required)",
    );
  }

  async stop(): Promise<void> {
    if (this.subscription) {
      await this.subscription.close();
      this.subscription = null;
    }
    if (this.pubsub) {
      await this.pubsub.close();
      this.pubsub = null;
    }
  }

  private async handleMessage(message: {
    data: Buffer;
    ack: () => void;
    nack: () => void;
  }): Promise<void> {
    let payload: PubSubNotification;
    try {
      payload = JSON.parse(message.data.toString("utf8")) as PubSubNotification;
    } catch (error) {
      this.logger.warn({ err: error }, "discarded malformed gmail pubsub message");
      message.ack();
      return;
    }
    const emailAddress = payload.emailAddress?.trim();
    if (!emailAddress) {
      this.logger.warn("discarded gmail pubsub message without emailAddress");
      message.ack();
      return;
    }
    try {
      const accepted = await this.runForMailbox(emailAddress, () =>
        this.processor.processNotification({
          emailAddress,
          historyId: payload.historyId != null ? String(payload.historyId) : null,
        }),
      );
      this.logger.info({ emailAddress, accepted }, "gmail pubsub notification processed");
      message.ack();
    } catch (error) {
      this.logger.error({ err: error }, "failed to handle gmail pubsub message");
      message.nack();
    }
  }

  private async runForMailbox<T>(emailAddress: string, operation: () => Promise<T>): Promise<T> {
    const mailboxKey = emailAddress.toLowerCase();
    const previous = this.mailboxTails.get(mailboxKey) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.mailboxTails.set(mailboxKey, tail);
    try {
      return await run;
    } finally {
      if (this.mailboxTails.get(mailboxKey) === tail) {
        this.mailboxTails.delete(mailboxKey);
      }
    }
  }
}
