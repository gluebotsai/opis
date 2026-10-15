import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
const KEY_PREFIX = "wt:onboarding:";
const memoryStore = new Map();
function codeDigest(code) {
    return createHash("sha256").update(code, "utf8").digest("hex");
}
function redisKey(digest) {
    return `${KEY_PREFIX}${digest}`;
}
function purgeExpiredMemory() {
    const now = Date.now();
    for (const [key, entry] of memoryStore) {
        if (entry.expiresAtMs <= now)
            memoryStore.delete(key);
    }
}
export function generateOnboardingCode() {
    return randomBytes(32).toString("base64url");
}
export async function storeOnboardingCode(redis, code, payload) {
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
export async function consumeOnboardingCode(redis, code) {
    const digest = codeDigest(code);
    if (redis && redis.status === "ready") {
        try {
            const raw = await redis.getdel(redisKey(digest));
            if (!raw)
                return null;
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    purgeExpiredMemory();
    const entry = memoryStore.get(digest);
    if (!entry)
        return null;
    memoryStore.delete(digest);
    if (entry.expiresAtMs <= Date.now())
        return null;
    return entry.payload;
}
