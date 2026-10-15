import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  appendMeetingAssistChunksCommand,
  finalizeMeetingAssistCommand,
  getMeetingAssistForActivityCommand,
  getMeetingAssistSessionCommand,
  runMeetingAssistCommand,
  startMeetingAssistCommand,
} from "@/service/ai/meeting-assist-commands";
import {
  getLatestHeardForAssistSession,
  getMeetingAssistSession,
} from "@/service/ai/meeting-assist";
import { subscribeMeetingAssistEvents } from "@/service/ai/meeting-assist-events";
import { resolveMeetingAssistUserId } from "@/service/meeting-assist/panel-auth";
import {
  meetingAssistPanelUrl,
  signMeetingAssistPanelToken,
} from "@/service/meeting-assist/panel-token";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import {
  getMeetMediaAssistStatus,
  stopMeetMediaAssist,
} from "@/service/meeting-assist/meet-media";
import { startLiveCustomerAssist } from "@/service/meeting-assist/live-assist";
import { registerMeetingAssistViewer } from "@/service/meeting-assist/active-viewers";
import { logMeetAssistPanel } from "@/service/ai/meeting-assist-panel-log";
import { loadAssistLiveContext } from "@/service/ai/meeting-assist-live-context";
import { loadInternalRoster } from "@/service/ai/internal-meeting-roster";
import {
  assignChannelCustomerSide,
  assignChannelEmail,
} from "@/service/ai/meeting-attendee-lock";
import type { AttendeePerson } from "@/lib/meeting-attendee-identity";
import { isMeetAssistBrowserOrigin } from "@/service/meeting-service/config";
import { executeAssistActionCommand } from "@/service/ai/execute-assist-action";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";

const HEARTBEAT_MS = 20_000;
const MAX_WAIT_MS = 4 * 60 * 60_000;

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Providers (Zoom / Teams webhooks) push transcript chunks or trigger
 * finalize without a signed-in browser session — mirrors
 * isInternalAgentAuthorized() in backend/src/service/ai/internal-auth.ts.
 */
function isInternalAssistAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers["x-internal-secret"] === secret;
}

async function requireAssistUser(
  request: FastifyRequest,
  reply: Parameters<typeof sendError>[0],
  sessionId?: string,
): Promise<string | null> {
  const userId = await resolveMeetingAssistUserId(request, sessionId);
  if (!userId) {
    await sendError(reply, "Unauthorized", 401);
    return null;
  }
  return userId;
}

