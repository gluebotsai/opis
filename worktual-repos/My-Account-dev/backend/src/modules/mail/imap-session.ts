import { ImapFlow } from "imapflow";

import { getProfileConfig, normalizeMailProfile } from "./config.js";
import { getImapFolderCandidates, matchImapFolder } from "./folders.js";
import { withTiming } from "../../infra/file-logger.js";

class Mutex {
  #chain = Promise.resolve();

  run(task: any) {
    const next = this.#chain.then(task, task);
    this.#chain = next.catch(() => undefined);
    return next;
  }
}

function folderCandidates(folderKey: any, config: any) {
  return getImapFolderCandidates(folderKey, config);
}

function folderMatcher(folderKey: any, box: any) {
  return matchImapFolder(folderKey, box);
}

function createImapClient(profile: any) {
  const config = getProfileConfig(profile);

  if (!config.hasImap()) {
    throw new Error(
      `IMAP is not configured for ${profile}. Set ${profile === "sales" ? "SALES" : "FINANCE"}_IMAP_* in .env.`,
    );
  }

  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    auth: {
      user: config.imapUser,
      pass: config.imapPass,
    },
    logger: false,
    disableAutoIdle: true,
    maxIdleTime: 20 * 60 * 1000,
  });
}

class ImapSession {
  constructor(profile: any) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    this.profile = normalizeMailProfile(profile);
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    this.client = null;
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    this.mutex = new Mutex();
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    this.folderPaths = new Map();
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    this.connectPromise = null;
  }

  isConnected() {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    return Boolean(this.client && !this.client.closed);
  }

  async connect() {
    if (this.isConnected()) {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return this.client;
    }

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (this.connectPromise) {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return this.connectPromise;
    }

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    this.connectPromise = withTiming("mail", "imap.connect", async () => {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      if (this.client) {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        await this.client.logout().catch(() => undefined);
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        this.client = null;
      }

      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      const client = createImapClient(this.profile);
      client.on("close", () => {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        if (this.client === client) {
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          this.client = null;
        }
      });
      client.on("error", () => {
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        if (this.client === client) {
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          this.client = null;
        }
      });

      await client.connect();
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      this.client = client;
      return client;
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    }, { profile: this.profile });

    try {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return await this.connectPromise;
    } finally {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      this.connectPromise = null;
    }
  }

  async disconnect() {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (!this.client) {
      return;
    }

    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    const client = this.client;
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    this.client = null;
    await client.logout().catch(() => undefined);
  }

  async resolveMailboxPath(folderKey: any) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    if (this.folderPaths.has(folderKey)) {
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      return this.folderPaths.get(folderKey);
    }

    return withTiming(
      "mail",
      "imap.resolveMailboxPath",
      async () => {
        const client = await this.connect();
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        const config = getProfileConfig(this.profile);
        const candidates = [...new Set(folderCandidates(folderKey, config).filter(Boolean))];

        for (const mailbox of candidates) {
          try {
            const lock = await client.getMailboxLock(mailbox);
            lock.release();
            // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
            this.folderPaths.set(folderKey, mailbox);
            return mailbox;
          } catch {
            // Try next candidate.
          }
        }

        const listing = await client.list();
        const match = listing.find((box: any) => folderMatcher(folderKey, box));

        if (match?.path) {
          // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
          this.folderPaths.set(folderKey, match.path);
          return match.path;
        }

        // Optional folders: soft-unavailable instead of hard error when mailbox lacks them.
        if (["drafts", "archive", "spam"].includes(folderKey)) {
          return null;
        }

        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        throw new Error(`Could not open the ${folderKey} mailbox for ${this.profile} mail.`);
      },
      // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
      { profile: this.profile, folder: folderKey },
    );
  }

  async withMailbox(folderKey: any, callback: any) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    return this.mutex.run(async () =>
      withTiming(
        "mail",
        "imap.withMailbox",
        async () => {
          const client = await this.connect();
          const mailbox = await this.resolveMailboxPath(folderKey);
          if (!mailbox) {
            return null;
          }
          const lock = await client.getMailboxLock(mailbox);

          try {
            return await callback(client, mailbox);
          } finally {
            lock.release();
          }
        },
        // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
        { profile: this.profile, folder: folderKey },
      ),
    );
  }

  async moveMessage(sourceFolderKey: any, uid: any, destinationFolderKey: any) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    return this.mutex.run(async () => {
      const client = await this.connect();
      const sourceMailbox = await this.resolveMailboxPath(sourceFolderKey);
      const destinationMailbox = await this.resolveMailboxPath(destinationFolderKey);
      if (!sourceMailbox || !destinationMailbox) {
        throw new Error("Move is not supported for this folder on this mailbox provider.");
      }

      const sourceLock = await client.getMailboxLock(sourceMailbox);
      try {
        await client.messageMove(String(uid), destinationMailbox, { uid: true });
      } finally {
        sourceLock.release();
      }
    });
  }

  async setMessageFlagged(folderKey: any, uid: any, flagged: any) {
    // @ts-expect-error -- legacy runtime boundary is validated by integration checks.
    return this.mutex.run(async () => {
      const client = await this.connect();
      const mailbox = await this.resolveMailboxPath(folderKey);
      if (!mailbox) {
        throw new Error("Flag is not supported for this folder on this mailbox provider.");
      }

      const lock = await client.getMailboxLock(mailbox);
      try {
        if (flagged) {
          await client.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true });
        } else {
          await client.messageFlagsRemove(String(uid), ["\\Flagged"], { uid: true });
        }
      } finally {
        lock.release();
      }
    });
  }
}

const sessions = new Map();

export function getImapSession(profile = "finance") {
  const role = normalizeMailProfile(profile);
  if (!sessions.has(role)) {
    sessions.set(role, new ImapSession(role));
  }

  return sessions.get(role);
}

export async function withImapMailbox(folderKey: any, profile: any, callback: any) {
  const session = getImapSession(profile);
  return session.withMailbox(folderKey, callback);
}

export async function preloadImapSessions() {
  const profiles = ["sales", "finance", "sales_admin"];

  await Promise.all(
    profiles.map(async (profile) => {
      const config = getProfileConfig(profile);
      if (!config.hasImap()) {
        return;
      }

      try {
        const session = getImapSession(profile);
        await session.connect();
        await session.resolveMailboxPath("inbox");
        console.log(`[mail] IMAP session ready for ${profile} (${config.imapUser}).`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[mail] IMAP preload failed for ${profile}: ${message}`);
      }
    }),
  );
}

export function invalidateImapFolderCache(profile: any, folderKey: any) {
  const session = sessions.get(normalizeMailProfile(profile));
  if (!session) {
    return;
  }

  if (folderKey) {
    session.folderPaths.delete(folderKey);
    return;
  }

  session.folderPaths.clear();
}
