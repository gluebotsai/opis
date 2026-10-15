import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { AccountsConfigClient } from "../services/accounts-config-client.js";
import {
  endWebchatConversation,
  markWebchatSessionDisconnected,
  publishWebchatTyping,
  recordWebchatReceipt,
} from "../services/cc-core-client.js";
import { OrchestratedBotResponder } from "../services/webchat-orchestrator.js";
import { WebchatSessionStore } from "../services/webchat-session-store.js";
import type { WebchatConnectionRegistry } from "./webchat-connection-registry.js";
import {
  ensureWebchatSession,
  resolveWebchatSession,
} from "./webchat-session-start.js";
import {
  isValidWebchatId,
  parseInboundFrame,
  type InboundFrame,
  type OutboundFrame,
} from "../types/webchat-frames.js";

export type WebchatWsGatewayOptions = {
  paths?: string[];
  accountsPublicApiUrl?: string;
  connectionRegistry?: WebchatConnectionRegistry;
  sessionStore?: WebchatSessionStore;
  bot?: OrchestratedBotResponder;
};

const WS_COMPONENT = "webchat-ws";
const DEFAULT_WS_PATHS = ["/ws/webchat", "/ccaas/chat"];

type ConnectionBinding = {
  webchatId: string | null;
  visitorId: string | null;
};

function sendFrame(wsLogger: Logger, ws: WebSocket, frame: OutboundFrame): void {
  if (ws.readyState !== ws.OPEN) return;

  wsLogger.info(
    {
      direction: "outbound",
      frameType: frame.type,
      ...(frame.type === "message" ? { from: frame.from, stub: frame.stub } : {}),
      ...(frame.type === "session.ready" ? { conversationId: frame.conversationId } : {}),
    },
    "webchat ws frame sent",
  );
  ws.send(JSON.stringify(frame));
}

function webchatStartupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unable to start chat session";
  if (message === "Webchat configuration unavailable") {
    return message;
  }
  if (message.startsWith("Failed to persist webchat session")) {
    if (message.includes("unreachable") || message.includes("ECONNREFUSED")) {
      return "Chat service is temporarily unavailable. Please try again in a moment.";
    }
    return "Unable to start chat session. Please refresh and try again.";
  }
  return "Unable to start chat session";
}

function sendSystem(wsLogger: Logger, ws: WebSocket, text: string): void {
  wsLogger.warn({ direction: "outbound", frameType: "system", text }, "webchat ws system frame sent");
  sendFrame(wsLogger, ws, { type: "system", text });
}

function parseQueryParams(request: IncomingMessage): {
  webchatId: string | null;
  visitorId: string | null;
} {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  return {
    webchatId: url.searchParams.get("webchatId"),
    visitorId: url.searchParams.get("visitorId"),
  };
}

function logInboundFrame(wsLogger: Logger, frame: InboundFrame): void {
  wsLogger.info(
    {
      direction: "inbound",
      frameType: frame.type,
      ...(frame.type === "message"
        ? { textLength: frame.text?.length ?? 0, attachmentCount: frame.attachments?.length ?? 0 }
        : {}),
      ...(frame.type === "session.start" && frame.pageUrl ? { pageUrl: frame.pageUrl } : {}),
    },
    "webchat ws frame received",
  );
}

function bindConnectionIds(
  binding: ConnectionBinding,
  frame: InboundFrame,
): { webchatId: string; visitorId: string } | "mismatch" {
  if (binding.webchatId && binding.visitorId) {
    if (binding.webchatId !== frame.webchatId || binding.visitorId !== frame.visitorId) {
      return "mismatch";
    }
    return { webchatId: binding.webchatId, visitorId: binding.visitorId };
  }

  return { webchatId: frame.webchatId, visitorId: frame.visitorId };
}

