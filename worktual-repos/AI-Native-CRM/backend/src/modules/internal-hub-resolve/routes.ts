import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { resolveHubPayloadFields } from "@/service/ai/hub-payload-resolve";
import { sendError, sendSuccess } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";

function isInternalAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers["x-internal-secret"] === secret;
}

function orgFromRequest(request: FastifyRequest): string | null {
  const header = request.headers["x-organization-id"];
  return typeof header === "string" && header.trim() ? header.trim() : null;
}

export const internalHubResolveRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return sendError(reply, RESPONSE.unauthorized, 401);
    }
  });

  app.post<{
    Body: {
      contactId?: string | null;
      dealId?: string | null;
      companyId?: string | null;
      instruction?: string | null;
      description?: string | null;
      text?: string | null;
      body?: string | null;
      emails?: string[];
    };
  }>("/resolve", async (request, reply) => {
    const organizationId = orgFromRequest(request);
    if (!organizationId) {
      return sendError(reply, "x-organization-id required", 400);
    }
    const body = request.body ?? {};
    const result = await resolveHubPayloadFields({
      organizationId,
      contactId: body.contactId ?? null,
      dealId: body.dealId ?? null,
      companyId: body.companyId ?? null,
      instruction: body.instruction ?? null,
      description: body.description ?? null,
      text: body.text ?? null,
      body: body.body ?? null,
      emails: Array.isArray(body.emails) ? body.emails : undefined,
    });
    return sendSuccess(reply, result);
  });
};
