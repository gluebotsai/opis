import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getApiV1Bases, joinApiV1 } from "@ai-contact-center/api-paths";

import { verifyAccessToken } from "../lib/jwt.js";
import { isAuthSessionActive } from "../services/auth-sessions.js";

function getPublicPrefixes(): string[] {
  return [
    "/health",
    "/docs",
    ...getApiV1Bases().flatMap((base) => [
      joinApiV1(base, "/auth/login"),
      joinApiV1(base, "/auth/onboarding-dashboard-link"),
      joinApiV1(base, "/auth/onboarding-exchange"),
      joinApiV1(base, "/public/webchat"),
      joinApiV1(base, "/public/reports"),
    ]),
  ];
}

function isPublicRoute(url: string): boolean {
  return getPublicPrefixes().some((prefix) => url.startsWith(prefix));
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  app.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (isPublicRoute(request.url)) {
        return;
      }

      const header = request.headers.authorization;
      const jwtSecret = process.env.JWT_SECRET;

      if (header?.startsWith("Bearer ") && jwtSecret) {
        const token = header.slice("Bearer ".length);
        const payload = verifyAccessToken(token, jwtSecret);
        if (!payload) {
          return reply.status(401).send({ error: "Unauthorized", message: "Invalid or expired token" });
        }
        const sessionActive = await isAuthSessionActive(app.prisma, token);
        if (!sessionActive) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Session expired or signed out. Please sign in again.",
          });
        }
        request.tenantId = payload.tenant_id;
        request.userId = payload.sub;
        request.userRole = payload.role;
        request.accessToken = token;
        return;
      }

      // Non-prod: allow header auth for local tooling — never invent a default org.
      if (process.env.NODE_ENV !== "production") {
        const tenantId = request.headers["x-tenant-id"] as string | undefined;
        const userId = request.headers["x-user-id"] as string | undefined;
        if (!tenantId?.trim()) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Missing bearer token or x-tenant-id",
          });
        }
        request.tenantId = tenantId.trim();
        request.userId = userId?.trim() || "system";
        const devRole = request.headers["x-user-role"];
        if (devRole === "admin" || devRole === "agent") {
          request.userRole = devRole;
        }
        return;
      }

      return reply.status(401).send({ error: "Unauthorized", message: "Missing bearer token" });
    },
  );
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
