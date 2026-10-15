import type { FastifyPluginAsync } from "fastify";
import { healthController } from "./controller.js";
import { healthResponseSchema } from "./schema.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Report API dependency readiness",
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (_request, reply) => healthController(app, reply),
  );
};
