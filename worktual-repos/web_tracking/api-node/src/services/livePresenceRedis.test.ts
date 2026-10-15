import { describe, it, expect } from "node:test";
import type { Redis } from "ioredis";
import { getLiveFromRedis } from "./livePresenceRedis.js";

describe("getLiveFromRedis", () => {
  it("maps session hashes to live response shape", async () => {
    const nowMs = Date.now();
    const websiteId = 1011;
    const sessionId = "session_test";
    const hkey = `wt:live:${websiteId}:session:${sessionId}`;

    const hashByKey: Record<string, Record<string, string>> = {
      [hkey]: {
        visitor_id: "visitor_1",
        current_page: "/",
        country: "IN",
        last_activity_ms: String(nowMs),
      },
    };

    const pipelineStub = {
      hgetallCalls: [] as string[],
      hgetall(key: string) {
        this.hgetallCalls.push(key);
        return pipelineStub;
      },
      async exec() {
        return this.hgetallCalls.map((key) => [null, hashByKey[key] ?? {}]);
      },
    };

    const redis = {
      status: "ready",
      zremrangebyscore: async () => 0,
      zrevrange: async () => [sessionId],
      pipeline: () => ({
        hgetall: (key: string) => pipelineStub.hgetall(key),
        exec: () => pipelineStub.exec(),
      }),
    } as unknown as Redis;

    const snapshot = await getLiveFromRedis(redis, websiteId, 300);
    expect(snapshot.active_sessions).toBe(1);
    expect(snapshot.active_users).toBe(1);
    expect(snapshot.sessions[0]?.visitor_id).toBe("visitor_1");
    expect(snapshot.sessions[0]?.current_page).toBe("/");
  });

  it("keeps the latest session when two hashes share a visitor_id", async () => {
    const nowMs = Date.now();
    const websiteId = 1011;
    const older = "session_old";
    const newer = "session_new";
    const hashByKey: Record<string, Record<string, string>> = {
      [`wt:live:${websiteId}:session:${older}`]: {
        visitor_id: "visitor_1",
        current_page: "/",
        last_activity_ms: String(nowMs - 10_000),
      },
      [`wt:live:${websiteId}:session:${newer}`]: {
        visitor_id: "visitor_1",
        current_page: "/bag",
        last_activity_ms: String(nowMs),
      },
    };

    const pipelineStub = {
      hgetallCalls: [] as string[],
      hgetall(key: string) {
        this.hgetallCalls.push(key);
        return pipelineStub;
      },
      async exec() {
        return this.hgetallCalls.map((key) => [null, hashByKey[key] ?? {}]);
      },
    };

    const redis = {
      status: "ready",
      zremrangebyscore: async () => 0,
      zrevrange: async () => [newer, older],
      pipeline: () => ({
        hgetall: (key: string) => pipelineStub.hgetall(key),
        exec: () => pipelineStub.exec(),
      }),
    } as unknown as Redis;

    const snapshot = await getLiveFromRedis(redis, websiteId, 300);
    expect(snapshot.active_sessions).toBe(1);
    expect(snapshot.active_users).toBe(1);
    expect(snapshot.sessions.length).toBe(1);
    expect(snapshot.sessions[0]?.session_id).toBe(newer);
    expect(snapshot.sessions[0]?.current_page).toBe("/bag");
  });
});
