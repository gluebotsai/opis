import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { RESPONSE } from "../../helpers/constants.js";
import { sendError, sendSuccess, sendResult } from "../../helpers/response.js";
import { requireSession, withUser } from "../../middlewares/auth.js";
import {
  getAgentPresence,
  initializeAgentPresence,
  setAgentPresence,
  startAgentPresenceSubscriber,
  subscribeAgentPresence,
} from "../../service/voice/agent-presence.js";
import {
  askCallTranscript,
  endCallTranscriptSession,
  executeCallAssistAction,
  getCallActivityTranscript,
  getCallTranscriptSnapshot,
  startCallTranscriptSession,
  startCallTranscriptSubscriber,
  subscribeCallTranscript,
} from "../../service/voice/call-transcript.js";
import { buildSipUaSession } from "../../service/voice/sip-session.js";
import {
  getSipCredentialSession,
  restoreSipRegistrarPayload,
} from "../../service/voice/sip-registration.js";

function presenceErrorStatus(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return 500;
}

function sendPresenceError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
) {
  const status = presenceErrorStatus(error);
  const message = error instanceof Error ? error.message : "Presence update failed";
  if (status >= 500) {
    request.log.error({ err: error }, "presence failed");
    return sendError(reply, "Presence update failed", status);
  }
  return sendError(reply, message, status);
}

function callErrorStatus(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return 500;
}

