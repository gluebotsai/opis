import type { FastifyPluginAsync } from "fastify";
import { listServiceTicketsCommand } from "@/service/service/service-commands";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess } from "../../helpers/response.js";

export const serviceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/tickets", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await listServiceTicketsCommand();
        return sendSuccess(reply, result);
      },
      request,
    );
  });
};
