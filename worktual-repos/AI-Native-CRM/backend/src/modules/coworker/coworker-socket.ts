import type { Server as SocketIOServer, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import type { ExecutionIds } from "@/service/ai/execution-context";
import { agentTurnCommand } from "@/service/ai/coworker-agent-turn";
import { agentTrace } from "@/helpers/agent-trace";
import { runWithRequestContext } from "@/service/account/request-context";
import {
  SESSION_COOKIE_NAME,
  resolveUserIdFromSessionCookieRaw,
} from "@/service/account/session-cookie";

type SocketPayload = {
  messages?: Array<{ role: "assistant" | "user"; text: string }>;
  context?: {
    module?: string | null;
    surface?: string | null;
    entityId?: string | null;
    pathname?: string | null;
    draft?: Record<string, unknown> | null;
    sessionMemory?: Record<string, unknown> | null;
  };
  sessionMemory?: Record<string, unknown> | null;
  confirmTool?: { name?: string; args?: Record<string, unknown> } | null;
  conversationId?: string;
  runId?: string;
  traceId?: string;
  idempotencyKey?: string;
  traceparent?: string;
};

function readCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  const match = parts.find((p) => p.startsWith(`${name}=`));
  if (!match) return null;
  const raw = match.slice(name.length + 1);
  return raw ? decodeURIComponent(raw) : null;
}

function executionIdsFromPayload(payload: SocketPayload): ExecutionIds {
  const traceId =
    typeof payload.traceId === "string" && payload.traceId.trim()
      ? payload.traceId.trim()
      : randomUUID().replaceAll("-", "");

  const spanId = randomUUID().replaceAll("-", "").slice(0, 16);
  const flags = "01";
  const traceparent =
    typeof payload.traceparent === "string" && payload.traceparent.trim()
      ? payload.traceparent.trim().toLowerCase()
      : `00-${traceId}-${spanId}-${flags}`;

  const runId =
    typeof payload.runId === "string" && payload.runId.trim()
      ? payload.runId.trim()
      : `run-${randomUUID()}`;

  return {
    conversationId:
      typeof payload.conversationId === "string" && payload.conversationId.trim()
        ? payload.conversationId.trim()
        : `conversation-${randomUUID()}`,
    runId,
    traceId,
    idempotencyKey:
      typeof payload.idempotencyKey === "string" && payload.idempotencyKey.trim()
        ? payload.idempotencyKey.trim()
        : runId,
    traceparent,
  };
}

export function attachCoworkerSocket(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    socket.on(
      "coworker:agent-turn",
      async (payload: SocketPayload, ack: (result: unknown) => void) => {
        const turnStart = performance.now();
        const cookieHeader =
          typeof socket.handshake.headers.cookie === "string"
            ? socket.handshake.headers.cookie
            : undefined;

        const userId = await resolveUserIdFromSessionCookieRaw(
          readCookieValue(cookieHeader, SESSION_COOKIE_NAME),
        );

        if (!userId) {
          ack({ ok: false, error: "Unauthorized — please sign in again." });
          return;
        }

        const ids = executionIdsFromPayload(payload);
        const userText =
          payload.messages?.filter((m) => m.role === "user").slice(-1)[0]?.text ??
          "";

        agentTrace("coworker", {
          agent: "coworker-socket",
          step: "receive",
          user: userText.slice(0, 200),
          module: payload.context?.module ?? null,
          traceId: ids.traceId,
        });

        try {
          const result = await runWithRequestContext(
            { userId, apiKeyAuth: null },
            async () => {
              const confirmTool = payload.confirmTool?.name
                ? {
                    name: String(payload.confirmTool.name),
                    args: payload.confirmTool.args ?? {},
                  }
                : null;

              return agentTurnCommand({
                messages: payload.messages,
                context: payload.context,
                sessionMemory:
                  payload.sessionMemory ?? payload.context?.sessionMemory ?? null,
                confirmTool,
                execution: ids,
              });
            },
          );

          // Keep frontend transport contract stable: ok:false must include `error`.
          if (!result.ok && !result.error) {
            const assistantText =
              typeof result.assistantText === "string"
                ? result.assistantText
                : undefined;
            ack({
              ...result,
              error: assistantText ?? result.error ?? "Request failed",
              ...ids,
            });
            return;
          }

          agentTrace("coworker", {
            agent: "coworker-socket",
            step: "finish",
            ok: true,
            ms: Math.round(performance.now() - turnStart),
            traceId: ids.traceId,
          });
          ack({ ...result, ...ids });
        } catch (err) {
          agentTrace("coworker", {
            agent: "coworker-socket",
            step: "error",
            ok: false,
            ms: Math.round(performance.now() - turnStart),
            error: err instanceof Error ? err.message : "unknown",
            traceId: ids.traceId,
          });
          ack({
            ok: false,
            error: "AI service is temporarily unavailable. Please try again shortly.",
            ...ids,
          });
        }
      },
    );
  });
}

