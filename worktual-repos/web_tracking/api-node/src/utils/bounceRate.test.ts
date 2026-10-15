import { describe, it, expect } from "node:test";
import { bouncePageForSession, isSessionBounce } from "./bounceRate.js";

describe("bouncePageForSession", () => {
  it("returns entry page for a single-page bounce", () => {
    expect(
      bouncePageForSession({
        pageview_count: 1,
        duration_seconds: 5,
        entry_page: "/products/dress",
        exit_page: "/products/dress",
      }),
    ).toBe("/products/dress");
  });

  it("returns empty when not a bounce", () => {
    expect(
      bouncePageForSession({
        pageview_count: 3,
        duration_seconds: 120,
        entry_page: "/",
      }),
    ).toBe("");
  });

  it("matches isSessionBounce helper", () => {
    expect(isSessionBounce(1, 9)).toBe(true);
    expect(isSessionBounce(1, 10)).toBe(false);
  });
});
