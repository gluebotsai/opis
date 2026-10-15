import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import { proxyCopilotJson, proxyCopilotStream } from "../services/copilot-stream-proxy.js";

export async function registerAssistantRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  app.post(joinApiV1(apiV1Base, "/assistant/copilot/stream"), async (request, reply) =>
    proxyCopilotStream(request, reply, "stream"),
  );

  app.post(joinApiV1(apiV1Base, "/assistant/copilot/suggest-reply/stream"), async (request, reply) =>
    proxyCopilotStream(request, reply, "suggest-reply/stream"),
  );

  app.post(joinApiV1(apiV1Base, "/assistant/copilot/suggest-reply/confirm"), async (request, reply) =>
    proxyCopilotJson(request, reply, "suggest-reply/confirm"),
  );
}
