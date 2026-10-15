import type { FastifyInstance } from "fastify";
import { createTraceId, TRACE_HEADER } from "@ai-contact-center/observability";

export async function registerTraceContext(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    const traceId =
      (request.headers[TRACE_HEADER] as string | undefined) ?? createTraceId();
    request.traceId = traceId;
    reply.header(TRACE_HEADER, traceId);
  });
}

declare module "fastify" {
  interface FastifyRequest {
    traceId: string;
    tenantId?: string;
    userId?: string;
    userRole?: "admin" | "agent";
    accessToken?: string;
  }
}
