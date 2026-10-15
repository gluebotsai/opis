import type { FastifyInstance } from "fastify";
import type { HealthStatus } from "./types.js";

export async function getHealth(app: FastifyInstance): Promise<HealthStatus> {
  let postgres: HealthStatus["checks"]["postgres"] = "up";
  let redis: HealthStatus["checks"]["redis"] = app.redis ? "up" : "disabled";

  try {
    await app.pg.query("select 1");
  } catch {
    postgres = "down";
  }
  if (app.redis) {
    try {
      await app.redis.ping();
    } catch {
      redis = "down";
    }
  }

  return {
    status: postgres === "up" && redis !== "down" ? "ok" : "degraded",
    service: "my-accounts-api",
    timestamp: new Date().toISOString(),
    checks: { postgres, redis },
  };
}
