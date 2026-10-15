import Redis from "ioredis";

let client: Redis | null = null;

export function setRedisClient(redis: Redis | null): void {
  client = redis;
}

export function getRedisClient(): Redis | null {
  return client;
}

export function isRedisEnabled(): boolean {
  return client !== null;
}

export async function createRedisClient(url: string): Promise<Redis> {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectTimeout: 5_000,
    commandTimeout: 2_000,
  });
  await redis.connect();
  return redis;
}

export async function createRedisSubscriber(url: string): Promise<Redis> {
  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 5_000,
  });
  await redis.connect();
  return redis;
}

export async function createRedisStreamClient(url: string): Promise<Redis> {
  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 5_000,
  });
  await redis.connect();
  return redis;
}

export async function pingRedis(): Promise<boolean> {
  if (!client) return false;
  try {
    const result = await client.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}
