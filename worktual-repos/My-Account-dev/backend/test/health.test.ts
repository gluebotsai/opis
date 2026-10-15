import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { getHealth } from "../src/modules/health/service.js";

describe("health service", () => {
  it("reports healthy Postgres and disabled optional Redis", async () => {
    const app = {
      pg: { query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) },
      redis: null,
    } as unknown as FastifyInstance;

    const result = await getHealth(app);
    expect(result.status).toBe("ok");
    expect(result.checks).toEqual({ postgres: "up", redis: "disabled" });
  });

  it("degrades when a dependency is unavailable", async () => {
    const app = {
      pg: { query: vi.fn().mockRejectedValue(new Error("offline")) },
      redis: null,
    } as unknown as FastifyInstance;

    const result = await getHealth(app);
    expect(result.status).toBe("degraded");
    expect(result.checks.postgres).toBe("down");
  });
});
