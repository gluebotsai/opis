import type { FastifyRequest } from "fastify";
import { resolveSessionUserId } from "../../middlewares/auth.js";
import {
  verifyMeetingAssistPanelToken,
  type MeetingAssistPanelTokenPayload,
} from "@/service/meeting-assist/panel-token";

/**
 * Resolve CRM user for meeting-assist APIs:
 * 1. Panel / host JWT (header or ?token=) — iframe-safe
 * 2. Session cookie
 */
export function readPanelTokenFromRequest(
  request: FastifyRequest,
): string | null {
  const header =
    (request.headers["x-meeting-assist-panel-token"] as string | undefined) ||
    (request.headers["x-meet-addon-token"] as string | undefined) ||
    null;
  if (header?.trim()) return header.trim();

  const auth = request.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const bearer = auth.slice(7).trim();
    if (bearer) return bearer;
  }

  const q = (request.query as { token?: string } | undefined)?.token;
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

export function verifyPanelTokenForSession(
  request: FastifyRequest,
  sessionId?: string | null,
): MeetingAssistPanelTokenPayload | null {
  const raw = readPanelTokenFromRequest(request);
  const payload = verifyMeetingAssistPanelToken(raw);
  if (!payload) return null;
  if (
    sessionId &&
    payload.sessionId &&
    payload.sessionId !== sessionId
  ) {
    return null;
  }
  return payload;
}

/** Cookie user id, or panel-token user id (optionally scoped to session). */
export async function resolveMeetingAssistUserId(
  request: FastifyRequest,
  sessionId?: string | null,
): Promise<string | null> {
  const fromPanel = verifyPanelTokenForSession(request, sessionId);
  if (fromPanel?.userId) return fromPanel.userId;
  return resolveSessionUserId(request);
}
