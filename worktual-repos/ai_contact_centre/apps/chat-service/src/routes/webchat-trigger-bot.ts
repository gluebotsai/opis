import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";

import { isAuthorized } from "../lib/internal-auth.js";
import {
  triggerBotRequestSchema,
  triggerWebchatBot,
  type WebchatTriggerBotDeps,
} from "../services/webchat-trigger-bot.js";

export function registerWebchatTriggerBotRoute(
  app: FastifyInstance,
  deps: WebchatTriggerBotDeps,
  logger: Logger,
): void {
  app.post("/internal/v1/webchat/trigger-bot", async (request, reply) => {
    if (!isAuthorized(request)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const payload = triggerBotRequestSchema.parse(request.body);
    const result = await triggerWebchatBot(deps, payload);
    if (!result.ok) {
      return reply.status(result.status).send({ error: result.error });
    }

    return {
      ok: true,
      conversationId: result.conversationId,
      sessionStarted: result.sessionStarted,
    };
  });

  logger.info("webchat trigger-bot route registered");
}
