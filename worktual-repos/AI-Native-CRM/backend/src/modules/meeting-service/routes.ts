import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "@/dao/db/prisma";
import {
  authenticateAccountUser,
  sessionUserFromSetupRow,
} from "@/service/account/auth-service";
import { getSetupUserByEmail, getSetupUserById } from "@/service/account/setup-users";
import {
  handleMeetingServiceAssistAsk,
  type MeetingServiceAssistAskBody,
} from "@/service/meeting-service/assist-ask";
import { handleMeetAssistBootstrap } from "@/service/meeting-service/meet-assist-bootstrap";
import { syncVexaLiveSegmentsForActivity, ingestMeetingServiceLiveCaption } from "@/service/meeting-service/vexa-live-assist-sync";
import {
  getLatestHeardForAssistSession,
  rememberAssistTimeZone,
} from "@/service/ai/meeting-assist";
import { forwardToMeetingService } from "@/service/meeting-service/forward-to-meeting-service";
import {
  meetingServiceBaseUrl,
  meetingServiceBotApiKey,
  meetingServiceUsersApiKey,
} from "@/service/meeting-service/config";
import { verifyMeetingServiceJwt } from "@/service/meeting-service/jwt";
import { executeAssistActionCommand } from "@/service/ai/execute-assist-action";
import { withUser } from "../../middlewares/auth.js";
import { sendError, sendSuccess } from "../../helpers/response.js";
import { logMeetAssistPanel } from "@/service/ai/meeting-assist-panel-log";
import { loadInternalRoster } from "@/service/ai/internal-meeting-roster";

function isMeetingServiceKeyAuthorized(request: FastifyRequest): boolean {
  const raw =
    request.headers["x-crm-users-key"] || request.headers["x-crm-bot-key"];
  const presented = (Array.isArray(raw) ? raw[0] : raw || "").trim();
  // Live captions are sent with CRM_BOT_API_KEY. User lookup uses
  // CRM_USERS_API_KEY. Those two values differ on the server, so either match
  // must be accepted or speech-to-text text is rejected with 401.
  const accepted = [meetingServiceBotApiKey(), meetingServiceUsersApiKey()].filter(
    (key) => key.length > 0,
  );
  if (accepted.length === 0) return process.env.NODE_ENV !== "production";
  return accepted.includes(presented);
}

function bearerToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

/**
 * A CRM user's login email (`setup_users.work_email`) can differ from the
 * Google account they actually connect/sign in with for Meet Assist (e.g. a
 * work_email like `first.last@company.com` vs a personal Gmail used for
 * Calendar OAuth). Resolving `/v1/users/by-email` off the literal work_email
 * alone can then match a completely unrelated CRM user (possibly a different
 * org) who happens to have registered with that same address as their
 * work_email — silently binding the Meet session to the wrong tenant.
 * Prefer the CRM user whose connected Google account matches this email.
 */
