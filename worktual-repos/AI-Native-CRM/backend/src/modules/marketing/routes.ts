import type { FastifyPluginAsync } from "fastify";
import {
  createMarketingCampaignCommand,
  getMarketingEmbedSessionCommand,
  getMarketingStatusCommand,
  ingestMarketingLeadCommand,
  listMarketingCampaignsCommand,
} from "@/service/marketing/marketing-commands";
import { ForbiddenError } from "@/service/auth/require-role";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";

export const marketingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/status", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const status = await getMarketingStatusCommand();
        return sendSuccess(reply, status);
      },
      request,
    );
  });

  app.get("/embed-session", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        try {
          const session = await getMarketingEmbedSessionCommand();
          if (!session.ok) {
            return sendError(reply, session.error, session.status);
          }
          return sendSuccess(reply, {
            token: session.token,
            uiOrigin: session.uiOrigin,
            apiReachable: session.apiReachable,
            uiReachable: session.uiReachable,
            reachable: session.reachable,
          });
        } catch (err) {
          if (err instanceof ForbiddenError) {
            return sendError(reply, err.message, err.statusCode);
          }
          throw err;
        }
      },
      request,
    );
  });

  app.get<{ Querystring: { bucket?: string } }>(
    "/campaigns",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          try {
            const bucket = request.query.bucket ?? "all";
            const result = await listMarketingCampaignsCommand(bucket);
            if (!result.ok) {
              return sendError(reply, result.error, result.status);
            }
            return sendSuccess(
              reply,
              { bucket: result.bucket, campaigns: result.campaigns },
              RESPONSE.success_message,
              result.status,
            );
          } catch (err) {
            if (err instanceof ForbiddenError) {
              return sendError(reply, err.message, err.statusCode);
            }
            throw err;
          }
        },
        request,
      );
    },
  );

  app.post<{ Body: Record<string, unknown> }>(
    "/campaigns",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          try {
            const result = await createMarketingCampaignCommand(
              request.body ?? {},
            );
            if (!result.ok) {
              return sendError(reply, result.error, result.status);
            }
            return sendSuccess(
              reply,
              { id: result.id },
              RESPONSE.success_message,
              result.status,
            );
          } catch (err) {
            if (err instanceof ForbiddenError) {
              return sendError(reply, err.message, err.statusCode);
            }
            throw err;
          }
        },
        request,
      );
    },
  );

  /** Inbound webhook from Campaign MS — shared secret, no session cookie. */
  app.post<{ Body: Record<string, unknown> }>("/leads", async (request, reply) => {
    const ip =
      (typeof request.headers["x-forwarded-for"] === "string"
        ? request.headers["x-forwarded-for"].split(",")[0]?.trim()
        : null) ||
      (typeof request.headers["x-real-ip"] === "string"
        ? request.headers["x-real-ip"]
        : null) ||
      request.ip ||
      "unknown";

    const result = await ingestMarketingLeadCommand({
      headers: {
        authorization:
          typeof request.headers.authorization === "string"
            ? request.headers.authorization
            : null,
        "x-marketing-token":
          typeof request.headers["x-marketing-token"] === "string"
            ? request.headers["x-marketing-token"]
            : null,
      },
      ip,
      body: request.body ?? {},
    });

    if (!result.ok) {
      return sendError(reply, result.error, result.status);
    }

    return sendSuccess(
      reply,
      { id: result.id, merged: result.merged },
      RESPONSE.success_message,
      result.status,
    );
  });
};
