import { createHmac, timingSafeEqual } from "crypto";
import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "@/dao/db/prisma";
import {
  attachActivityTranscript,
  triggerPostMeetingAgentsForActivity,
} from "@/service/ai/lead-lifecycle-transcripts";
import {
  fetchMeetingServiceTranscript,
  mapMeetingServiceStatus,
} from "@/service/meeting-service/client";
import { meetingServiceWebhookSecret } from "@/service/meeting-service/config";
import {
  patchCaptureBotMeta,
  readCaptureBotMeta,
} from "@/service/transcripts/meeting-capture";
import { sendError, sendSuccess } from "../../helpers/response.js";

type CompletedWebhookBody = {
  event?: string;
  meeting_id?: string;
  organization_id?: string;
  entity_type?: string;
  entity_id?: string;
  status?: string;
  error_code?: string | null;
  error_message?: string | null;
  extract?: {
    summary?: string;
    next_step?: string;
    action_items?: unknown[];
    pain_points?: unknown[];
    speakers?: unknown[];
  } | null;
};

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  const secret = meetingServiceWebhookSecret();
  if (!secret) return process.env.NODE_ENV !== "production";
  const sig = (signatureHeader || "").trim();
  if (!sig.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(sig.slice(7));
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function resolveActivityForMeeting(input: {
  meetingServiceId: string;
  organizationId: string;
  entityType?: string | null;
  entityId?: string | null;
}): Promise<{
  activityId: string;
  contactId: string;
  hostUserId: string;
} | null> {
  const orgId = BigInt(input.organizationId);
  const sessions = await prisma.meetingAssistSession.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      activityId: true,
      contactId: true,
      hostUserId: true,
      meta: true,
    },
  });
  for (const session of sessions) {
    const bot = readCaptureBotMeta(session.meta);
    if (bot?.botId !== input.meetingServiceId) continue;
    if (!session.activityId || !session.hostUserId) continue;
    return {
      activityId: session.activityId,
      contactId: session.contactId,
      hostUserId: String(session.hostUserId),
    };
  }

  const entityType = (input.entityType || "").trim().toLowerCase();
  const entityId = (input.entityId || "").trim();
  if (entityType === "contact" && entityId) {
    const activity = await prisma.contactActivity.findFirst({
      where: {
        contactId: entityId,
        type: "meeting",
        organizationId: orgId,
      },
      orderBy: { dueAt: "desc" },
      select: { id: true, contactId: true },
    });
    const host = await prisma.meetingAssistSession.findFirst({
      where: { activityId: activity?.id },
      select: { hostUserId: true },
    });
    if (activity && host?.hostUserId) {
      return {
        activityId: activity.id,
        contactId: activity.contactId,
        hostUserId: String(host.hostUserId),
      };
    }
  }

  return null;
}

export const meetingServiceWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/meeting-service/completed", async (request, reply) => {
    const raw = JSON.stringify(request.body ?? {});
    if (
      !verifyWebhookSignature(
        raw,
        request.headers["x-webhook-signature"] as string | undefined,
      )
    ) {
      return sendError(reply, "Unauthorized", 401);
    }

    const body = (request.body ?? {}) as CompletedWebhookBody;
    if (body.event !== "meeting.completed") {
      return sendSuccess(reply, { ignored: true });
    }

    const meetingId = String(body.meeting_id || "").trim();
    const organizationId = String(body.organization_id || "").trim();
    if (!meetingId || !organizationId) {
      return sendError(reply, "missing meeting_id or organization_id", 422);
    }

    const resolved = await resolveActivityForMeeting({
      meetingServiceId: meetingId,
      organizationId,
      entityType: body.entity_type,
      entityId: body.entity_id,
    });
    if (!resolved) {
      return sendSuccess(reply, { ok: false, reason: "activity_not_found" });
    }

    const session = await prisma.meetingAssistSession.findUnique({
      where: { activityId: resolved.activityId },
      select: { id: true, meta: true },
    });

    const transcript = await fetchMeetingServiceTranscript({
      organizationId,
      userId: resolved.hostUserId,
      meetingId,
    });

    if (session) {
      const mapped = mapMeetingServiceStatus(body.status || "completed");
      const prev = readCaptureBotMeta(session.meta);
      await patchCaptureBotMeta(session.id, {
        status: mapped,
        botId: meetingId,
        provider: "vexa",
        meetingServiceStatus: body.status || "completed",
        error: body.error_message || body.error_code || prev?.error || null,
      });
    }

    if (transcript.ok && transcript.text.trim()) {
      await attachActivityTranscript({
        activityId: resolved.activityId,
        transcript: transcript.text,
        source: "meeting_service",
        runPostMeetingAgents: true,
      });
    } else {
      const existing = await prisma.contactActivity.findUnique({
        where: { id: resolved.activityId },
        select: {
          transcriptText: true,
          contactId: true,
          organizationId: true,
        },
      });
      if (existing?.transcriptText?.trim()) {
        triggerPostMeetingAgentsForActivity({
          activityId: resolved.activityId,
          contactId: existing.contactId,
          organizationId: String(existing.organizationId),
          includeLifecycle: false,
        });
      }
    }

    if (body.extract && session) {
      const activity = await prisma.contactActivity.findUnique({
        where: { id: resolved.activityId },
        select: { transcriptInsights: true },
      });
      const prior =
        activity?.transcriptInsights &&
        typeof activity.transcriptInsights === "object" &&
        !Array.isArray(activity.transcriptInsights)
          ? (activity.transcriptInsights as Record<string, unknown>)
          : {};
      await prisma.contactActivity.update({
        where: { id: resolved.activityId },
        data: {
          transcriptInsights: {
            ...prior,
            meetingServiceExtract: body.extract,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return sendSuccess(reply, {
      ok: true,
      activityId: resolved.activityId,
      transcriptChars: transcript.ok ? transcript.text.length : 0,
    });
  });
};
