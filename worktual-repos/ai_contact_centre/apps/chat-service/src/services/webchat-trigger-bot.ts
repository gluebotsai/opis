import type { Logger } from "pino";
import type { WebSocket } from "ws";
import { z } from "zod";

import type { AccountsConfigClient } from "./accounts-config-client.js";
import { persistProactiveBotMessage } from "./proactive-bot-memory.js";
import type { OrchestratedBotResponder } from "./webchat-orchestrator.js";
import type { WebchatSessionStore } from "./webchat-session-store.js";
import type { WebchatConnectionRegistry } from "../websocket/webchat-connection-registry.js";
import { ensureWebchatSession } from "../websocket/webchat-session-start.js";
import {
  visitorIdSchema,
  webchatIdSchema,
  type OutboundFrame,
  type WidgetPopupFrame,
} from "../types/webchat-frames.js";

export const triggerBotRequestSchema = z.object({
  webchatId: webchatIdSchema,
  visitorId: visitorIdSchema,
  text: z.string().min(1).max(4_000).optional(),
  openPanel: z.boolean().optional(),
  openMode: z.enum(["bubble", "panel"]).optional(),
  autoSessionStart: z.boolean().optional().default(true),
  reason: z.string().min(1).max(128).optional(),
  pageUrl: z.string().url().max(4_096).optional(),
});

export type TriggerBotRequest = z.infer<typeof triggerBotRequestSchema>;

export type WebchatTriggerBotDeps = {
  registry: WebchatConnectionRegistry;
  sessionStore: WebchatSessionStore;
  bot: OrchestratedBotResponder;
  accountsClient: AccountsConfigClient;
  logger: Logger;
};

function sendFrame(ws: WebSocket, frame: OutboundFrame): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(frame));
}

function resolveOpenMode(payload: TriggerBotRequest): "bubble" | "panel" | undefined {
  if (payload.openMode) return payload.openMode;
  if (payload.openPanel === true) return "panel";
  if (payload.openPanel === false) return "bubble";
  return "panel";
}

export async function triggerWebchatBot(
  deps: WebchatTriggerBotDeps,
  payload: TriggerBotRequest,
): Promise<
  | { ok: true; conversationId?: string; sessionStarted: boolean }
  | { ok: false; status: number; error: string }
> {
  const connection = deps.registry.getBySession(payload.webchatId, payload.visitorId);
  if (!connection) {
    return { ok: false, status: 404, error: "No active webchat connection for visitor" };
  }

  const openMode = resolveOpenMode(payload);
  const hubText = payload.text?.trim() ?? "";
  const popupFrame: WidgetPopupFrame = {
    type: "widget.popup",
    webchatId: payload.webchatId,
    visitorId: payload.visitorId,
    openMode,
    autoSessionStart: payload.autoSessionStart,
    ...(payload.text ? { text: payload.text } : {}),
    ...(payload.reason ? { reason: payload.reason } : {}),
  };

  if (payload.autoSessionStart === false) {
    sendFrame(connection.ws, popupFrame);
    deps.logger.info(
      {
        webchatId: payload.webchatId,
        visitorId: payload.visitorId,
        openMode,
        autoSessionStart: false,
      },
      "webchat popup triggered without session start",
    );
    return { ok: true, sessionStarted: false };
  }

  const { session, resumed } = await ensureWebchatSession({
    sessionStore: deps.sessionStore,
    bot: deps.bot,
    accountsClient: deps.accountsClient,
    logger: deps.logger,
    webchatId: payload.webchatId,
    visitorId: payload.visitorId,
    skipOpening: Boolean(hubText),
    frame: {
      type: "session.start",
      webchatId: payload.webchatId,
      visitorId: payload.visitorId,
      ...(payload.pageUrl ? { pageUrl: payload.pageUrl } : {}),
    },
  });

  deps.registry.register({
    webchatId: payload.webchatId,
    visitorId: payload.visitorId,
    conversationId: session.conversationId,
    ws: connection.ws,
  });

  const visitorHasSpoken = session.messages.some((message) => message.from === "user");
  if (hubText && !visitorHasSpoken) {
    session.messages = session.messages.filter(
      (message) => message.from !== "bot" || message.text.trim() === hubText,
    );
    session.pendingOpening = false;
  }

  sendFrame(connection.ws, popupFrame);
  sendFrame(connection.ws, {
    type: "session.ready",
    webchatId: payload.webchatId,
    visitorId: payload.visitorId,
    conversationId: session.conversationId,
    resumed,
    messages: session.messages,
    stub: false,
  });

  if (session.pendingOpening) session.pendingOpening = false;
  let greetingText = hubText
    ? undefined
    : session.messages.findLast((message) => message.from === "bot")?.text?.trim();
  if (!hubText && !greetingText) {
    const config = await deps.accountsClient.fetchWebchatConfig(payload.webchatId);
    greetingText = config?.greetingMessage?.trim() || undefined;
    if (greetingText) {
      deps.sessionStore.addMessage(payload.webchatId, payload.visitorId, {
        from: "bot",
        text: greetingText,
        at: new Date().toISOString(),
      });
    }
  }

  if (greetingText) {
    sendFrame(connection.ws, {
      type: "message",
      from: "bot",
      text: greetingText,
      stub: false,
    });
  }

  const hubAlreadyShown = session.messages.some(
    (message) => message.from === "bot" && message.text.trim() === hubText,
  );
  if (hubText && !hubAlreadyShown) {
    const proactiveText = hubText;
    deps.sessionStore.addMessage(payload.webchatId, payload.visitorId, {
      from: "bot",
      text: proactiveText,
      at: new Date().toISOString(),
    });
    sendFrame(connection.ws, {
      type: "message",
      from: "bot",
      text: proactiveText,
      stub: false,
    });

    if (session.organizationId) {
      const persisted = await persistProactiveBotMessage(
        session.organizationId,
        session.conversationId,
        proactiveText,
        { reason: payload.reason },
      );
      if (!persisted) {
        deps.logger.warn(
          {
            webchatId: payload.webchatId,
            visitorId: payload.visitorId,
            conversationId: session.conversationId,
          },
          "proactive bot message not persisted to NLP memory",
        );
      }
    }
  }

  deps.logger.info(
    {
      webchatId: payload.webchatId,
      visitorId: payload.visitorId,
      conversationId: session.conversationId,
      resumed,
      openMode,
    },
    "webchat bot triggered",
  );

  return {
    ok: true,
    conversationId: session.conversationId,
    sessionStarted: true,
  };
}
