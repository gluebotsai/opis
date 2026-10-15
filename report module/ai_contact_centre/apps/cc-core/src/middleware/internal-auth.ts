import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const INTERNAL_PREFIX = "/internal/v1";

function isInternalRoute(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  return path === INTERNAL_PREFIX || path.startsWith(`${INTERNAL_PREFIX}/`) || path.includes(`${INTERNAL_PREFIX}/`);
}

export function hasValidInternalServiceKey(request: FastifyRequest): boolean {
  const serviceKey = process.env.INTERNAL_SERVICE_KEY?.trim();
  const headerKey = request.headers["x-internal-service-key"];
  return Boolean(serviceKey && headerKey === serviceKey);
}

export function registerInternalAuth(app: FastifyInstance): void {
  app.decorate(
    "requireInternalService",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Trusted service key: tenant may be omitted (e.g. webchat context lookup
      // resolves organization_id from webchatId before it can send x-tenant-id).
      if (hasValidInternalServiceKey(request)) {
        const tenantId =
          (request.headers["x-tenant-id"] as string | undefined)?.trim() ||
          request.tenantId;
        if (tenantId) {
          request.tenantId = tenantId;
        }
        return;
      }

      // Non-prod unsigned: still require an explicit tenant — never invent one.
      if (process.env.NODE_ENV !== "production") {
        const tenantId =
          (request.headers["x-tenant-id"] as string | undefined)?.trim() ||
          request.tenantId;
        if (!tenantId) {
          return reply.status(401).send({
            error: "Unauthorized",
            message: "Missing x-tenant-id for internal request",
          });
        }
        request.tenantId = tenantId;
        return;
      }

      return reply.status(401).send({
        error: "Unauthorized",
        message: "Invalid internal service credentials",
      });
    },
  );
}

export function isInternalPublicRoute(url: string): boolean {
  return isInternalRoute(url);
}

declare module "fastify" {
  interface FastifyInstance {
    requireInternalService: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
