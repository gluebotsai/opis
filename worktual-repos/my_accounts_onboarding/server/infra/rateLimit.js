import { getRedisClient } from "./redis.js";

const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_MAX_ATTEMPTS = 10;

const loginAttemptsByIp = new Map();

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return request.ip || request.socket?.remoteAddress || "unknown";
}

async function checkRedisRateLimit(key, maxAttempts, windowMs) {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pexpire(key, windowMs);
  }

  return count <= maxAttempts;
}

function checkMemoryRateLimit(ip, maxAttempts, windowMs) {
  const now = Date.now();
  let entry = loginAttemptsByIp.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    loginAttemptsByIp.set(ip, entry);
  }

  return entry.count < maxAttempts;
}

function recordMemoryFailedAttempt(ip, windowMs) {
  const now = Date.now();
  let entry = loginAttemptsByIp.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  entry.count += 1;
  loginAttemptsByIp.set(ip, entry);
}

export async function checkLoginRateLimit(request) {
  const ip = getClientIp(request);
  const key = `ratelimit:login:${ip}`;

  const redisAllowed = await checkRedisRateLimit(key, LOGIN_RATE_MAX_ATTEMPTS, LOGIN_RATE_WINDOW_MS);
  if (redisAllowed !== null) {
    return redisAllowed;
  }

  return checkMemoryRateLimit(ip, LOGIN_RATE_MAX_ATTEMPTS, LOGIN_RATE_WINDOW_MS);
}

export async function recordFailedLoginAttempt(request) {
  const ip = getClientIp(request);
  const key = `ratelimit:login:${ip}`;
  const redis = await getRedisClient();

  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, LOGIN_RATE_WINDOW_MS);
    }
    return;
  }

  recordMemoryFailedAttempt(ip, LOGIN_RATE_WINDOW_MS);
}

export { getClientIp };
