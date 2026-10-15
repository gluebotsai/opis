import type { FastifyPluginAsync } from "fastify";

import { postGooglePushWebhook } from "./google-push-shared.js";

/**
 * Prefix: /api/webhooks
 * Alias of /google-calendar/push — same calendar + gmail pubsub multiplexer.
 */
export const gmailPushWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/gmail/push", async (request, reply) =>
    postGooglePushWebhook(request, reply, "gmail-push"),
  );
};
