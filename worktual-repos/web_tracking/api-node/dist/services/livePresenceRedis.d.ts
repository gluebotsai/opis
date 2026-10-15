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
export declare function isRedisLiveReady(redis: Redis | null): redis is Redis;
/** Live Users hot path uses Redis only when REDIS_URL is set and connected. */
export declare function useRedisLivePresence(redisUrl: string | undefined, redis: Redis | null): redis is Redis;
export declare function getLiveFromRedis(redis: Redis, websiteId: number, windowSeconds?: number): Promise<LivePresenceSnapshot>;
