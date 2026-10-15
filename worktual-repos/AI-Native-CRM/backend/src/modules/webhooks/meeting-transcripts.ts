import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "@/dao/db/prisma";
import {
  appendTranscriptChunks,
  finalizeMeetingAssistSession,
  findSessionByExternalMeetingId,
  startMeetingAssistSession,
} from "@/service/ai/meeting-assist";
import { parseRecallTranscriptEvent, parseRecallCaptureDoneEvent } from "@/service/meeting-assist/meeting-bot";
import { markLiveAssistListening } from "@/service/meeting-assist/live-assist";
import {
  completeMeetingCaptureFromBot,
  findSessionIdByCaptureBotId,
  patchCaptureBotMeta,
} from "@/service/transcripts/meeting-capture";
import {
  downloadZoomTranscriptUrl,
  fetchZoomMeetingTranscript,
} from "@/service/transcripts/zoom-transcript";
import { attachProviderTranscriptToMeeting } from "@/service/transcripts/attach-from-webhook";
import { handleTeamsTranscriptNotification, ensureTeamsTranscriptSubscription } from "@/service/transcripts/teams-push";
import { handleGoogleMeetTranscriptPush } from "@/service/transcripts/google-meet-push";
import { sendError, sendSuccess } from "../../helpers/response.js";

function isInternalAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers["x-internal-secret"] === secret;
}

async function resolveOrStartSession(input: {
  meetingId?: string | null;
  activityId?: string | null;
  provider: "google_meet" | "zoom" | "teams";
}): Promise<string | null> {
  if (input.activityId) {
    const started = await startMeetingAssistSession({
      activityId: input.activityId,
      provider: input.provider,
      externalMeetingId: input.meetingId,
    });
    if (started.ok) return started.sessionId;
  }

  if (input.meetingId) {
    const existing = await findSessionByExternalMeetingId(input.meetingId);
    if (existing) return existing.id;

    const activities = await prisma.contactActivity.findMany({
      where: { type: "meeting", body: { contains: input.meetingId } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true },
    });
    for (const a of activities) {
      const started = await startMeetingAssistSession({
        activityId: a.id,
        provider: input.provider,
        externalMeetingId: input.meetingId,
      });
      if (started.ok) return started.sessionId;
    }
  }
  return null;
}

type ChunkBody = {
  meetingId?: string;
  activityId?: string;
  transcript?: string;
  chunks?: Array<{ text?: string; speaker?: string; spokenAt?: string; seq?: number }>;
  finalize?: boolean;
};

async function ingestProviderTranscript(input: {
  provider: "google_meet" | "zoom" | "teams";
  source: string;
  body: ChunkBody;
  defaultSpeaker: string;
}) {
  const sessionId = await resolveOrStartSession({
    meetingId: input.body.meetingId,
    activityId: input.body.activityId,
    provider: input.provider,
  });
  if (!sessionId) return { ok: false as const, error: "No matching session" };

  const chunks =
    Array.isArray(input.body.chunks) && input.body.chunks.length > 0
      ? input.body.chunks
      : input.body.transcript
        ? [{ text: input.body.transcript, speaker: input.defaultSpeaker }]
        : [];

  if (chunks.length > 0) {
    await appendTranscriptChunks({
      sessionId,
      chunks: chunks.map((c) => ({
        text: c.text || "",
        speaker: c.speaker,
        spokenAt: c.spokenAt,
        source: input.source,
        seq: c.seq,
      })),
    });
  }

  let finalized = null;
  if (input.body.finalize) {
    finalized = await finalizeMeetingAssistSession({
      sessionId,
      source: input.source,
    });
  }

  return { ok: true as const, sessionId, finalized };
}