export function registerWebchatWsGateway(
  server: HttpServer,
  logger: Logger,
  options: WebchatWsGatewayOptions = {},
): WebSocketServer {
  const wsPaths = new Set(options.paths ?? DEFAULT_WS_PATHS);
  const wsLogger = logger.child({ component: WS_COMPONENT });
  const wss = new WebSocketServer({ noServer: true });
  const sessionStore = options.sessionStore ?? new WebchatSessionStore();
  const connectionRegistry = options.connectionRegistry;
  const bot = options.bot ?? new OrchestratedBotResponder();
  const accountsClient = new AccountsConfigClient(options.accountsPublicApiUrl, wsLogger);

  server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (!wsPaths.has(url.pathname)) {
      return;
    }

    const { webchatId, visitorId } = parseQueryParams(request);

    if (webchatId && !isValidWebchatId(webchatId)) {
      wsLogger.warn(
        { path: url.pathname, webchatId, visitorId, reason: "invalid_webchat_id" },
        "webchat ws upgrade rejected",
      );
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    if ((webchatId && !visitorId) || (!webchatId && visitorId)) {
      wsLogger.warn(
        { path: url.pathname, webchatId, visitorId, reason: "partial_query_params" },
        "webchat ws upgrade rejected",
      );
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    wsLogger.info(
      {
        path: url.pathname,
        webchatId: webchatId ?? undefined,
        visitorId: visitorId ?? undefined,
        bindOnSessionStart: !webchatId,
      },
      "webchat ws upgrade accepted",
    );

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, url.pathname, webchatId, visitorId);
    });
  });

  wss.on(
    "connection",
    (
      ws: WebSocket,
      _request: IncomingMessage,
      path: string,
      initialWebchatId: string | null,
      initialVisitorId: string | null,
    ) => {
      const binding: ConnectionBinding = {
        webchatId: initialWebchatId,
        visitorId: initialVisitorId,
      };

      const connLogger = wsLogger.child({
        ...(initialWebchatId ? { webchatId: initialWebchatId } : {}),
        ...(initialVisitorId ? { visitorId: initialVisitorId } : {}),
        wsPath: path,
      });
      connLogger.info("webchat ws connected");

      if (initialWebchatId && initialVisitorId) {
        connectionRegistry?.registerPresence({
          webchatId: initialWebchatId,
          visitorId: initialVisitorId,
          ws,
        });
      }

      ws.on("error", (error) => {
        connLogger.error({ err: error }, "webchat ws connection error");
      });

      ws.on("message", async (raw) => {
        let data: unknown;
        try {
          data = JSON.parse(raw.toString());
        } catch {
          connLogger.warn({ direction: "inbound", reason: "invalid_json" }, "webchat ws frame rejected");
          sendSystem(connLogger, ws, "Invalid JSON frame");
          return;
        }

        try {
          const frame = parseInboundFrame(data);
          logInboundFrame(connLogger, frame);

          const resolved = bindConnectionIds(binding, frame);
          if (resolved === "mismatch") {
            connLogger.warn(
              {
                reason: "id_mismatch",
                boundWebchatId: binding.webchatId,
                boundVisitorId: binding.visitorId,
                frameWebchatId: frame.webchatId,
                frameVisitorId: frame.visitorId,
              },
              "webchat ws frame rejected",
            );
            sendSystem(connLogger, ws, "webchatId/visitorId mismatch with connection query params");
            return;
          }

          if (!binding.webchatId) {
            binding.webchatId = resolved.webchatId;
            binding.visitorId = resolved.visitorId;
          }

          const { webchatId, visitorId } = resolved;

          if (frame.type === "presence.bind") {
            connectionRegistry?.registerPresence({ webchatId, visitorId, ws });
            sendFrame(connLogger, ws, { type: "presence.bound", webchatId, visitorId });
            return;
          }

          if (frame.type === "session.start") {
            try {
              const { session, resumed } = await ensureWebchatSession({
                sessionStore,
                bot,
                accountsClient,
                logger: connLogger,
                webchatId,
                visitorId,
                frame,
              });

              connectionRegistry?.register({
                webchatId,
                visitorId,
                conversationId: session.conversationId,
                ws,
              });

              const openingText = session.pendingOpening
                ? session.messages.findLast((message) => message.from === "bot")?.text?.trim()
                : "";
              if (session.pendingOpening) session.pendingOpening = false;

              sendFrame(connLogger, ws, {
                type: "session.ready",
                webchatId,
                visitorId,
                conversationId: session.conversationId,
                resumed,
                messages: openingText
                  ? session.messages.filter(
                      (message) => message.from !== "bot" || message.text.trim() !== openingText,
                    )
                  : session.messages,
                stub: false,
              });

              if (openingText) {
                sendFrame(connLogger, ws, {
                  type: "message",
                  from: "bot",
                  text: openingText,
                  stub: false,
                });
              }

              connLogger.info(
                {
                  conversationId: session.conversationId,
                  hasConsent: Boolean(frame.consent),
                  resumed,
                },
                resumed ? "webchat session resumed" : "webchat session started",
              );
            } catch (error) {
              connLogger.error({ err: error, webchatId }, "webchat session start failed");
              sendSystem(connLogger, ws, webchatStartupErrorMessage(error));
            }
            return;
          }

          if (frame.type === "ping") {
            sendFrame(connLogger, ws, { type: "system", text: "pong" });
            return;
          }

          const session = await resolveWebchatSession(sessionStore, webchatId, visitorId);
          if (!session?.startupComplete) {
            connLogger.warn({ reason: "session_not_started" }, "webchat ws frame rejected");
            sendSystem(connLogger, ws, "Session not started. Send session.start first.");
            return;
          }

          if (frame.type === "session.end") {
            const ended = session.organizationId
              ? await endWebchatConversation(
                  session.organizationId,
                  session.conversationId,
                  frame.reason,
                )
              : false;
            if (!ended) {
              sendSystem(connLogger, ws, "Unable to end session");
              return;
            }
            sendFrame(connLogger, ws, { type: "session.ended", reason: frame.reason });
            connectionRegistry?.unregister(webchatId, visitorId, session.conversationId);
            sessionStore.end(webchatId, visitorId);
            return;
          }

          if (frame.type === "typing.started" || frame.type === "typing.stopped") {
            if (session.organizationId) {
              await publishWebchatTyping(
                session.organizationId,
                session.conversationId,
                frame.type === "typing.started",
              );
            }
            return;
          }

          if (frame.type === "receipt.delivered" || frame.type === "receipt.read") {
            if (session.organizationId) {
              await recordWebchatReceipt(session.organizationId, session.conversationId, {
                messageId: frame.messageId,
                status: frame.type === "receipt.read" ? "read" : "delivered",
                visitorId,
                occurredAt: frame.occurredAt,
              });
            }
            return;
          }

          if (frame.type === "message") {
            connectionRegistry?.register({
              webchatId,
              visitorId,
              conversationId: session.conversationId,
              ws,
            });

            const messageText =
              frame.text ??
              frame.attachments?.map((attachment) => `[Attachment: ${attachment.fileName}]`).join("\n") ??
              "";

            sessionStore.addMessage(webchatId, visitorId, {
              from: "user",
              text: messageText,
              at: new Date().toISOString(),
            });

            const reply = await bot.onMessage(session, messageText, frame.attachments);
            if (session.lastCustomerMessageId) {
              sendFrame(connLogger, ws, {
                type: "receipt.sent",
                messageId: session.lastCustomerMessageId,
                occurredAt: new Date().toISOString(),
              });
            }
            if (reply.text) {
              sessionStore.addMessage(webchatId, visitorId, {
                from: "bot",
                text: reply.text,
                at: new Date().toISOString(),
              });

              sendFrame(connLogger, ws, {
                type: "message",
                from: "bot",
                text: reply.text,
                messageId: reply.messageId,
                stub: reply.stub,
              });
            }

            connLogger.info(
              { conversationId: session.conversationId, userTextLength: messageText.length },
              "webchat message handled",
            );
          }
        } catch (error) {
          if (error instanceof ZodError) {
            connLogger.warn(
              { reason: "invalid_frame", errors: error.errors.map((e) => e.message) },
              "webchat ws frame rejected",
            );
            sendSystem(connLogger, ws, `Invalid frame: ${error.errors.map((e) => e.message).join(", ")}`);
            return;
          }
          connLogger.error({ err: error }, "webchat frame handler error");
          sendSystem(connLogger, ws, "Internal error processing frame");
        }
      });

      ws.on("close", (code, reason) => {
        const webchatId = binding.webchatId;
        const visitorId = binding.visitorId;
        if (webchatId && visitorId) {
          const session = sessionStore.get(webchatId, visitorId);
          if (session?.organizationId) {
            void publishWebchatTyping(
              session.organizationId,
              session.conversationId,
              false,
            );
          }
          connectionRegistry?.unregister(
            webchatId,
            visitorId,
            session?.conversationId,
          );

          if (session?.organizationId) {
            const { organizationId, conversationId } = session;
            void markWebchatSessionDisconnected(organizationId, conversationId, 45);
            setTimeout(() => {
              const stillStored = sessionStore.get(webchatId, visitorId);
              if (!stillStored || stillStored.conversationId !== conversationId) return;
              const reconnected = connectionRegistry?.getBySession(webchatId, visitorId);
              if (reconnected) return;
              void endWebchatConversation(organizationId, conversationId, "visitor_disconnected")
                .then((ended) => {
                  if (ended) sessionStore.end(webchatId, visitorId);
                })
                .catch(() => undefined);
            }, 45_000);
          }
        }
        connLogger.info(
          { closeCode: code, closeReason: reason.toString() || undefined },
          "webchat ws disconnected",
        );
      });
    },
  );

  wsLogger.info({ paths: [...wsPaths] }, "webchat websocket gateway registered");
  return wss;
}

export function webchatWsInfo(paths: string[]) {
  return {
    protocol: "websocket",
    paths,
    connectExample:
      "wss://HOST/ws/webchat?webchatId=wc_<32hex>&visitorId=v_<id>",
    connectWithoutQuery:
      "wss://HOST/ws/webchat — webchatId/visitorId can be sent on session.start frame",
    frames: {
      clientToServer: [
        "presence.bind",
        "session.start",
        "session.end",
        "message",
        "typing.started",
        "typing.stopped",
        "receipt.delivered",
        "receipt.read",
        "ping",
      ],
      serverToClient: [
        "presence.bound",
        "widget.popup",
        "session.ready",
        "session.ended",
        "message",
        "typing.started",
        "typing.stopped",
        "receipt.sent",
        "receipt.delivered",
        "receipt.read",
        "system",
      ],
    },
  };
}
