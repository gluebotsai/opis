import type { FastifyPluginAsync } from "fastify";
import { ownershipController } from "./controller.js";
import { domainOwnershipSchema } from "./schema.js";

export const domainRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/route-ownership",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["platform"],
        summary: "List API domain migration ownership",
        security: [{ bearerAuth: [] }],
        response: { 200: domainOwnershipSchema },
      },
    },
    async (_request, reply) => ownershipController(reply),
  );
};