function verifyZoomSignature(
  request: FastifyRequest,
  rawBody: string,
): boolean {
  const secret = process.env.ZOOM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const signature = String(request.headers["x-zm-signature"] || "");
  const timestamp = String(request.headers["x-zm-request-timestamp"] || "");
  if (!signature || !timestamp) return false;
  const message = `v0:${timestamp}:${rawBody}`;
  const hash = createHmac("sha256", secret).update(message).digest("hex");
  const expected = `v0=${hash}`;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function extractZoomTranscriptDownloadUrl(
  payload: Record<string, unknown>,
): string | null {
  const object = (payload.payload as Record<string, unknown> | undefined)
    ?.object as Record<string, unknown> | undefined;
  const recording =
    (object?.recording_files as Array<Record<string, unknown>> | undefined) ||
    [];
  for (const file of recording) {
    if (
      String(file.file_type || "").toLowerCase().includes("transcript") &&
      typeof file.download_url === "string"
    ) {
      return file.download_url;
    }
  }
  return null;
}

function extractZoomTranscriptText(payload: Record<string, unknown>): string {
  if (typeof payload.transcript === "string") return payload.transcript;
  const object = (payload.payload as Record<string, unknown> | undefined)
    ?.object as Record<string, unknown> | undefined;
  if (typeof object?.transcript === "string") return String(object.transcript);
  return "";
}

/**
 * Provider transcript / caption intake → existing POST chunks pipeline.
 * Prefix: /api/webhooks
 */
export const meetingTranscriptWebhookRoutes: FastifyPluginAsync = async (
  app,
) => {
  /**
   * Google Meet captions / Drive transcript adapter (manual / sidecar push).
   * Auth: x-internal-secret.
   */
  app.post("/google-meet/transcript", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, "Unauthorized", 401);
    }
    const body = (request.body ?? {}) as ChunkBody;
    if (body.transcript?.trim() && (body.meetingId || body.activityId)) {
      const attached = await attachProviderTranscriptToMeeting({
        provider: "google_meet",
        meetingId: body.meetingId,
        activityId: body.activityId,
        transcript: body.transcript,
        source: "google_meet_transcript",
      });
      if (!attached.ok) return sendError(reply, attached.error, 404);
      return sendSuccess(reply, attached);
    }
    const result = await ingestProviderTranscript({
      provider: "google_meet",
      source: "google_meet_transcript",
      body,
      defaultSpeaker: "Meet",
    });
    if (!result.ok) return sendError(reply, result.error, 404);
    return sendSuccess(reply, result);
  });

  /**
   * Google Pub/Sub push for Meet transcript.fileGenerated.
   * Auth: optional GOOGLE_MEET_PUBSUB_VERIFICATION_TOKEN as ?token= or header.
   * Always ACK (200) after handling so Pub/Sub does not infinite-retry poison.
   */
  app.post("/google-meet/transcript-push", async (request, reply) => {
    const expected = process.env.GOOGLE_MEET_PUBSUB_VERIFICATION_TOKEN?.trim();
    if (expected) {
      const q = (request.query as { token?: string } | undefined)?.token;
      const got = String(
        q ||
          request.headers["x-goog-channel-token"] ||
          request.headers["x-internal-secret"] ||
          "",
      );
      if (got !== expected) return sendError(reply, "Unauthorized", 401);
    }
    const result = await handleGoogleMeetTranscriptPush(request.body);
    return sendSuccess(reply, result);
  });

  /**
   * Microsoft Teams / Graph transcript adapter (manual / sidecar push).
   * Auth: x-internal-secret.
   */
  app.post("/teams/transcript", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, "Unauthorized", 401);
    }
    const body = (request.body ?? {}) as ChunkBody;
    if (body.transcript?.trim() && (body.meetingId || body.activityId)) {
      const attached = await attachProviderTranscriptToMeeting({
        provider: "teams",
        meetingId: body.meetingId,
        activityId: body.activityId,
        transcript: body.transcript,
        source: "teams_graph",
      });
      if (!attached.ok) return sendError(reply, attached.error, 404);
      return sendSuccess(reply, attached);
    }
    const result = await ingestProviderTranscript({
      provider: "teams",
      source: "teams_graph",
      body,
      defaultSpeaker: "Teams",
    });
    if (!result.ok) return sendError(reply, result.error, 404);
    return sendSuccess(reply, result);
  });

  /**
   * Graph change notifications — transcript available after Teams meeting.
   * Validation handshake: ?validationToken=… → plain text echo.
   */
  app.post("/teams/transcript-notifications", async (request, reply) => {
    const validationToken = (request.query as { validationToken?: string })
      ?.validationToken;
    if (validationToken) {
      return reply
        .code(200)
        .header("Content-Type", "text/plain")
        .send(validationToken);
    }

    const body = (request.body ?? {}) as {
      value?: Array<{
        clientState?: string;
        resource?: string;
        resourceData?: { id?: string; "@odata.id"?: string };
      }>;
    };
    const results = [];
    for (const item of body.value || []) {
      results.push(await handleTeamsTranscriptNotification(item));
    }
    return sendSuccess(reply, { results });
  });

  /** Graph subscription lifecycle (reauth / missed). */
  app.post("/teams/transcript-lifecycle", async (request, reply) => {
    const validationToken = (request.query as { validationToken?: string })
      ?.validationToken;
    if (validationToken) {
      return reply
        .code(200)
        .header("Content-Type", "text/plain")
        .send(validationToken);
    }
    return sendSuccess(reply, { ok: true, received: true });
  });

  /**
   * Ops: create tenant-wide Teams transcript Graph subscription (push).
   * Auth: x-internal-secret.
   */
  app.post("/teams/transcript-subscription", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, "Unauthorized", 401);
    }
    const result = await ensureTeamsTranscriptSubscription();
    if (!result.ok) return sendError(reply, result.error, 400);
    return sendSuccess(reply, result);
  });

  /**
   * Zoom Event Subscription — recording/transcript ready (primary path).
   * Supports Zoom URL validation + HMAC when ZOOM_WEBHOOK_SECRET set.
   */
  app.post("/zoom/transcript", async (request, reply) => {
    const rawBody =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body ?? {});
    let payload: Record<string, unknown>;
    try {
      payload =
        typeof request.body === "object" && request.body
          ? (request.body as Record<string, unknown>)
          : (JSON.parse(rawBody) as Record<string, unknown>);
    } catch {
      return sendError(reply, "Invalid JSON", 400);
    }

    if (payload.event === "endpoint.url_validation") {
      const plainToken = String(
        (payload.payload as Record<string, unknown> | undefined)?.plainToken ||
          "",
      );
      const secret = process.env.ZOOM_WEBHOOK_SECRET?.trim() || "";
      const encryptedToken = createHmac("sha256", secret)
        .update(plainToken)
        .digest("hex");
      return reply.send({ plainToken, encryptedToken });
    }

    if (!verifyZoomSignature(request, rawBody)) {
      return sendError(reply, "Invalid signature", 401);
    }

    const object = (
      (payload.payload as Record<string, unknown> | undefined)?.object as
        | Record<string, unknown>
        | undefined
    );
    const meetingId = String(
      payload.meetingId ||
        payload.meeting_id ||
        object?.id ||
        object?.uuid ||
        "",
    ).trim();

    // Live caption chunks or RTMS→STT sidecar push
    if (Array.isArray(payload.chunks) && meetingId) {
      const sessionId = await resolveOrStartSession({
        meetingId,
        provider: "zoom",
      });
      if (!sessionId) return sendError(reply, "No matching session", 404);
      const source =
        String(payload.source || "").trim() === "zoom_rtms"
          ? "zoom_rtms"
          : "zoom_webhook";
      const result = await appendTranscriptChunks({
        sessionId,
        chunks: (payload.chunks as Array<Record<string, unknown>>).map((c) => ({
          text: String(c.text || ""),
          speaker: c.speaker != null ? String(c.speaker) : null,
          spokenAt: c.spokenAt != null ? String(c.spokenAt) : null,
          source,
          seq: typeof c.seq === "number" ? c.seq : null,
        })),
      });
      return sendSuccess(reply, result);
    }

    const event = String(payload.event || "");
    if (
      meetingId &&
      (event.includes("transcript") ||
        event.includes("caption") ||
        event.includes("recording"))
    ) {
      const downloadUrl = extractZoomTranscriptDownloadUrl(payload);
      let text = extractZoomTranscriptText(payload);
      if (!text && downloadUrl) {
        text = (await downloadZoomTranscriptUrl(downloadUrl)) || "";
      }
      if (!text) {
        const fetched = await fetchZoomMeetingTranscript(meetingId);
        if (fetched.ok) text = fetched.text;
      }

      if (!text) {
        return sendSuccess(reply, {
          ok: true,
          pending: true,
          meetingId,
          message: "Zoom event received; transcript file not ready yet",
        });
      }

      const attached = await attachProviderTranscriptToMeeting({
        provider: "zoom",
        meetingId,
        transcript: text,
        source: "zoom_cloud_transcript",
      });
      return sendSuccess(reply, attached);
    }

    // Explicit RTMS fallback body (same shape as Teams/Meet adapters)
    if (payload.meetingId || payload.activityId) {
      const result = await ingestProviderTranscript({
        provider: "zoom",
        source:
          String(payload.source || "").trim() === "zoom_rtms"
            ? "zoom_rtms"
            : "zoom_webhook",
        body: payload as ChunkBody,
        defaultSpeaker: "Zoom",
      });
      if (!result.ok) return sendError(reply, result.error, 404);
      return sendSuccess(reply, result);
    }

    return sendSuccess(reply, { ok: true, ignored: true });
  });

  /**
   * Zoom RTMS → own STT sidecar push (when live transcript lag is too high).
   * Auth: x-internal-secret. Body: { meetingId?, activityId?, chunks[], finalize? }
   */
  app.post("/zoom/rtms", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, "Unauthorized", 401);
    }
    const body = { ...(request.body as ChunkBody), } as ChunkBody & {
      source?: string;
    };
    const result = await ingestProviderTranscript({
      provider: "zoom",
      source: "zoom_rtms",
      body,
      defaultSpeaker: "Zoom",
    });
    if (!result.ok) return sendError(reply, result.error, 404);
    return sendSuccess(reply, result);
  });

  /**
   * Recall.ai meeting bot — live Assist chunks + production capture done.
   * Dashboard should also subscribe to transcript.done / bot.done / recording.done.
   */
  app.post("/meeting-bot/recall", async (request, reply) => {
    const expected = process.env.MEETING_BOT_WEBHOOK_SECRET?.trim();
    if (expected) {
      const got = String(
        request.headers["x-meeting-bot-secret"] ||
          request.headers["x-internal-secret"] ||
          "",
      );
      if (got !== expected) return sendError(reply, "Unauthorized", 401);
    }

    const done = parseRecallCaptureDoneEvent(request.body);
    if (done) {
      if (done.event.includes("failed") && done.sessionIdFromMeta) {
        await patchCaptureBotMeta(done.sessionIdFromMeta, {
          status: "failed",
          botId: done.botId,
          error: "Recall reported transcript.failed",
        });
        return sendSuccess(reply, { ok: true, failed: true });
      }
      const completed = await completeMeetingCaptureFromBot({
        botId: done.botId,
        activityId: done.activityIdFromMeta,
        sessionId: done.sessionIdFromMeta,
      });
      return sendSuccess(reply, completed);
    }

    const parsed = parseRecallTranscriptEvent(request.body);
    if (!parsed) {
      return sendSuccess(reply, { ok: true, ignored: true });
    }

    // Capture product: accumulate all speakers into chunks; done webhook finalizes.
    // Assist product: skip host lines for coaching.
    const isCapture = parsed.productFromMeta === "worktual_capture";
    if (!isCapture && parsed.isHost) {
      return sendSuccess(reply, { ok: true, skippedHost: true });
    }

    let sessionId = parsed.sessionIdFromMeta?.trim() || null;
    if (!sessionId && parsed.meetCodeFromMeta) {
      const existing = await findSessionByExternalMeetingId(
        parsed.meetCodeFromMeta,
      );
      sessionId = existing?.id || null;
    }
    if (!sessionId && parsed.activityIdFromMeta) {
      const s = await prisma.meetingAssistSession.findUnique({
        where: { activityId: parsed.activityIdFromMeta },
        select: { id: true },
      });
      sessionId = s?.id || null;
    }
    if (!sessionId && parsed.botId) {
      sessionId = await findSessionIdByCaptureBotId(parsed.botId);
    }
    if (!sessionId) {
      return sendError(reply, "No matching Assist session for meeting bot", 404);
    }

    if (isCapture && parsed.botId) {
      await patchCaptureBotMeta(sessionId, {
        status: "joined",
        botId: parsed.botId,
      }).catch(() => null);
    }

    // Honest Assist status: create OK ≠ listening; first customer speech does.
    if (!parsed.isHost) {
      await markLiveAssistListening(sessionId).catch(() => null);
    }

    await appendTranscriptChunks({
      sessionId,
      chunks: [
        {
          text: parsed.text,
          speaker: parsed.speaker,
          speakerEmail: parsed.speakerEmail,
          isHost: parsed.isHost,
          // Capture keeps host lines for History. Tag guest lines so auto-Assist
          // treats them like Assist-bot captions (Recall already marks isHost).
          // Same Google display name for rep + customer must not block coaching.
          source: isCapture
            ? parsed.isHost
              ? "meeting_bot_capture"
              : "meeting_bot"
            : "meeting_bot",
        },
      ],
    });

    return sendSuccess(reply, {
      ok: true,
      sessionId,
      botId: parsed.botId,
      capture: isCapture,
    });
  });
};
