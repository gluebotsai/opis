import type { FastifyReply, FastifyRequest } from "fastify";
import { buildSessionFromCrmAccess } from "../../dao/crm-session.js";
import {
  sendSuccess,
  UnauthorizedError,
} from "../../helpers/response-builders.js";
import {
  isCrmJwtConfigured,
  verifyCrmAccessToken,
} from "../../services/crm-jwt.js";

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/**
 * POST /api/embed/session — CRM connect handshake.
 * Step 1: JWT verify → 401. Steps 2–6: user/org/product checks → 403. Success → 200 { ok: true }.
 */
export async function embedSessionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!isCrmJwtConfigured()) {
    throw new UnauthorizedError("CRM JWT is not configured on Campaign API.");
  }

  const token = extractBearerToken(request);
  if (!token) {
    throw new UnauthorizedError();
  }

  const userId = await verifyCrmAccessToken(token);
  const user = await buildSessionFromCrmAccess(userId);

  return sendSuccess(reply, "CRM embed session accepted.", {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      branchId: user.branchId,
    },
  });
}
