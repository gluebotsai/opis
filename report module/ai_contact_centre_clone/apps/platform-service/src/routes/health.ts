import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(
  app: FastifyInstance,
  serviceName: string,
): Promise<void> {
  app.get("/health", async () => ({
    status: "ok" as const,
    service: serviceName,
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/ready", async () => ({
    status: "ok" as const,
    service: serviceName,
    timestamp: new Date().toISOString(),
  }));
}
