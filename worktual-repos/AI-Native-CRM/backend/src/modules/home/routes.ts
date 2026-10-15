import type { FastifyPluginAsync } from "fastify";
import {
  autoAssignUntouchedLeadsCommand,
  bulkAssignLeadsCommand,
  getHomeDashboardCommand,
  reassignDealCommand,
  refreshHomeAnalyticsCommand,
} from "@/service/home/dashboard-commands";
import {
  getOrCreateDailyBriefing,
  markDailyBriefingPlayed,
  proxyDailyBriefingTts,
} from "@/service/home/daily-briefing-commands";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendError, sendSuccess, sendResult } from "../../helpers/response.js";

export const homeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      lbMetric?: string;
      lbPeriod?: string;
      metricsPeriod?: string;
      untouchedHours?: string;
      teamGroup?: string;
      region?: string;
      repId?: string;
      scorecardWeek?: string;
      scorecardTz?: string;
    };
  }>("/", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const q = request.query;
        const untouchedRaw = q.untouchedHours
          ? Number.parseInt(q.untouchedHours, 10)
          : undefined;
        const data = await getHomeDashboardCommand({
          leaderboardMetric: q.lbMetric as
            | "deals_closed"
            | "revenue"
            | "calls"
            | undefined,
          leaderboardPeriod: q.lbPeriod as
            | "all_time"
            | "week"
            | "month"
            | "quarter"
            | undefined,
          metricsPeriod: q.metricsPeriod as
            | "today"
            | "yesterday"
            | "week"
            | "month"
            | "quarter"
            | undefined,
          untouchedHours: Number.isFinite(untouchedRaw)
            ? untouchedRaw
            : undefined,
          teamGroupBy: q.teamGroup as "stage" | "rep" | undefined,
          region: q.region ?? null,
          repId: q.repId ?? null,
          scorecardWeek: q.scorecardWeek ?? null,
          scorecardTz: q.scorecardTz ?? null,
        });
        return sendSuccess(reply, { data });
      },
      request,
    );
  });

  app.get("/briefing", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const data = await getOrCreateDailyBriefing();
        return sendSuccess(reply, data);
      },
      request,
    );
  });

  app.post("/briefing/played", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const data = await markDailyBriefingPlayed();
        return sendSuccess(reply, data);
      },
      request,
    );
  });

  app.post("/briefing/tts", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await proxyDailyBriefingTts();
        if (!result.ok) {
          return sendError(reply, result.error, result.status);
        }
        reply.removeHeader("Content-Type");
        return reply
          .type(result.contentType)
          .header("Cache-Control", "no-store")
          .header("Content-Length", String(result.buffer.length))
          .send(result.buffer);
      },
      request,
    );
  });

  app.post("/analytics/refresh", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await refreshHomeAnalyticsCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: { contactIds?: string[]; ownerUserId?: string };
  }>("/ops/bulk-assign-leads", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const result = await bulkAssignLeadsCommand({
          contactIds: body.contactIds ?? [],
          ownerUserId: body.ownerUserId ?? "",
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: { contactIds?: string[] };
  }>("/ops/auto-assign-leads", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await autoAssignUntouchedLeadsCommand({
          contactIds: request.body?.contactIds ?? [],
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: { dealId?: string; ownerUserId?: string };
  }>("/ops/reassign-deal", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const result = await reassignDealCommand({
          dealId: body.dealId ?? "",
          ownerUserId: body.ownerUserId ?? "",
        });
        return sendResult(reply, result);
      },
      request,
    );
  });
};
