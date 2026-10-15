import { Redis } from "ioredis";
import { env } from "../config/env.js";

type MemoryStore = Map<string, { value: string; expiresAt?: number }>;

const memory: MemoryStore = new Map();

let redis: Redis | null = null;
let redisReady = false;

export function getRedis(): Redis | null {
  return redisReady ? redis : null;
}

export async function initRedis(): Promise<"redis" | "memory"> {
  try {
    redis = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 1500,
    });
    await redis.connect();
    await redis.ping();
    redisReady = true;
    return "redis";
  } catch {
    redisReady = false;
    if (redis) {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
    }
    redis = null;
    return "memory";
  }
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  if (redisReady && redis) {
    if (ttlSeconds) await redis.set(key, value, "EX", ttlSeconds);
    else await redis.set(key, value);
    return;
  }
  memory.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
  });
}

export async function cacheGet(key: string): Promise<string | null> {
  if (redisReady && redis) {
    return redis.get(key);
  }
  const row = memory.get(key);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return row.value;
}

export async function cacheDel(key: string): Promise<void> {
  if (redisReady && redis) {
    await redis.del(key);
    return;
  }
  memory.delete(key);
}
