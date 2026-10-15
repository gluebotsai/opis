import { Redis } from "ioredis";

import { getRedisUrl, isRedisConfigured } from "./env.js";

let client: any = null;
let subscriber: any = null;

function createClient({ forSubscriber = false }: any = {}) {
  const url = getRedisUrl();
  const instance = new Redis(url, {
    maxRetriesPerRequest: forSubscriber ? null : 3,
    enableReadyCheck: true,
  });

  instance.on("error", (error: any) => {
    console.warn("[redis]", error instanceof Error ? error.message : error);
  });

  return instance;
}

export function isRedisEnabled() {
  return isRedisConfigured();
}

export async function getRedisClient() {
  if (!isRedisConfigured()) {
    return null;
  }

  if (!client) {
    client = createClient();
  }

  return client;
}

export async function getRedisSubscriber() {
  if (!isRedisConfigured()) {
    return null;
  }

  if (!subscriber) {
    subscriber = createClient({ forSubscriber: true });
  }

  return subscriber;
}

export async function pingRedis() {
  const redis = await getRedisClient();
  if (!redis) {
    return { ok: false, configured: false };
  }

  try {
    const pong = await redis.ping();
    return { ok: pong === "PONG", configured: true };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function closeRedis() {
  const closers: any[] = [];
  if (subscriber) {
    closers.push(subscriber.quit().catch(() => undefined));
    subscriber = null;
  }
  if (client) {
    closers.push(client.quit().catch(() => undefined));
    client = null;
  }
  await Promise.all(closers);
}
