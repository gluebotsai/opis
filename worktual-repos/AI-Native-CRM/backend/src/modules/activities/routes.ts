import type { FastifyPluginAsync } from "fastify";
import {
  completeActivityTaskCommand,
  getActivityStatsCommand,
  listActivitiesPageCommand,
} from "@/service/activities/activity-commands";
import { requireSessionOrApiKey, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendResult } from "../../helpers/response.js";

export const activitiesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      page?: string;
      type?: string;
      status?: string;
      search?: string;
      q?: string;
      owner?: string;
      ownerScope?: string;
    };
  }>("/", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "activities");
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const page = Math.max(1, Number(request.query.page) || 1);
        const ownerRaw =
          request.query.ownerScope ?? request.query.owner ?? "mine";
        const result = await listActivitiesPageCommand({
          page,
          type: (request.query.type as never) ?? "all",
          status: (request.query.status as never) ?? "all",
          search: request.query.search ?? request.query.q,
          ownerScope: ownerRaw === "all" ? "all" : "mine",
        });
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.get<{
    Querystring: { owner?: string; ownerScope?: string };
  }>("/stats", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "activities");
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const ownerRaw =
          request.query.ownerScope ?? request.query.owner ?? "mine";
        const result = await getActivityStatsCommand({
          ownerScope: ownerRaw === "all" ? "all" : "mine",
        });
        return sendSuccess(reply, result);
      },
      request,
    );
  });

  app.post<{
    Params: { activityId: string };
  }>("/:activityId/complete", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "activities");
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await completeActivityTaskCommand(
          request.params.activityId,
        );
        return sendResult(reply, result);
      },
      request,
    );
  });
};
