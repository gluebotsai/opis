import type { FastifyPluginAsync } from "fastify";

import { forwardToMeetingService } from "@/service/meeting-service/forward-to-meeting-service";
import { meetingServiceBaseUrl } from "@/service/meeting-service/config";

/**
 * When production nginx (or dev API proxy) hits the CRM public host, serve Path B add-on assets
 * and meeting-service assist APIs from MEETING_SERVICE_URL — same paths as Vite/nginx.
 */
export const meetingServiceAddonProxyRoutes: FastifyPluginAsync = async (app) => {
  if (!meetingServiceBaseUrl()) {
    return;
  }

  app.get("/addons/meet", async (request, reply) => {
    const qs = request.url.includes("?")
      ? request.url.slice(request.url.indexOf("?"))
      : "";
    return reply.redirect(302, `/addons/meet/${qs}`);
  });

  app.all("/addons/meet/*", forwardToMeetingService);

  app.all("/v1/assist", forwardToMeetingService);
  app.all("/v1/assist/session", forwardToMeetingService);
  app.all("/v1/assist/session/*", forwardToMeetingService);
  // POST /v1/assist/ask is registered in meetingServicePublicRoutes (forwards when meeting_url set).
  app.all("/v1/meetings", forwardToMeetingService);
  app.all("/v1/meetings/*", forwardToMeetingService);
};
