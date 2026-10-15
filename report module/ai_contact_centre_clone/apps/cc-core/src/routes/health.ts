import type { FastifyInstance } from "fastify";

import { isRedisEnabled, pingRedis } from "../lib/redis-client.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  serviceName: string,
): Promise<void> {
  app.get("/health", async () => ({
    status: "ok" as const,
    service: serviceName,
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/ready", async () => {
    const redisRequired = Boolean(process.env.REDIS_URL?.trim());
    const redisOk = !redisRequired || (isRedisEnabled() && (await pingRedis()));

    return {
      status: redisOk ? ("ok" as const) : ("degraded" as const),
      service: serviceName,
      checks: {
        redis: redisRequired ? (redisOk ? "ok" : "unavailable") : "not_configured",
      },
      timestamp: new Date().toISOString(),
    };
  });
}
