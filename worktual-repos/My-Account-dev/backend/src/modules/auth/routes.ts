import type { FastifyPluginAsync } from "fastify";
import { currentUserController } from "./controller.js";
import { currentUserResponseSchema } from "./schema.js";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/me",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["auth"],
        summary: "Return the authenticated principal",
        security: [{ bearerAuth: [] }],
        response: { 200: currentUserResponseSchema },
      },
    },
    currentUserController,
  );
};
