import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { env } from "../config/env.js";

export type OnboardingCodePayload = {
  userId: number;
  organizationId: number;
  websiteId: number;
};

const KEY_PREFIX = "wt:onboarding:";

type MemoryEntry = { payload: OnboardingCodePayload; expiresAtMs: number };

const memoryStore = new Map<string, MemoryEntry>();

function codeDigest(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function redisKey(digest: string): string {
  return `${KEY_PREFIX}${digest}`;
}

function purgeExpiredMemory(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAtMs <= now) memoryStore.delete(key);
  }
}

export function generateOnboardingCode(): string {
  return randomBytes(32).toString("base64url");
}

export async function storeOnboardingCode(
  redis: Redis | null,
  code: string,
  payload: OnboardingCodePayload,
): Promise<void> {
  const ttl = env.ONBOARDING_CODE_TTL_SECONDS;
  const digest = codeDigest(code);
  const value = JSON.stringify(payload);

  if (redis && redis.status === "ready") {
    await redis.setex(redisKey(digest), ttl, value);
    return;
  }

  purgeExpiredMemory();
  memoryStore.set(digest, {
    payload,
    expiresAtMs: Date.now() + ttl * 1000,
  });
}

export async function consumeOnboardingCode(
  redis: Redis | null,
  code: string,
): Promise<OnboardingCodePayload | null> {
  const digest = codeDigest(code);

  if (redis && redis.status === "ready") {
    try {
      const raw = await redis.getdel(redisKey(digest));
      if (!raw) return null;
      return JSON.parse(raw) as OnboardingCodePayload;
    } catch {
      return null;
    }
  }

  purgeExpiredMemory();
  const entry = memoryStore.get(digest);
  if (!entry) return null;
  memoryStore.delete(digest);
  if (entry.expiresAtMs <= Date.now()) return null;
  return entry.payload;
}
