/**
 * Internal CRM ↔ ai-service Digital Marketing bridges.
 * Prefix: /api/internal/seo
 * Auth: x-internal-secret
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { sendError, sendSuccess } from "../../helpers/response.js";
import { researchSeoKeywords } from "@/service/seo/keyword-research";
import { publishSeoSocialPost } from "@/service/seo/social-publish";

function isInternalAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers["x-internal-secret"] === secret;
}

export const internalSeoRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply: FastifyReply) => {
    if (!isInternalAuthorized(request)) {
      await sendError(reply, "Unauthorized", 401);
    }
  });

  app.post<{
    Body: {
      organizationId?: string;
      userId?: string;
      seed?: string;
      location?: string;
      language?: string;
      filters?: {
        intent?: string | null;
        minVolume?: number | null;
        maxKd?: number | null;
        search?: string | null;
      };
    };
  }>("/keyword-research", async (request, reply) => {
    const organizationId = String(request.body?.organizationId || "").trim();
    const seed = String(request.body?.seed || "").trim();
    if (!organizationId || !seed) {
      return sendError(reply, "organizationId and seed are required", 400);
    }
    const result = await researchSeoKeywords({
      organizationId,
      userId: request.body?.userId,
      seed,
      location: request.body?.location,
      language: request.body?.language,
      filters: request.body?.filters,
    });
    return sendSuccess(reply, { data: result });
  });

  app.post<{
    Body: { organizationId?: string; postId?: string };
  }>("/publish-post", async (request, reply) => {
    const organizationId = String(request.body?.organizationId || "").trim();
    const postId = String(request.body?.postId || "").trim();
    if (!organizationId || !postId) {
      return sendError(reply, "organizationId and postId are required", 400);
    }
    const result = await publishSeoSocialPost({ organizationId, postId });
    return sendSuccess(reply, { data: result });
  });
};
