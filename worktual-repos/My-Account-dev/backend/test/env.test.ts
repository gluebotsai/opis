import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

const required = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/accounts",
  JWT_SECRET: "a-secure-test-secret-that-is-at-least-32-chars",
};

describe("parseEnv", () => {
  it("applies safe defaults and coercions", () => {
    const env = parseEnv({
      ...required,
      PORT: "4100",
    });
    expect(env.PORT).toBe(4100);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.DATABASE_SSL).toBe(false);
  });

  it("rejects an invalid port", () => {
    expect(() => parseEnv({ ...required, PORT: "70000" })).toThrow(/PORT/);
  });

  it("rejects weak JWT secrets", () => {
    expect(() => parseEnv({ ...required, JWT_SECRET: "short" })).toThrow(
      /JWT_SECRET/,
    );
  });
});
