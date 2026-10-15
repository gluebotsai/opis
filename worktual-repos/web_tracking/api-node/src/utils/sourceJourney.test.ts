import { describe, it, expect } from "node:test";
import { buildSourceJourney } from "./attributionUtils.js";

describe("buildSourceJourney", () => {
  it("orders sessions by started_at and collapses adjacent duplicate sources", () => {
    const journey = buildSourceJourney([
      {
        started_at: "2026-01-03T10:00:00Z",
        utm_source: "google",
        utm_medium: "cpc",
      },
      {
        started_at: "2026-01-01T10:00:00Z",
        referrer: null,
      },
      {
        started_at: "2026-01-02T10:00:00Z",
        utm_source: "newsletter",
        utm_medium: "email",
      },
      {
        started_at: "2026-01-04T10:00:00Z",
        referrer: null,
      },
    ]);

    expect(journey.steps.map((s) => s.source_label)).toEqual([
      "Direct",
      "Newsletter Email",
      "Google Ads",
      "Direct",
    ]);
    expect(journey.steps[0]?.session_count).toBe(1);
    expect(journey.steps[3]?.session_count).toBe(1);
    expect(journey.path_label).toContain("Direct");
    expect(journey.path_label.split(" → ").length).toBe(4);
  });

  it("merges consecutive sessions with the same source label", () => {
    const journey = buildSourceJourney([
      { started_at: "2026-01-01T10:00:00Z", referrer: null },
      { started_at: "2026-01-02T10:00:00Z", referrer: null },
      { started_at: "2026-01-03T10:00:00Z", utm_source: "google", utm_medium: "cpc" },
    ]);

    expect(journey.steps).toHaveLength(2);
    expect(journey.steps[0]?.session_count).toBe(2);
    expect(journey.steps[0]?.source_label).toBe("Direct");
  });

  it("returns empty path when there are no sessions", () => {
    expect(buildSourceJourney([])).toEqual({ steps: [], path_label: "—" });
  });
});
