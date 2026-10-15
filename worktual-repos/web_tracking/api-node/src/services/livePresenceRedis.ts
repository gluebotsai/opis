import type { Redis } from "ioredis";

export interface LivePresenceSessionRow {
  session_id: string;
  visitor_id: string;
  current_page: string;
  current_page_ts?: number;
  country: string;
  last_activity: string;
}

export interface LivePresenceSnapshot {
  active_users: number;
  active_sessions: number;
  sessions: LivePresenceSessionRow[];
}

function sessionsZKey(websiteId: number): string {
  return `wt:live:${websiteId}:sessions`;
}

function sessionHashKey(websiteId: number, sessionId: string): string {
  return `wt:live:${websiteId}:session:${sessionId}`;
}

function msToIso(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return new Date().toISOString();
  return new Date(ms).toISOString();
}

export function isRedisLiveReady(redis: Redis | null): redis is Redis {
  return redis != null && redis.status === "ready";
}

/** Live Users hot path uses Redis only when REDIS_URL is set and connected. */
export function useRedisLivePresence(
  redisUrl: string | undefined,
  redis: Redis | null,
): redis is Redis {
  return Boolean(redisUrl?.trim()) && isRedisLiveReady(redis);
}

export async function getLiveFromRedis(
  redis: Redis,
  websiteId: number,
  windowSeconds = 300,
): Promise<LivePresenceSnapshot> {
  const zkey = sessionsZKey(websiteId);
  const nowMs = Date.now();
  const cutoff = nowMs - windowSeconds * 1000;

  await redis.zremrangebyscore(zkey, "-inf", cutoff);
  const members = await redis.zrevrange(zkey, 0, -1);

  if (!members.length) {
    return { active_users: 0, active_sessions: 0, sessions: [] };
  }

  const pipeline = redis.pipeline();
  for (const sessionId of members) {
    pipeline.hgetall(sessionHashKey(websiteId, sessionId));
  }
  const results = await pipeline.exec();

  const sessions: LivePresenceSessionRow[] = [];
  for (let i = 0; i < members.length; i += 1) {
    const sessionId = members[i];
    const entry = results?.[i];
    const err = entry?.[0];
    const hash = (entry?.[1] ?? {}) as Record<string, string>;
    if (err || !hash.visitor_id) continue;

    const lastMs = Number(hash.last_activity_ms ?? 0);
    if (lastMs > 0 && lastMs < cutoff) continue;

    const pageTs = Number(hash.current_page_ts ?? 0);
    sessions.push({
      session_id: sessionId,
      visitor_id: String(hash.visitor_id).trim(),
      current_page: hash.current_page || "/",
      current_page_ts: Number.isFinite(pageTs) ? pageTs : 0,
      country: hash.country || "",
      last_activity: msToIso(lastMs),
    });
  }

  sessions.sort((a, b) => b.last_activity.localeCompare(a.last_activity));

  const unique: LivePresenceSessionRow[] = [];
  const seenVisitors = new Set<string>();
  for (const row of sessions) {
    if (seenVisitors.has(row.visitor_id)) continue;
    seenVisitors.add(row.visitor_id);
    unique.push(row);
  }

  return {
    active_users: seenVisitors.size,
    active_sessions: unique.length,
    sessions: unique,
  };
}
