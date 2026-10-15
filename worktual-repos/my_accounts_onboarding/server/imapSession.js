import { ImapFlow } from "imapflow";

import { getProfileConfig, normalizeMailProfile } from "./mailConfig.js";

class Mutex {
  #chain = Promise.resolve();

  run(task) {
    const next = this.#chain.then(task, task);
    this.#chain = next.catch(() => undefined);
    return next;
  }
}

function folderCandidates(folderKey, config) {
  if (folderKey === "inbox") {
    return [config.imapInbox, "INBOX"];
  }

  if (folderKey === "sent") {
    return [
      config.imapSent,
      "[Gmail]/Sent Mail",
      "[Gmail]/Sent",
      "Sent",
      "Sent Items",
      "Sent Messages",
      "INBOX.Sent",
    ];
  }

  if (folderKey === "spam") {
    return [
      config.imapSpam,
      "[Gmail]/Spam",
      "[Gmail]/Bulk Mail",
      "Spam",
      "Junk",
      "Junk E-mail",
      "Junk Email",
      "Bulk Mail",
    ];
  }

  return [config.imapInbox, "INBOX"];
}

function folderMatcher(folderKey, box) {
  const path = box.path || "";
  const name = box.name || "";

  if (folderKey === "sent") {
    return /sent/i.test(path) || /sent/i.test(name);
  }

  if (folderKey === "spam") {
    return /spam|junk|bulk/i.test(path) || /spam|junk|bulk/i.test(name);
  }

  return path === "INBOX" || /inbox/i.test(name);
}

function createImapClient(profile) {
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
  constructor(profile) {
    this.profile = normalizeMailProfile(profile);
    this.client = null;
    this.mutex = new Mutex();
    this.folderPaths = new Map();
    this.connectPromise = null;
  }

  isConnected() {
    return Boolean(this.client && !this.client.closed);
  }

  async connect() {
    if (this.isConnected()) {
      return this.client;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      if (this.client) {
        await this.client.logout().catch(() => undefined);
        this.client = null;
      }

      const client = createImapClient(this.profile);
      client.on("close", () => {
        if (this.client === client) {
          this.client = null;
        }
      });
      client.on("error", () => {
        if (this.client === client) {
          this.client = null;
        }
      });

      await client.connect();
      this.client = client;
      return client;
    })();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async disconnect() {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = null;
    await client.logout().catch(() => undefined);
  }

  async resolveMailboxPath(folderKey) {
    if (this.folderPaths.has(folderKey)) {
      return this.folderPaths.get(folderKey);
    }

    const client = await this.connect();
    const config = getProfileConfig(this.profile);
    const candidates = [...new Set(folderCandidates(folderKey, config).filter(Boolean))];

    for (const mailbox of candidates) {
      try {
        const lock = await client.getMailboxLock(mailbox);
        lock.release();
        this.folderPaths.set(folderKey, mailbox);
        return mailbox;
      } catch {
        // Try next candidate.
      }
    }

    const listing = await client.list();
    const match = listing.find((box) => folderMatcher(folderKey, box));

    if (match?.path) {
      this.folderPaths.set(folderKey, match.path);
      return match.path;
    }

    throw new Error(`Could not open the ${folderKey} mailbox for ${this.profile} mail.`);
  }

  async withMailbox(folderKey, callback) {
    return this.mutex.run(async () => {
      const client = await this.connect();
      const mailbox = await this.resolveMailboxPath(folderKey);
      const lock = await client.getMailboxLock(mailbox);

      try {
        return await callback(client, mailbox);
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

export async function withImapMailbox(folderKey, profile, callback) {
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

export function invalidateImapFolderCache(profile, folderKey) {
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
