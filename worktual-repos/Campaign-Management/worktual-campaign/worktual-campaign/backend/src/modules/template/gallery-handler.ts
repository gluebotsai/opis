// @ts-nocheck
import type { FastifyReply, FastifyRequest } from "fastify";
import { requireSession } from "../../middlewares/authendication.js";
import { sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import {
  enqueueGalleryBootstrapForSession,
  getGalleryStatusForOrg,
} from "../../services/gallery-bootstrap-worker.js";
import { assessGalleryBootstrapNeed } from "../../helpers/gallery-bootstrap-need.js";
import { env } from "../../config/env.js";

export async function postGalleryBootstrapHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  if (!env.gallery.enabled) {
    return sendSuccess(reply, RESPONSE.libraryTemplatesSuccess, {
      enqueued: false,
      reason: "Gallery bootstrap disabled",
    });
  }
  const result = await enqueueGalleryBootstrapForSession(session, "bootstrap");
  return reply.status(202).send({
    statusCode: 202,
    message: "Template Gallery bootstrap queued",
    ...result,
  });
}

export async function getGalleryStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const status = await getGalleryStatusForOrg(session.organizationId);
  const assessment = await assessGalleryBootstrapNeed(session, "bootstrap");
  return sendSuccess(reply, RESPONSE.libraryTemplatesSuccess, {
    ...status,
    galleryComplete: assessment.galleryComplete,
    readyChannels: assessment.readyChannels,
    missingTemplates: assessment.missingTemplates,
  });
}
