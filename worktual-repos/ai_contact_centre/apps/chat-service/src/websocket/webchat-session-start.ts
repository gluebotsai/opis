import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { AccountsConfigClient } from "../services/accounts-config-client.js";
import {
  fetchWebchatContext as fetchWebchatContextFromCore,
  resumeWebchatSession,
} from "../services/cc-core-client.js";
import type { OrchestratedBotResponder } from "../services/webchat-orchestrator.js";
import type { WebchatSession } from "../services/webchat-session-store.js";
import { WebchatSessionStore } from "../services/webchat-session-store.js";
import type { SessionStartFrame } from "../types/webchat-frames.js";

const sessionStartLocks = new Map<string, Promise<WebchatSession>>();

function lockKey(webchatId: string, visitorId: string): string {
  return `${webchatId}:${visitorId}`;
}

export async function resolveWebchatSession(
  sessionStore: WebchatSessionStore,
  webchatId: string,
  visitorId: string,
): Promise<WebchatSession | undefined> {
  const pending = sessionStartLocks.get(lockKey(webchatId, visitorId));
  if (pending) {
    try {
      await pending;
    } catch {
      // Startup failed; fall through to current store state.
    }
  }
  return sessionStore.get(webchatId, visitorId);
}

export async function ensureWebchatSession(input: {
  sessionStore: WebchatSessionStore;
  bot: OrchestratedBotResponder;
  accountsClient: AccountsConfigClient;
  logger: Logger;
  webchatId: string;
  visitorId: string;
  frame: SessionStartFrame;
  /** Hub popup carries its own greeting, so this start must not write another. */
  skipOpening?: boolean;
}): Promise<{ session: WebchatSession; resumed: boolean }> {
  const { sessionStore, webchatId, visitorId } = input;
  const key = lockKey(webchatId, visitorId);

  const ready = sessionStore.get(webchatId, visitorId);
  if (ready?.startupComplete) {
    return { session: ready, resumed: true };
  }

  let lock = sessionStartLocks.get(key);
  if (!lock) {
    lock = startWebchatSession(input);
    sessionStartLocks.set(key, lock);
    void lock.finally(() => {
      if (sessionStartLocks.get(key) === lock) {
        sessionStartLocks.delete(key);
      }
    });
  }

  const session = await lock;
  return {
    session,
    resumed:
      session.resumedFromDurableStore === true ||
      session.messages.some((message) => message.from === "user"),
  };
}

async function startWebchatSession(input: {
  sessionStore: WebchatSessionStore;
  bot: OrchestratedBotResponder;
  accountsClient: AccountsConfigClient;
  logger: Logger;
  webchatId: string;
  visitorId: string;
  frame: SessionStartFrame;
  skipOpening?: boolean;
}): Promise<WebchatSession> {
  const { sessionStore, bot, accountsClient, logger, webchatId, visitorId, frame } = input;

  const existing = sessionStore.get(webchatId, visitorId);
  if (existing?.startupComplete) {
    return existing;
  }

  if (existing?.startupReady) {
    await existing.startupReady.catch(() => undefined);
    const afterWait = sessionStore.get(webchatId, visitorId);
    if (afterWait?.startupComplete) return afterWait;
  }

  const session = sessionStore.getOrCreate(webchatId, visitorId, randomUUID(), {
    pageUrl: frame.pageUrl,
    consent: frame.consent,
    prechatAnswers: frame.prechatAnswers,
  });

  const startupReady = (async () => {
    const [config, ccContext] = await Promise.all([
      accountsClient.fetchWebchatConfig(webchatId),
      fetchWebchatContextFromCore(webchatId),
    ]);
    if (
      !ccContext ||
      (config?.organizationId != null &&
        String(config.organizationId) !== String(ccContext.organizationId))
    ) {
      throw new Error("Webchat configuration unavailable");
    }

    session.organizationId = ccContext.organizationId;
    session.routingQueueId = ccContext.routingQueueId;
    bot.primeContext(webchatId, ccContext);

    const durableResume = await resumeWebchatSession({
      webchatId,
      visitorId,
      organizationId: ccContext.organizationId,
    });
    if (durableResume?.resumed && durableResume.conversation) {
      const resumedConversationId = durableResume.conversation.id;
      sessionStore.replaceConversationId(webchatId, visitorId, resumedConversationId);
      session.routingQueueId =
        durableResume.conversation.queueId ?? ccContext.routingQueueId;
      session.messages = durableResume.messages.map((message) => ({
        from: message.senderType === "customer" ? "user" : "bot",
        text: message.body,
        at: message.createdAt,
      }));
      session.resumedFromDurableStore = true;
      logger.info(
        { conversationId: resumedConversationId },
        "webchat session resumed from cc-core",
      );
      return;
    }

    const started = await bot.onSessionStart(webchatId, visitorId, session.conversationId, {
      pageUrl: frame.pageUrl,
      consent: frame.consent,
      prechatAnswers: frame.prechatAnswers,
      skipOpening: input.skipOpening,
    });
    if (started?.conversationId) {
      sessionStore.replaceConversationId(webchatId, visitorId, started.conversationId);
      session.conversationId = started.conversationId;
    }
    if (started?.generatedOpening && started.text?.trim()) {
      sessionStore.addMessage(webchatId, visitorId, {
        from: "bot",
        text: started.text.trim(),
        at: new Date().toISOString(),
      });
      session.pendingOpening = true;
    }
  })();

  void startupReady.catch(() => undefined);
  session.startupReady = startupReady.then(
    () => undefined,
    () => undefined,
  );

  try {
    await startupReady;
    sessionStore.markStartupComplete(webchatId, visitorId);
    return session;
  } catch (error) {
    sessionStore.end(webchatId, visitorId);
    throw error;
  }
}
