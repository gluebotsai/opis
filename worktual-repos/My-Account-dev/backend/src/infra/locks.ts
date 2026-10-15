import { getRedisClient, isRedisEnabled } from "./redis.js";

const localLocks = new Map();

function sleep(ms: any) {
  return new Promise((resolve: any) => setTimeout(resolve, ms));
}

async function acquireLocalLock(key: any, ttlMs: any) {
  const now = Date.now();
  const existing = localLocks.get(key);
  if (existing && existing.expiresAt > now) {
    return false;
  }

  localLocks.set(key, { expiresAt: now + ttlMs });
  return true;
}

function releaseLocalLock(key: any) {
  localLocks.delete(key);
}

/**
 * Acquire a distributed lock. Falls back to in-process lock when Redis is unavailable.
 */
export async function withLock(key: any, fn: any, { ttlSeconds = 30, waitMs = 5000, retryMs = 100 }: any = {}) {
  const redis = await getRedisClient();
  const lockKey = `lock:${key}`;
  const token = `${Date.now()}-${Math.random()}`;
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    let acquired = false;

    if (redis) {
      const result = await redis.set(lockKey, token, "EX", ttlSeconds, "NX");
      acquired = result === "OK";
    } else {
      acquired = await acquireLocalLock(lockKey, ttlSeconds * 1000);
    }

    if (acquired) {
      try {
        return await fn();
      } finally {
        if (redis) {
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            end
            return 0
          `;
          await redis.eval(script, 1, lockKey, token);
        } else {
          releaseLocalLock(lockKey);
        }
      }
    }

    await sleep(retryMs);
  }

  throw new Error(`Could not acquire lock: ${key}`);
}

export function lockAvailable() {
  return isRedisEnabled() || true;
}
