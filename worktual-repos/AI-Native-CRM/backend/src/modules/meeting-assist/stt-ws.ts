/**
 * Streaming STT WebSocket — disabled for Assist coaching.
 * Chrome mic cannot isolate the customer; use Meet caption webhooks instead.
 */

import type { FastifyPluginAsync } from "fastify";
import websocket from "@fastify/websocket";
import { resolveMeetingAssistUserId } from "@/service/meeting-assist/panel-auth";

function sendJson(socket: { send: (data: string) => void }, payload: unknown) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    /* closed */
  }
}

export const meetingAssistSttWsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(websocket);

  app.get<{
    Params: { sessionId: string };
    Querystring: { token?: string };
  }>("/:sessionId/stt/stream", { websocket: true }, async (socket, request) => {
    const sessionId = request.params.sessionId;
    const userId = await resolveMeetingAssistUserId(request, sessionId);
    if (!userId) {
      sendJson(socket, { type: "error", error: "Unauthorized" });
      socket.close();
      return;
    }

    sendJson(socket, {
      type: "error",
      error:
        "Chrome microphone STT is disabled for Assist. Use Meet captions / transcript webhooks with speaker labels, or Ask in the panel.",
    });
    socket.close();
  });
};
