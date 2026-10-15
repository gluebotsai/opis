import type { FastifyPluginAsync } from "fastify";
import {
  getReportsCommand,
  refreshFunnelSnapshotCommand,
} from "@/service/reports/report-commands";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendResult } from "../../helpers/response.js";

export const reportsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const data = await getReportsCommand();
        return sendSuccess(reply, data);
      },
      request,
    );
  });

  app.post("/refresh", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await refreshFunnelSnapshotCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });
};
