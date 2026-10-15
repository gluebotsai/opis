/**
 * Optional Redis client for low-latency pub/sub (meeting-assist live events).
 * When REDIS_URL is unset or Redis is down, callers fall back to in-process only.
 */

import Redis from "ioredis";

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let initAttempted = false;

function redisUrl(): string {
  return (process.env.REDIS_URL || "").trim();
}

export function isRedisConfigured(): boolean {
  return Boolean(redisUrl());
}

export function getRedisPublisher(): Redis | null {
  ensureRedis();
  return publisher;
}

export function getRedisSubscriber(): Redis | null {
  ensureRedis();
  return subscriber;
}

function ensureRedis(): void {
  if (initAttempted) return;
  initAttempted = true;
  const url = redisUrl();
  if (!url) return;

  try {
    publisher = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });
    subscriber = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });
    publisher.on("error", (err) => {
      console.warn("Redis publisher error", err.message);
    });
    subscriber.on("error", (err) => {
      console.warn("Redis subscriber error", err.message);
    });
  } catch (err) {
    console.warn("Redis init failed", err);
    publisher = null;
    subscriber = null;
  }
}

export async function redisPublish(
  channel: string,
  payload: string,
): Promise<boolean> {
  const client = getRedisPublisher();
  if (!client) return false;
  try {
    await client.publish(channel, payload);
    return true;
  } catch (err) {
    console.warn("Redis publish failed", err);
    return false;
  }
}

/**
 * Per-viewer partitioned channel — `viewerKey` defaults to the broadcast
 * pseudo-viewer `"*"` (today's single-shared-panel behavior). A future
 * Internal Meeting Assist multi-recipient delivery can target one
 * attendee's own panel by passing their resolved viewer id instead, without
 * any other viewer's subscription ever seeing that payload — filtering
 * happens server-side at publish time, never client-side on a multiplexed
 * all-viewers payload.
 */
export function meetingAssistLiveChannel(
  sessionId: string,
  viewerKey: string = "*",
): string {
  return `meeting-assist:live:${sessionId.trim()}:${viewerKey.trim() || "*"}`;
}
