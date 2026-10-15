import type { FastifyReply, FastifyRequest } from "fastify";
import {
  resolveApiKeyBySecret,
  touchApiKeyLastUsed,
} from "@/dao/configuration/api-key-store";
import type { ApiKeyAuthContext } from "@/service/account/request-context";
import { sendError } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function isInternalAuthorized(request: FastifyRequest): boolean {
  const secret =
    process.env.ENRICH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers["x-internal-secret"] === secret;
}

function orgFromInternalRequest(request: FastifyRequest): string | null {
  const header = request.headers["x-organization-id"];
  return typeof header === "string" && header.trim() ? header.trim() : null;
}

export type AppointmentAuthContext = {
  organizationId: string;
  via: "internal" | "api_key";
  actorUserId: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    appointmentAuth?: AppointmentAuthContext | null;
  }
}

/**
 * Accept either CCaaS internal secret + x-organization-id or Bearer API key
 * with `appointments` scope.
 */
export async function requireAppointmentAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AppointmentAuthContext | null> {
  if (isInternalAuthorized(request)) {
    const organizationId = orgFromInternalRequest(request);
    if (!organizationId) {
      await sendError(reply, "x-organization-id required", 400);
      return null;
    }
    const ctx: AppointmentAuthContext = {
      organizationId,
      via: "internal",
      actorUserId: null,
    };
    request.appointmentAuth = ctx;
    request.crmApiKeyAuth = null;
    return ctx;
  }

  const token = readBearerToken(request);
  if (!token) {
    await sendError(reply, RESPONSE.unauthorized, 401);
    return null;
  }

  const resolved = await resolveApiKeyBySecret(token);
  if (!resolved) {
    await sendError(reply, "Invalid or revoked API key.", 401);
    return null;
  }

  if (!resolved.scopes.includes("appointments")) {
    await sendError(
      reply,
      'This API key is missing the "appointments" scope.',
      403,
    );
    return null;
  }

  const apiKeyAuth: ApiKeyAuthContext = {
    keyId: resolved.id,
    organizationId: resolved.organizationId,
    scopes: resolved.scopes,
  };
  request.crmApiKeyAuth = apiKeyAuth;
  void touchApiKeyLastUsed(resolved.id);

  const ctx: AppointmentAuthContext = {
    organizationId: resolved.organizationId,
    via: "api_key",
    actorUserId: resolved.createdByUserId,
  };
  request.appointmentAuth = ctx;
  return ctx;
}
