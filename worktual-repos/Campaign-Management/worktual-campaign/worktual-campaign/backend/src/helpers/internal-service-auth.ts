import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { UnauthorizedError } from "./response-builders.js";
import { RESPONSE } from "./constants.js";

/** Fail closed when INTERNAL_SERVICE_KEY is unset or header mismatch. */
export function requireInternalServiceKey(request: FastifyRequest): void {
  const expected = env.social.internalServiceKey;
  if (!expected) {
    throw new UnauthorizedError(RESPONSE.onboarding_internal_key_required);
  }
  const provided =
    (request.headers["x-internal-service-key"] as string | undefined)?.trim() ||
    "";
  if (!provided || provided !== expected) {
    throw new UnauthorizedError(RESPONSE.onboarding_internal_key_required);
  }
}

/**
 * CRM monitor/agent Personalised CRM — dedicated key, not JWT and not INTERNAL_SERVICE_KEY.
 * Accept X-Crm-Integration-Key or Authorization: Bearer <same key>.
 */
export function requireCrmIntegrationKey(request: FastifyRequest): void {
  const expected = env.crmIntegrationKey;
  if (!expected) {
    throw new UnauthorizedError(RESPONSE.crm_integration_key_required);
  }
  const header =
    (request.headers["x-crm-integration-key"] as string | undefined)?.trim() ||
    "";
  const auth = request.headers.authorization;
  const bearer =
    auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const provided = header || bearer;
  if (!provided || provided !== expected) {
    throw new UnauthorizedError(RESPONSE.crm_integration_key_required);
  }
}
