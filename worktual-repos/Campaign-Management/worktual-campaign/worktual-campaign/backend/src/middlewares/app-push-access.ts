import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveOrganizationIdFromApiKey } from "../dao/org-api-key.js";
import { resolveAccessSession } from "./authendication.js";
import type { CampaignSessionUser } from "../types/auth.js";
import { UnauthorizedError } from "../helpers/response-builders.js";

function readApiKey(request: FastifyRequest): string {
  const header =
    (request.headers["x-api-key"] as string | undefined)?.trim() ||
    (request.headers["x-api_key"] as string | undefined)?.trim() ||
    "";
  if (header) return header;
  const auth = (request.headers.authorization as string | undefined)?.trim();
  if (auth?.toLowerCase().startsWith("bearer wk_ap_")) {
    return auth.slice(7).trim();
  }
  return "";
}

export function integrationSessionForOrg(
  organizationId: string,
): CampaignSessionUser {
  const org = String(organizationId || "").trim();
  return {
    id: "integration",
    email: "integration@api-key.local",
    name: "App push integration",
    role: "integration",
    initials: "AP",
    organizationId: org,
    branchId: org,
    orgName: "",
    mode: "b2b",
    industry: "generic-b2b",
    businessType: "B2B",
    industryType: null,
  };
}

/** App push routes: org API key or Campaign user JWT. */
export async function validateAppPushAccess(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const apiKey = readApiKey(request);
  if (apiKey) {
    const organizationId = await resolveOrganizationIdFromApiKey(apiKey);
    if (!organizationId) {
      throw new UnauthorizedError();
    }
    request.userSession = integrationSessionForOrg(organizationId);
    return;
  }
  request.userSession = await resolveAccessSession(request);
}
