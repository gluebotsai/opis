import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { updateMediaAssistStatus } from "@/service/meeting-assist/meet-media";
import { sendError, sendSuccess } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";

function isInternalAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.MEET_MEDIA_WORKER_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers["x-internal-secret"] === secret;
}

/**
 * Internal Meet Media worker → CRM status updates.
 * Prefix: /api/internal/meeting-assist
 */
export const internalMeetingAssistRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  app.post<{
    Params: { sessionId: string };
    Body: {
      status?: string;
      error?: string | null;
      traceId?: string | null;
    };
  }>("/sessions/:sessionId/media-status", async (request, reply) => {
    const status = (request.body?.status || "idle") as
      | "idle"
      | "starting"
      | "connecting"
      | "listening"
      | "error"
      | "stopped";
    await updateMediaAssistStatus({
      sessionId: request.params.sessionId,
      status,
      error: request.body?.error,
      traceId: request.body?.traceId,
    });
    return sendSuccess(reply, { ok: true });
  });
};
