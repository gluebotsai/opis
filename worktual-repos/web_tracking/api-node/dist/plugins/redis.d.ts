import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";
declare module "fastify" {
    interface FastifyInstance {
        redis: Redis | null;
    }
}
export declare const redisPlugin: (app: FastifyInstance) => Promise<void>;
export declare function cacheGet(redis: Redis | null, key: string): Promise<string | null>;
export declare function cacheSet(redis: Redis | null, key: string, value: string, ttlSeconds: number): Promise<void>;