async function findUserIdByConnectedGoogleEmail(
  email: string,
): Promise<string | null> {
  const row = await prisma.userIntegrationConnection.findFirst({
    where: { provider: "google", accountEmail: { equals: email, mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
    select: { userId: true },
  });
  return row ? String(row.userId) : null;
}

async function connectedGoogleEmailForUser(
  userId: string,
): Promise<string | null> {
  let uid: bigint;
  try {
    uid = BigInt(userId);
  } catch {
    return null;
  }
  const row = await prisma.userIntegrationConnection.findFirst({
    where: { userId: uid, provider: "google" },
    orderBy: { updatedAt: "desc" },
    select: { accountEmail: true },
  });
  const email = row?.accountEmail?.trim().toLowerCase();
  return email || null;
}

/**
 * Public contract for meeting-service (Meet add-on + bot proxy).
 * Mounted at /v1 — not under /api.
 */
export const meetingServicePublicRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { email?: string } }>(
    "/users/by-email",
    async (request, reply) => {
      if (!isMeetingServiceKeyAuthorized(request)) {
        return sendError(reply, "Unauthorized", 401);
      }
      const email = request.query.email?.trim().toLowerCase() || "";
      if (!email) {
        return sendError(reply, "email required", 422);
      }
      const connectedUserId = await findUserIdByConnectedGoogleEmail(email);
      const row =
        (connectedUserId ? await getSetupUserById(connectedUserId) : null) ??
        (await getSetupUserByEmail(email));
      if (!row) {
        return sendError(reply, "not a CRM user", 404);
      }
      const user = sessionUserFromSetupRow(row);
      if (!user) {
        return sendError(reply, "not a CRM user", 403);
      }
      const connectedGoogleEmail = await connectedGoogleEmailForUser(
        String(user.id),
      );
      return reply.send({
        organization_id: String(user.organizationId),
        sub: String(user.id),
        email: user.email,
        scopes: ["meetings:write"],
        connected_google_email: connectedGoogleEmail,
      });
    },
  );

  /**
   * Password check for the Meet panel only. Does not create a CRM browser
   * session, so signing into Sales Assist cannot replace an open CRM login.
   */
  app.post<{ Body: { email?: string; password?: string } }>(
    "/users/verify-login",
    async (request, reply) => {
      if (!isMeetingServiceKeyAuthorized(request)) {
        return sendError(reply, "Unauthorized", 401);
      }
      const email = request.body?.email?.trim().toLowerCase() || "";
      const password = request.body?.password ?? "";
      if (!email || !password) {
        return sendError(reply, "Email and password are required.", 422);
      }
      const result = await authenticateAccountUser({ email, password });
      if (!result.ok) {
        return sendError(reply, "Invalid email or password.", 401);
      }
      const connectedGoogleEmail = await connectedGoogleEmailForUser(
        String(result.user.id),
      );
      return reply.send({
        organization_id: String(result.user.organizationId),
        sub: String(result.user.id),
        email: result.user.email,
        scopes: ["meetings:write"],
        connected_google_email: connectedGoogleEmail,
      });
    },
  );

  app.post<{ Body: { meeting_url?: string; time_zone?: string } }>(
    "/assist/meet-bootstrap",
    async (request, reply) => {
      const token = bearerToken(request);
      const jwt = verifyMeetingServiceJwt(token);
      if (!jwt) {
        return sendError(reply, "Unauthorized", 401);
      }
      const meetingUrl = (request.body?.meeting_url || "").trim();
      const result = await handleMeetAssistBootstrap({
        organizationId: jwt.organization_id,
        userId: jwt.sub,
        meetingUrl,
        hostMeetName: jwt.name,
        hostEmail: jwt.email,
        hostGoogleSub: jwt.google_sub,
        timeZone: request.body?.time_zone,
      });
      if (!result.ok) {
        return sendError(reply, result.error, result.status);
      }
      return reply.send({
        session_id: result.sessionId,
        activity_id: result.activityId,
        panel_token: result.panelToken,
        events_path: result.eventsPath,
        segments_synced: result.segmentsSynced,
        last_heard: result.lastHeard,
        last_suggestions: result.lastSuggestions,
        meeting_kind: result.meetingKind,
        contact_id: result.contactId,
        contact_name: result.contactName,
        contact_card: result.contactCard,
        chat_history: result.chatHistory,
        customer_pool: result.customerPool,
      });
    },
  );

  app.post<{
    Body: {
      meeting_url?: string;
      time_zone?: string;
      action?: unknown;
    };
  }>("/assist/execute-action", async (request, reply) => {
    const token = bearerToken(request);
    const jwt = verifyMeetingServiceJwt(token);
    if (!jwt) {
      return sendError(reply, "Unauthorized", 401);
    }
    const result = await withUser(
      jwt.sub,
      () =>
        executeAssistActionCommand({
          organizationId: jwt.organization_id,
          userId: jwt.sub,
          meetingUrl: request.body?.meeting_url,
          timeZone: request.body?.time_zone,
          action: request.body?.action,
        }),
      request,
    );
    if (!result.ok) {
      return sendError(reply, result.error, result.status);
    }
    return reply.send(result);
  });

  app.post<{ Body: { meeting_url?: string; activity_id?: string; time_zone?: string } }>(
    "/assist/sync-live",
    async (request, reply) => {
      const token = bearerToken(request);
      const jwt = verifyMeetingServiceJwt(token);
      if (!jwt) {
        return sendError(reply, "Unauthorized", 401);
      }
      const activityId = (request.body?.activity_id || "").trim();
      let targetActivityId = activityId;
      if (!targetActivityId) {
        const meetingUrl = (request.body?.meeting_url || "").trim();
        const { resolveAssistSessionForMeetUrl } = await import(
          "@/service/meeting-service/meet-assist-bootstrap"
        );
        const hit = await resolveAssistSessionForMeetUrl({
          organizationId: jwt.organization_id,
          meetingUrl,
        });
        if (!hit) {
          return sendError(reply, "No assist session for this meeting", 404);
        }
        targetActivityId = hit.activityId;
      }
      const sync = await syncVexaLiveSegmentsForActivity(targetActivityId);
      const session = await prisma.meetingAssistSession.findFirst({
        where: { activityId: targetActivityId },
        orderBy: { updatedAt: "desc" },
        select: { id: true, lastSuggestions: true },
      });
      if (session?.id) {
        await rememberAssistTimeZone(session.id, request.body?.time_zone);
      }
      const roster = session?.id
        ? await loadInternalRoster(session.id).catch(() => null)
        : null;
      const meetingKind = roster?.kind === "internal" ? "internal" : "customer";
      const lastHeard =
        session?.id && meetingKind !== "internal"
          ? await getLatestHeardForAssistSession(session.id)
          : null;
      logMeetAssistPanel("sync_live", {
        activityId: targetActivityId,
        sessionId: session?.id ?? null,
        inserted: sync.inserted,
        skipped: sync.skipped ?? null,
        lastHeardPreview: lastHeard?.text?.slice(0, 80) ?? null,
        hasLastSuggestions: Boolean(session?.lastSuggestions),
      });
      return reply.send({
        inserted: sync.inserted,
        skipped: sync.skipped || null,
        last_heard: lastHeard,
        last_suggestions:
          meetingKind === "internal" ? null : session?.lastSuggestions ?? null,
        meeting_kind: meetingKind,
      });
    },
  );

  app.post<{
    Body: {
      meeting_id?: string;
      organization_id?: string;
      segment_id?: string;
      speaker?: string;
      speaker_key?: string;
      text?: string;
      completed?: boolean;
      latency?: unknown;
      speech_started_at?: string;
    };
  }>("/assist/live-caption", async (request, reply) => {
    const token = bearerToken(request);
    const jwt = token ? verifyMeetingServiceJwt(token) : null;
    const botKeyOk = isMeetingServiceKeyAuthorized(request);
    if (!jwt && !botKeyOk) {
      return sendError(reply, "Unauthorized", 401);
    }
    const meetingId = (request.body?.meeting_id || "").trim();
    const text = (request.body?.text || "").trim();
    if (!meetingId || !text) {
      return sendError(reply, "meeting_id and text required", 400);
    }
    const organizationId =
      jwt?.organization_id || (request.body?.organization_id || "").trim() || null;
    const result = await ingestMeetingServiceLiveCaption({
      meetingId,
      organizationId,
      segmentId: request.body?.segment_id,
      speaker: request.body?.speaker,
      speakerKey: request.body?.speaker_key,
      text,
      completed: Boolean(request.body?.completed),
      latency: request.body?.latency,
      speechStartedAt: request.body?.speech_started_at,
    });
    if (!result.ok) {
      return sendError(reply, result.error, 404);
    }
    return reply.send(result);
  });

  app.post<{ Body: MeetingServiceAssistAskBody & { meeting_url?: string } }>(
    "/assist/ask",
    async (request, reply) => {
      const meetingUrl = (request.body as { meeting_url?: string } | undefined)
        ?.meeting_url?.trim();
      if (meetingUrl && meetingServiceBaseUrl()) {
        return forwardToMeetingService(request, reply);
      }
      const token = bearerToken(request);
      const jwt = verifyMeetingServiceJwt(token);
      if (!jwt) {
        return sendError(reply, "Unauthorized", 401);
      }
      const body = request.body ?? ({} as MeetingServiceAssistAskBody);
      if (body.organization_id && body.organization_id !== jwt.organization_id) {
        return sendError(reply, "organization mismatch", 403);
      }
      const result = await handleMeetingServiceAssistAsk(
        {
          ...body,
          organization_id: jwt.organization_id,
        },
        jwt.sub,
      );
      return reply.send(result);
    },
  );
};
