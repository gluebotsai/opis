import type { FastifyPluginAsync } from "fastify";
import { sendSuccess } from "../../helpers/response.js";
import { RESPONSE } from "../../helpers/constants.js";
import { getPrismaClient } from "@/dao/db/prisma";
import { getRedisPublisher, isRedisConfigured } from "@/lib/redis";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    return sendSuccess(
      reply,
      {
        service: "worktual-crm-api",
        ts: new Date().toISOString(),
      },
      RESPONSE.success_message,
    );
  });

  app.get("/ready", async (_request, reply) => {
    const checks: Record<string, "ok" | "disabled" | "unavailable"> = {
      database: "unavailable",
      aiService: process.env.AI_SERVICE_BASE_URL ? "unavailable" : "disabled",
      redis: isRedisConfigured() ? "unavailable" : "disabled",
    };
    await Promise.all([
      getPrismaClient()
        .$queryRawUnsafe("SELECT 1")
        .then(() => {
          checks.database = "ok";
        })
        .catch(() => undefined),
      (async () => {
        const base = process.env.AI_SERVICE_BASE_URL?.trim().replace(/\/$/, "");
        if (!base) return;
        try {
          const response = await fetch(`${base}/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          checks.aiService = response.ok ? "ok" : "unavailable";
        } catch {
          checks.aiService = "unavailable";
        }
      })(),
      (async () => {
        const redis = getRedisPublisher();
        if (!redis) return;
        try {
          checks.redis = (await redis.ping()) === "PONG" ? "ok" : "unavailable";
        } catch {
          checks.redis = "unavailable";
        }
      })(),
    ]);
    const ready = checks.database === "ok" &&
      checks.aiService !== "unavailable" &&
      checks.redis !== "unavailable";
    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      service: "worktual-crm-api",
      checks,
    });
  });
};
