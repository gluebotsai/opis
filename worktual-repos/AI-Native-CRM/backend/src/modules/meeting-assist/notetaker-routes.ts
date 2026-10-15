import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import {
  isMeetingServiceConfigured,
  meetingServicePublicUrl,
  notetakerProvider,
  vexaNotetakerAutoDispatch,
} from "@/service/meeting-service/config";
import {
  sendNotetakerForActivity,
  syncCaptureBotFromMeetingService,
} from "@/service/meeting-service/notetaker-commands";
import {
  readCaptureBotMeta,
  reconcileMeetingCapture,
} from "@/service/transcripts/meeting-capture";
import { prisma } from "@/dao/db/prisma";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendError, sendSuccess } from "../../helpers/response.js";

async function requireUserId(
  request: FastifyRequest,
  reply: Parameters<typeof sendError>[0],
): Promise<string | null> {
  return requireSession(request, reply);
}

export const meetingNotetakerRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Params: { activityId: string };
    Body: { consentCaptured?: boolean };
  }>("/:activityId/send", async (request, reply) => {
    const userId = await requireUserId(request, reply);
    if (!userId) return;

    if (!isMeetingServiceConfigured() || notetakerProvider() !== "vexa") {
      return sendError(
        reply,
        "Meeting service (Vexa) is not configured on this server.",
        503,
      );
    }

    return withUser(
      userId,
      async () => {
        const organizationId = await getCurrentOrganizationId();
        const body = request.body ?? {};
        const result = await sendNotetakerForActivity({
          activityId: request.params.activityId,
          userId,
          organizationId,
          consentCaptured: body.consentCaptured !== false,
        });
        if (!result.ok) {
          return sendError(
            reply,
            result.error,
            result.skipped ? 409 : 400,
          );
        }
        return sendSuccess(reply, {
          meetingServiceId: result.meetingServiceId,
          sessionId: result.sessionId,
          status: result.status,
        });
      },
      request,
    );
  });

  app.get<{ Params: { activityId: string } }>(
    "/:activityId/status",
    async (request, reply) => {
      const userId = await requireUserId(request, reply);
      if (!userId) return;

      return withUser(
        userId,
        async () => {
          const organizationId = await getCurrentOrganizationId();
          const session = await prisma.meetingAssistSession.findUnique({
            where: { activityId: request.params.activityId },
            select: { id: true, meta: true },
          });
          if (!session) {
            return sendSuccess(reply, { status: null, captureBot: null });
          }
          const activity = await prisma.contactActivity.findUnique({
            where: { id: request.params.activityId },
            select: { dueAt: true, transcriptText: true },
          });
          if (
            activity?.dueAt &&
            activity.dueAt.getTime() <= Date.now() &&
            !activity.transcriptText?.trim()
          ) {
            await reconcileMeetingCapture(request.params.activityId).catch(
              () => false,
            );
          }
          const sessionAfter = await prisma.meetingAssistSession.findUnique({
            where: { activityId: request.params.activityId },
            select: { id: true, meta: true },
          });
          let captureBot = readCaptureBotMeta(
            sessionAfter?.meta ?? session.meta,
          );
          if (
            captureBot?.botId &&
            captureBot.provider === "vexa" &&
            isMeetingServiceConfigured()
          ) {
            captureBot =
              (await syncCaptureBotFromMeetingService({
                sessionId: session.id,
                meetingServiceId: captureBot.botId,
                organizationId,
                userId,
              })) ?? captureBot;
          }
          return sendSuccess(reply, {
            status: captureBot?.meetingServiceStatus || captureBot?.status,
            captureBot,
            vexaAutoDispatch: vexaNotetakerAutoDispatch(),
            assistAddonUrl: meetingServicePublicUrl()
              ? `${meetingServicePublicUrl()}/addons/meet/`
              : null,
          });
        },
        request,
      );
    },
  );
};
