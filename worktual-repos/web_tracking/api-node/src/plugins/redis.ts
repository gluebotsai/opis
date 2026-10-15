import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis | null;
  }
}

export const redisPlugin = fp(async function redisPlugin(app: FastifyInstance) {
  const redis = env.REDIS_URL
    ? new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: true,
      })
    : null;
  if (redis) {
    redis.on("error", (err) => {
      app.log.warn({ err }, "Redis unavailable; analytics cache disabled");
    });
    try {
      await redis.connect();
    } catch (err) {
      app.log.warn({ err }, "Redis connect failed; analytics cache disabled");
    }
  }
  app.decorate("redis", redis);
  app.addHook("onClose", async () => {
    if (redis) await redis.quit();
  });
});

export async function cacheGet(redis: Redis | null, key: string): Promise<string | null> {
  if (!redis || redis.status !== "ready") return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(redis: Redis | null, key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!redis || redis.status !== "ready") return;
  try {
    await redis.setex(key, ttlSeconds, value);
  } catch {
    // Cache is optional; skip write when Redis is down.
  }
}
