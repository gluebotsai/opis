import type { FastifyPluginAsync } from "fastify";
import {
  dismissPrivacyRequestCommand,
  executePrivacyRequestCommand,
  listPrivacyRequestsCommand,
} from "@/service/compliance/privacy-request-commands";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendResult } from "../../helpers/response.js";

export const privacyRequestsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await listPrivacyRequestsCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{ Params: { id: string } }>(
    "/:id/execute",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await executePrivacyRequestCommand(request.params.id);
          return sendResult(reply, result, 400, "Privacy request executed.");
        },
        request,
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/dismiss",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await dismissPrivacyRequestCommand(request.params.id);
          return sendResult(reply, result, 400, "Privacy request dismissed.");
        },
        request,
      );
    },
  );
};
