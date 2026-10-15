/**
 * One-time onboarding dashboard codes (Accounts mint → CRM exchange).
 * Redis when REDIS_URL is up; in-process Map otherwise (dev / Redis down).
 */

import { createHash, randomBytes } from "crypto";
import { getRedisPublisher } from "@/lib/redis";

export const ONBOARDING_CODE_TTL_SECONDS = 900;

const KEY_PREFIX = "crm:onboarding-link:";
const memory = new Map<string, { userId: string; expiresAt: number }>();

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function redisKey(code: string): string {
  return `${KEY_PREFIX}${hashCode(code)}`;
}

export function generateOnboardingCode(): string {
  return randomBytes(32).toString("base64url");
}

export async function saveOnboardingCode(
  code: string,
  userId: string,
): Promise<void> {
  const key = redisKey(code);
  const payload = JSON.stringify({ userId });
  const redis = getRedisPublisher();
  if (redis) {
    try {
      await redis.set(key, payload, "EX", ONBOARDING_CODE_TTL_SECONDS);
      return;
    } catch (err) {
      console.warn("onboarding code redis set failed", err);
    }
  }
  memory.set(key, {
    userId,
    expiresAt: Date.now() + ONBOARDING_CODE_TTL_SECONDS * 1000,
  });
}

export async function consumeOnboardingCode(
  code: string,
): Promise<string | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const key = redisKey(trimmed);
  const redis = getRedisPublisher();
  if (redis) {
    try {
      const raw = await redisGetDel(redis, key);
      if (raw) {
        const parsed = JSON.parse(raw) as { userId?: string };
        return parsed.userId?.trim() || null;
      }
    } catch (err) {
      console.warn("onboarding code redis getdel failed", err);
    }
  }
  const row = memory.get(key);
  if (!row) return null;
  memory.delete(key);
  if (row.expiresAt < Date.now()) return null;
  return row.userId;
}

async function redisGetDel(
  redis: NonNullable<ReturnType<typeof getRedisPublisher>>,
  key: string,
): Promise<string | null> {
  const getdel = (
    redis as { getdel?: (k: string) => Promise<string | null> }
  ).getdel;
  if (typeof getdel === "function") {
    return (await getdel.call(redis, key)) ?? null;
  }
  const tx = await redis.multi().get(key).del(key).exec();
  const getResult = tx?.[0];
  if (!getResult) return null;
  const [err, value] = getResult;
  if (err) throw err;
  return typeof value === "string" ? value : null;
}
