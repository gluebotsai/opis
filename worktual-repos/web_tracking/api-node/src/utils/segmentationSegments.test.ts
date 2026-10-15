import { describe, it, expect } from "node:test";
import { buildVisitorSegments } from "./segmentationSegments.js";

describe("buildVisitorSegments", () => {
  it("computes percentages that sum to 100", () => {
    const segments = buildVisitorSegments([
      { label: "A", visitors: 30 },
      { label: "B", visitors: 70 },
    ]);
    expect(segments[0]?.percentage).toBe(30);
    expect(segments[1]?.percentage).toBe(70);
  });
});
