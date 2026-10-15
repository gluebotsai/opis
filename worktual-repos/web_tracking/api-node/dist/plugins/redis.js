import { Redis } from "ioredis";
import fp from "fastify-plugin";
import { env } from "../config/env.js";
export const redisPlugin = fp(async function redisPlugin(app) {
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
        }
        catch (err) {
            app.log.warn({ err }, "Redis connect failed; analytics cache disabled");
        }
    }
    app.decorate("redis", redis);
    app.addHook("onClose", async () => {
        if (redis)
            await redis.quit();
    });
});
export async function cacheGet(redis, key) {
    if (!redis || redis.status !== "ready")
        return null;
    try {
        return await redis.get(key);
    }
    catch {
        return null;
    }
}
export async function cacheSet(redis, key, value, ttlSeconds) {
    if (!redis || redis.status !== "ready")
        return;
    try {
        await redis.setex(key, ttlSeconds, value);
    }
    catch {
        // Cache is optional; skip write when Redis is down.
    }
}
