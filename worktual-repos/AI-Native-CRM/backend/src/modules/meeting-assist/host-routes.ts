import type { FastifyPluginAsync } from "fastify";
import { isMeetingProvider } from "@/lib/meeting-provider";
import {
  listHostMeetingsForUser,
  resolveMeetCodeForHost,
  startAssistFromActivityForHost,
} from "@/service/meeting-assist/host-meetings";
import { resolveMeetingAssistUserId } from "@/service/meeting-assist/panel-auth";
import {
  meetingAssistPanelUrl,
  signMeetingAssistPanelToken,
} from "@/service/meeting-assist/panel-token";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError } from "../../helpers/response.js";

/**
 * Host linking APIs for Meet / Zoom / Teams side panels.
 * Prefix: /api/meeting-assist/hosts
 */
export const meetingAssistHostRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Issue a user-scoped panel token (no session yet).
   * Requires cookie session — used by Connect CRM popup.
   */
  app.post("/token", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;

    return withUser(
      userId,
      async () => {
        const organizationId = await getCurrentOrganizationId();
        const token = signMeetingAssistPanelToken({
          userId,
          organizationId,
          sessionId: null,
        });
        return sendSuccess(reply, {
          token,
          expiresAt: Date.now() + 8 * 60 * 60_000,
        });
      },
      request,
    );
  });

  /** List recent meetings for the connected host user. */
  app.get<{
    Querystring: { provider?: string; limit?: string };
  }>("/meetings", async (request, reply) => {
    const userId = await resolveMeetingAssistUserId(request);
    if (!userId) return sendError(reply, "Unauthorized", 401);

    const rawProvider = request.query.provider?.trim().toLowerCase();
    const provider =
      rawProvider && isMeetingProvider(rawProvider)
        ? rawProvider
        : rawProvider === "all"
          ? "all"
          : "all";
    const limit = Number(request.query.limit) || 12;

    return withUser(
      userId,
      async () => {
        const meetings = await listHostMeetingsForUser({
          userId,
          provider,
          limit,
        });
        return sendSuccess(reply, { meetings });
      },
      request,
    );
  });

  /** Start assist from a CRM meeting activity; returns session-scoped panel URL. */
  app.post<{
    Body: {
      activityId?: string;
      externalMeetingId?: string;
    };
  }>("/start", async (request, reply) => {
    const userId = await resolveMeetingAssistUserId(request);
    if (!userId) return sendError(reply, "Unauthorized", 401);

    const activityId = request.body?.activityId?.trim();
    if (!activityId) return sendError(reply, "activityId required", 400);

    return withUser(
      userId,
      async () => {
        const started = await startAssistFromActivityForHost({
          userId,
          activityId,
          externalMeetingId: request.body?.externalMeetingId,
        });
        if (!started.ok) return sendError(reply, started.error, 404);

        const organizationId = await getCurrentOrganizationId();
        const token = signMeetingAssistPanelToken({
          userId,
          organizationId,
          sessionId: started.sessionId,
        });
        return sendSuccess(reply, {
          ...started,
          token,
          panelUrl: meetingAssistPanelUrl(started.sessionId, token),
        });
      },
      request,
    );
  });

  /** Resolve a Google Meet code → CRM session + panel URL. */
  app.post<{
    Body: { meetCode?: string };
  }>("/meet/resolve", async (request, reply) => {
    const userId = await resolveMeetingAssistUserId(request);
    if (!userId) return sendError(reply, "Unauthorized", 401);

    const meetCode = request.body?.meetCode?.trim();
    if (!meetCode) return sendError(reply, "meetCode required", 400);

    return withUser(
      userId,
      async () => {
        const resolved = await resolveMeetCodeForHost({ userId, meetCode });
        if (!resolved.ok) return sendError(reply, resolved.error, 404);

        const organizationId = await getCurrentOrganizationId();
        const token = signMeetingAssistPanelToken({
          userId,
          organizationId,
          sessionId: resolved.sessionId,
        });
        return sendSuccess(reply, {
          ...resolved,
          token,
          panelUrl: meetingAssistPanelUrl(resolved.sessionId, token),
        });
      },
      request,
    );
  });
};