export const meetingAssistRoutes: FastifyPluginAsync = async (app) => {
  /** Start (or resume) a meeting assist session for a meeting activity. */
  app.post<{
    Body: {
      activityId?: string;
      provider?: string;
      externalMeetingId?: string;
      joinUrl?: string;
    };
  }>("/", async (request, reply) => {
    const userId = await requireAssistUser(request, reply);
    if (!userId) return;

    const body = request.body ?? {};
    if (!body.activityId?.trim()) {
      return sendError(reply, "activityId required", 400);
    }

    return withUser(
      userId,
      async () => {
        const result = await startMeetingAssistCommand({
          activityId: body.activityId!.trim(),
          provider: body.provider,
          externalMeetingId: body.externalMeetingId,
          joinUrl: body.joinUrl,
        });
        if (!result.ok) return sendResult(reply, result, 404);
        return sendSuccess(reply, { sessionId: result.sessionId });
      },
      request,
    );
  });

  /**
   * Issue a short-lived panel JWT for iframes / deep links.
   * Cookie session required (Connect CRM popup or CRM UI).
   */
  app.post<{
    Params: { sessionId: string };
  }>("/:sessionId/panel-token", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;

    return withUser(
      userId,
      async () => {
        const session = await getMeetingAssistSession(request.params.sessionId);
        if (!session) return sendError(reply, "Not found", 404);

        const organizationId = await getCurrentOrganizationId();
        const token = signMeetingAssistPanelToken({
          userId,
          organizationId,
          sessionId: session.id,
        });
        return sendSuccess(reply, {
          token,
          panelUrl: meetingAssistPanelUrl(session.id, token),
          expiresAt: Date.now() + 8 * 60 * 60_000,
        });
      },
      request,
    );
  });

  /** Optional: look up an existing session by its meeting activity id. */
  app.get<{ Params: { activityId: string } }>(
    "/activity/:activityId",
    async (request, reply) => {
      const userId = await requireAssistUser(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const session = await getMeetingAssistForActivityCommand(
            request.params.activityId,
          );
          if (!session) return sendError(reply, "Not found", 404);
          return session;
        },
        request,
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/:sessionId",
    async (request, reply) => {
      const userId = await requireAssistUser(
        request,
        reply,
        request.params.sessionId,
      );
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const session = await getMeetingAssistSessionCommand(
            request.params.sessionId,
          );
          if (!session) return sendError(reply, "Not found", 404);
          return session;
        },
        request,
      );
    },
  );

  /**
   * Lock the current microphone to a known email on this meeting.
   * `email` picks from the meeting's bounded customer pool (contact plus
   * any external guest emails) — required whenever more than one customer
   * is on the call; optional (falls back to the single customer) for the
   * common 1:1 case so older clients keep working unchanged.
   */
  app.post<{
    Params: { sessionId: string };
    Body: {
      speakerKey?: string;
      speaker_key?: string;
      email?: string;
      customerSideGuest?: boolean;
      displayName?: string;
    };
  }>("/:sessionId/channel-email", async (request, reply) => {
    const userId = await requireAssistUser(request, reply, request.params.sessionId);
    if (!userId) return;
    const speakerKey = (request.body?.speakerKey || request.body?.speaker_key || "").trim();
    if (!speakerKey) return sendError(reply, "speakerKey is required", 422);
    const requestedEmail = (request.body?.email || "").trim().toLowerCase();
    return withUser(
      userId,
      async () => {
        if (request.body?.customerSideGuest === true) {
          const lock = await assignChannelCustomerSide({
            sessionId: request.params.sessionId,
            speakerKey,
            displayName: request.body?.displayName,
          });
          if (!lock) return sendError(reply, "Could not map this channel.", 422);
          return { ok: true, channel: lock };
        }
        const ctx = await loadAssistLiveContext(request.params.sessionId);
        if (!ctx) return sendError(reply, "Not found", 404);
        const customers = ctx.people.filter((person) => person.role === "customer");
        let target: AttendeePerson | null = customers[0] ?? null;
        if (requestedEmail) {
          target = customers.find((person) => person.email === requestedEmail) ?? null;
          if (!target) {
            return sendError(
              reply,
              "That email is not one of this meeting's customer emails.",
              422,
            );
          }
        } else if (customers.length !== 1) {
          return sendError(
            reply,
            "This meeting has more than one customer email — pick one.",
            422,
          );
        }
        const lock = await assignChannelEmail({
          sessionId: request.params.sessionId,
          speakerKey,
          email: target!.email,
          people: ctx.people,
        });
        if (!lock) return sendError(reply, "Could not map this channel.", 422);
        return { ok: true, channel: lock };
      },
      request,
    );
  });

  /** Bounded picker options — the customer pool for "mark this channel as". */
  app.get<{ Params: { sessionId: string } }>(
    "/:sessionId/customer-pool",
    async (request, reply) => {
      const userId = await requireAssistUser(request, reply, request.params.sessionId);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const ctx = await loadAssistLiveContext(request.params.sessionId);
          if (!ctx) return sendError(reply, "Not found", 404);
          return sendSuccess(reply, { customerPool: ctx.customerPool });
        },
        request,
      );
    },
  );

  /**
   * Append live / provider transcript chunks.
   * Auth: signed-in user, panel JWT, OR internal secret (provider webhooks).
   */
  app.post<{
    Params: { sessionId: string };
    Body: {
      chunks?: Array<{
        text?: string;
        speaker?: string | null;
        spokenAt?: string | null;
        source?: string | null;
        seq?: number | null;
      }>;
      text?: string;
      speaker?: string | null;
      source?: string | null;
    };
  }>("/:sessionId/chunks", async (request, reply) => {
    const userId = await resolveMeetingAssistUserId(
      request,
      request.params.sessionId,
    );
    const internal = isInternalAssistAuthorized(request);
    if (!userId && !internal) {
      return sendError(reply, "Unauthorized", 401);
    }

    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const chunks =
          Array.isArray(body.chunks) && body.chunks.length > 0
            ? body.chunks
            : body.text
              ? [{ text: body.text, speaker: body.speaker, source: body.source }]
              : [];

        if (chunks.length === 0) {
          return sendError(reply, "No chunks", 400);
        }

        const result = await appendMeetingAssistChunksCommand({
          sessionId: request.params.sessionId,
          chunks: chunks.map((c) => ({
            text: c.text || "",
            speaker: c.speaker,
            spokenAt: c.spokenAt,
            source: c.source || (internal ? "provider" : "live_push"),
            seq: c.seq,
          })),
        });

        return sendResult(reply, result);
      },
      request,
    );
  });

  /**
   * Chrome-mic STT is disabled for Assist coaching — browser mic cannot
   * isolate the customer from the sales rep / room audio.
   */
  app.post<{
    Params: { sessionId: string };
    Body: {
      audioBase64?: string;
      mimeType?: string;
      filename?: string;
      speaker?: string | null;
    };
  }>("/:sessionId/stt", async (request, reply) => {
    const userId = await resolveMeetingAssistUserId(
      request,
      request.params.sessionId,
    );
    if (!userId) return sendError(reply, "Unauthorized", 401);

    return sendError(
      reply,
      "Chrome microphone STT is disabled for Assist. Use live Assist (meeting bot / Meet Media) or Ask in the panel.",
      410,
    );
  });

  app.post<{
    Params: { sessionId: string };
    Body: { action?: unknown; timeZone?: string };
  }>("/:sessionId/execute-action", async (request, reply) => {
    const userId = await resolveMeetingAssistUserId(
      request,
      request.params.sessionId,
    );
    if (!userId) return sendError(reply, "Unauthorized", 401);
    return withUser(
      userId,
      async () => {
        let organizationId: string;
        try {
          organizationId = await getCurrentOrganizationId();
        } catch {
          return sendError(reply, "Unauthorized", 401);
        }
        const result = await executeAssistActionCommand({
          organizationId,
          userId,
          sessionId: request.params.sessionId,
          timeZone: request.body?.timeZone,
          action: request.body?.action,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  /** Start live customer transcript (meeting bot by default, or Meet Media). */
  app.post<{ Params: { sessionId: string } }>(
    "/:sessionId/media/start",
    async (request, reply) => {
      const userId = await resolveMeetingAssistUserId(
        request,
        request.params.sessionId,
      );
      if (!userId) return sendError(reply, "Unauthorized", 401);
      return withUser(
        userId,
        async () => {
          const result = await startLiveCustomerAssist(
            request.params.sessionId,
          );
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    "/:sessionId/media/stop",
    async (request, reply) => {
      const userId = await resolveMeetingAssistUserId(
        request,
        request.params.sessionId,
      );
      if (!userId) return sendError(reply, "Unauthorized", 401);
      return withUser(
        userId,
        async () => {
          const result = await stopMeetMediaAssist(request.params.sessionId);
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/:sessionId/media/status",
    async (request, reply) => {
      const userId = await resolveMeetingAssistUserId(
        request,
        request.params.sessionId,
      );
      if (!userId) return sendError(reply, "Unauthorized", 401);
      return withUser(
        userId,
        async () => {
          const result = await getMeetMediaAssistStatus(
            request.params.sessionId,
          );
          return sendSuccess(reply, result);
        },
        request,
      );
    },
  );

  /** Run KB-backed meeting assist against the current transcript window. */
  app.post<{
    Params: { sessionId: string };
    Body: { query?: string; mode?: string; timeZone?: string };
  }>("/:sessionId/assist", async (request, reply) => {
    const userId = await requireAssistUser(
      request,
      reply,
      request.params.sessionId,
    );
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const result = await runMeetingAssistCommand({
          sessionId: request.params.sessionId,
          query: body.query,
          mode: body.mode,
          timeZone: body.timeZone,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  /** Roll up chunks → ContactActivity.transcriptText and end the session. */
  app.post<{
    Params: { sessionId: string };
    Body: { source?: string };
  }>("/:sessionId/finalize", async (request, reply) => {
    const userId = await resolveMeetingAssistUserId(
      request,
      request.params.sessionId,
    );
    const internal = isInternalAssistAuthorized(request);
    if (!userId && !internal) {
      return sendError(reply, "Unauthorized", 401);
    }

    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const result = await finalizeMeetingAssistCommand({
          sessionId: request.params.sessionId,
          source: body.source,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  /** Live SSE — transcript chunks + auto KB assist suggestions. */
  app.get<{ Params: { sessionId: string } }>(
    "/:sessionId/events",
    async (request, reply) => {
      const userId = await resolveMeetingAssistUserId(
        request,
        request.params.sessionId,
      );
      if (!userId) {
        return sendError(reply, "Unauthorized", 401);
      }

      const { sessionId } = request.params;
      const session = await withUser(
        userId,
        () => getMeetingAssistSession(sessionId),
        request,
      );
      if (!session) {
        return sendError(reply, "Not found", 404);
      }

      const origin = String(request.headers.origin || "").trim();
      const allowOrigin = origin && isMeetAssistBrowserOrigin(origin);

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...(allowOrigin
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Credentials": "true",
              Vary: "Origin",
            }
          : {}),
      });
      reply.hijack();

      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          reply.raw.write(sseLine(event, data));
        } catch {
          closed = true;
        }
      };

      const unregisterViewer = registerMeetingAssistViewer(sessionId, userId);
      const { replayPendingAssistForSession } = await import(
        "@/service/ai/meeting-assist-auto"
      );
      const roster = await loadInternalRoster(sessionId).catch(() => null);
      const meetingKind = roster?.kind === "internal" ? "internal" : "customer";
      if (meetingKind !== "internal") {
        void replayPendingAssistForSession(sessionId, userId);
      }

      const close = () => {
        if (closed) return;
        closed = true;
        unregisterViewer();
        clearInterval(heartbeat);
        clearTimeout(deadline);
        unsub();
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      };

      const lastHeard = await getLatestHeardForAssistSession(sessionId);
      logMeetAssistPanel("sse_connected", {
        sessionId,
        userId,
        lastHeardPreview: lastHeard?.text?.slice(0, 80) ?? null,
        hasLastSuggestions: Boolean(session.lastSuggestions),
      });
      send("ready", {
        sessionId,
        status: session.status,
        meetingKind,
        lastSuggestions: meetingKind === "internal" ? null : session.lastSuggestions,
        lastHeard: meetingKind === "internal" ? null : lastHeard,
      });

      // Per-viewer isolation: this connection always gets the shared
      // broadcast (today's single-panel behavior), plus its own resolved
      // viewer channel so a future targeted publish reaches only this
      // viewer — never every attendee's panel on the session.
      const unsub = subscribeMeetingAssistEvents(
        sessionId,
        (payload) => {
          send("live", payload);
        },
        { viewerId: userId },
      );

      const heartbeat = setInterval(() => send("ping", { t: Date.now() }), HEARTBEAT_MS);
      const deadline = setTimeout(close, MAX_WAIT_MS);
      request.raw.on("close", close);
    },
  );
};
