import type { Logger } from "pino";

import type { ChatServiceConfig } from "../config.js";
import type { GmailCredentialStore, GmailRuntimeCredentials } from "./credential-store.js";
import { GmailClient } from "./gmail-client.js";

const WATCH_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NEW_MAILBOX_SCAN_MS = 30_000;

export class GmailWatchManager {
  private readonly gmail = new GmailClient();
  private renewTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private readonly watchedConnectionIds = new Set<string>();
  private scanning = false;

  constructor(
    private readonly config: ChatServiceConfig,
    private readonly credentials: GmailCredentialStore,
    private readonly logger: Logger,
  ) {}

  start(): void {
    void this.renewAll();
    this.renewTimer = setInterval(() => {
      void this.renewAll();
    }, WATCH_RENEW_INTERVAL_MS);
    this.scanTimer = setInterval(() => {
      void this.watchNewMailboxes();
    }, NEW_MAILBOX_SCAN_MS);
    this.renewTimer.unref();
    this.scanTimer.unref();
  }

  stop(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  private async renewAll(): Promise<void> {
    if (!this.config.gmailPubSub || this.scanning) return;
    this.scanning = true;
    try {
      const connected = await this.credentials.listConnected();
      this.dropDisconnected(connected);
      for (const runtime of connected) {
        await this.watchOne(runtime);
      }
    } finally {
      this.scanning = false;
    }
  }

  private async watchNewMailboxes(): Promise<void> {
    if (!this.config.gmailPubSub || this.scanning) return;
    this.scanning = true;
    try {
      const connected = await this.credentials.listConnected();
      this.dropDisconnected(connected);
      for (const runtime of connected) {
        if (this.watchedConnectionIds.has(runtime.connectionId)) continue;
        await this.watchOne(runtime);
      }
    } finally {
      this.scanning = false;
    }
  }

  private dropDisconnected(connected: GmailRuntimeCredentials[]): void {
    const liveIds = new Set(connected.map((runtime) => runtime.connectionId));
    for (const connectionId of this.watchedConnectionIds) {
      if (!liveIds.has(connectionId)) this.watchedConnectionIds.delete(connectionId);
    }
  }

  private async watchOne(runtime: GmailRuntimeCredentials): Promise<void> {
    if (!this.config.gmailPubSub) return;
    try {
      const fresh =
        (await this.credentials.getByConnectionId(runtime.connectionId)) ?? runtime;
      const watch = await this.gmail.registerWatch(fresh, this.config.gmailPubSub.topic);
      this.watchedConnectionIds.add(runtime.connectionId);
      this.logger.info(
        {
          organizationId: runtime.organizationId,
          accountEmail: runtime.accountEmail,
          expiration: watch.expiration,
          historyId: watch.historyId,
          topic: this.config.gmailPubSub.topic,
        },
        "gmail watch registered or renewed",
      );
    } catch (error) {
      this.logger.error(
        { err: error, organizationId: runtime.organizationId, accountEmail: runtime.accountEmail },
        "failed to renew gmail watch",
      );
    }
  }
}
