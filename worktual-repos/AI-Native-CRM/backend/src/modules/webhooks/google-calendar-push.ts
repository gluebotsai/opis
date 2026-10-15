import type { FastifyPluginAsync } from "fastify";

import { postGooglePushWebhook } from "./google-push-shared.js";

/**
 * Prefix: /api/webhooks
 * Google Calendar events.watch (HTTPS) and Gmail Pub/Sub (mcp-push) multiplex.
 */
export const googleCalendarPushWebhookRoutes: FastifyPluginAsync = async (
  app,
) => {
  app.post("/google-calendar/push", async (request, reply) =>
    postGooglePushWebhook(request, reply, "google-calendar-push"),
  );
};