function sendCallError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const status = callErrorStatus(error);
  const message = error instanceof Error ? error.message : "Call assist failed";
  if (status >= 500) {
    request.log.error({ err: error }, "call assist failed");
    return sendError(reply, "Call assist failed", status);
  }
  return sendError(reply, message, status);
}

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  startAgentPresenceSubscriber();
  startCallTranscriptSubscriber();
  app.get("/sip/session", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;

    const session = await withUser(userId, () => getSipCredentialSession(userId), request);
    if (!session) {
      return sendError(reply, "SIP credentials are not configured for this user", 404);
    }
    return sendSuccess(reply, buildSipUaSession(session), RESPONSE.fetched);
  });

  app.post("/sip/session/restore", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;

    await withUser(userId, () => restoreSipRegistrarPayload(userId), request);
    const session = await withUser(userId, () => getSipCredentialSession(userId), request);
    if (!session) {
      return sendError(reply, "SIP credentials are not configured for this user", 404);
    }
    return sendSuccess(
      reply,
      { redisKey: session.redisKey, redisRegistered: session.redisRegistered },
      RESPONSE.updated,
    );
  });

  app.get("/voice/presence", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    const presence = await withUser(userId, () => getAgentPresence(userId), request);
    return sendSuccess(reply, { presence }, RESPONSE.fetched);
  });

  app.post("/voice/presence/initialize", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    try {
      const presence = await withUser(userId, () => initializeAgentPresence(userId), request);
      return sendSuccess(reply, { presence }, RESPONSE.updated);
    } catch (error) {
      return sendPresenceError(request, reply, error);
    }
  });

  app.post<{ Body: { state?: string; source?: string } }>("/voice/presence", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    try {
      const state = request.body?.state?.trim() ?? "";
      const source = request.body?.source === "voice" ? "voice" : "toolbar";
      const presence = await withUser(
        userId,
        () => setAgentPresence(userId, state, source),
        request,
      );
      return sendSuccess(reply, { presence }, RESPONSE.updated);
    } catch (error) {
      return sendPresenceError(request, reply, error);
    }
  });

  app.get("/voice/presence/events", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    reply.hijack();

    let closed = false;
    const send = (event: string, data: unknown) => {
      if (closed) return;
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(deadline);
      unsub();
      try {
        reply.raw.end();
      } catch {
        /* already closed */
      }
    };

    const unsub = subscribeAgentPresence(userId, (presence) => {
      send("presence", presence);
    });

    send("ready", { userId });
    const current = await getAgentPresence(userId).catch(() => null);
    if (current?.confirmed) send("presence", current);
    const heartbeat = setInterval(() => send("ping", Date.now()), 25_000);
    const deadline = setTimeout(close, 10 * 60_000);
    request.raw.on("close", close);
  });

  app.post<{
    Body: {
      remoteNumber?: string;
      direction?: string;
      connectedAt?: number;
      timeZone?: string;
    };
  }>("/voice/calls/start", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    const remoteNumber = request.body?.remoteNumber?.trim() ?? "";
    const direction = request.body?.direction === "inbound" ? "inbound" : "outbound";
    const connectedAt =
      typeof request.body?.connectedAt === "number" ? request.body.connectedAt : null;
    if (!remoteNumber) return sendError(reply, "A connected number is required", 400);
    try {
      const result = await withUser(
        userId,
        () =>
          startCallTranscriptSession({
            userId,
            remoteNumber,
            direction,
            connectedAt,
            timeZone: request.body?.timeZone,
          }),
        request,
      );
      return sendSuccess(reply, result, result.open ? RESPONSE.created : RESPONSE.fetched);
    } catch (error) {
      return sendCallError(request, reply, error);
    }
  });

  app.get<{ Params: { sessionId: string } }>(
    "/voice/calls/:sessionId/events",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) return sendError(reply, "Call session is required", 400);

      const snapshot = await withUser(
        userId,
        () => getCallTranscriptSnapshot(sessionId, userId),
        request,
      );
      if (!snapshot) return sendError(reply, "Call assist session not found", 404);

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      reply.hijack();

      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        unsub();
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      };

      const unsub = subscribeCallTranscript(sessionId, (event) => {
        send(event.type, event);
      });
      send("snapshot", snapshot);
      if (snapshot.status === "ended") {
        send("ended", { type: "ended", activityId: snapshot.activityId });
      }
      const heartbeat = setInterval(() => send("ping", Date.now()), 25_000);
      const deadline = setTimeout(close, 2 * 60 * 60_000);
      reply.raw.on("close", close);
    },
  );

  app.post<{ Params: { sessionId: string }; Body: { query?: string; timeZone?: string } }>(
    "/voice/calls/:sessionId/ask",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      const sessionId = request.params.sessionId?.trim();
      const query = request.body?.query?.trim() ?? "";
      if (!sessionId) return sendError(reply, "Call session is required", 400);
      try {
        const result = await withUser(
          userId,
          () => askCallTranscript(sessionId, userId, query, request.body?.timeZone),
          request,
        );
        return sendSuccess(reply, { result }, RESPONSE.updated);
      } catch (error) {
        return sendCallError(request, reply, error);
      }
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: { action?: unknown; timeZone?: string };
  }>("/voice/calls/:sessionId/execute-action", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    const sessionId = request.params.sessionId?.trim();
    if (!sessionId) return sendError(reply, "Call session is required", 400);
    try {
      const result = await withUser(
        userId,
        () =>
          executeCallAssistAction(
            sessionId,
            userId,
            request.body?.action,
            request.body?.timeZone,
          ),
        request,
      );
      return sendResult(reply, result);
    } catch (error) {
      return sendCallError(request, reply, error);
    }
  });

  app.post<{ Params: { sessionId: string }; Body: { reason?: string } }>(
    "/voice/calls/:sessionId/end",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) return sendError(reply, "Call session is required", 400);
      const reason =
        request.body?.reason === "remote_bye" || request.body?.reason === "failed"
          ? request.body.reason
          : "hangup";
      try {
        const result = await withUser(
          userId,
          () => endCallTranscriptSession(sessionId, userId, reason),
          request,
        );
        return sendSuccess(reply, result, RESPONSE.updated);
      } catch (error) {
        return sendCallError(request, reply, error);
      }
    },
  );

  app.get<{ Params: { activityId: string } }>(
    "/voice/calls/by-activity/:activityId",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      const activityId = request.params.activityId?.trim();
      if (!activityId) return sendError(reply, "Call activity is required", 400);
      try {
        const result = await withUser(
          userId,
          () => getCallActivityTranscript(activityId),
          request,
        );
        if (!result) return sendError(reply, "Call activity not found", 404);
        return sendSuccess(reply, result, RESPONSE.fetched);
      } catch (error) {
        return sendCallError(request, reply, error);
      }
    },
  );
};
