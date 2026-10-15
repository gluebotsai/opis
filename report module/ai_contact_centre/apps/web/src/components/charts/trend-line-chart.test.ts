import { describe, expect, it } from "vitest";

import {
  defaultSeriesColor,
  groupTrendLineSeries,
  resolveSeriesColors,
} from "./trend-line-chart";

describe("groupTrendLineSeries", () => {
  it("keeps a single series when channel is missing", () => {
    const grouped = groupTrendLineSeries([
      { label: "2 Sept", value: 7 },
      { label: "3 Sept", value: 4 },
    ]);
    expect(grouped.isMulti).toBe(false);
    expect(grouped.labels).toEqual(["2 Sept", "3 Sept"]);
  });

  it("collapses duplicate dates into one x tick per channel line", () => {
    const grouped = groupTrendLineSeries([
      { label: "2 Sept", value: 7, series: "Webchat" },
      { label: "3 Sept", value: 4, series: "Webchat" },
      { label: "3 Sept", value: 2, series: "Email" },
      { label: "5 Sept", value: 1, series: "Webchat" },
    ]);
    expect(grouped.isMulti).toBe(true);
    expect(grouped.labels).toEqual(["2 Sept", "3 Sept", "5 Sept"]);
    expect(grouped.seriesNames).toEqual(["Webchat", "Email"]);
    expect(grouped.grid.get("Webchat")).toEqual([7, 4, 1]);
    expect(grouped.grid.get("Email")).toEqual([0, 2, 0]);
  });
});

describe("resolveSeriesColors", () => {
  it("gives each channel its own stroke", () => {
    const colors = resolveSeriesColors(["Webchat", "Email", "WhatsApp"]);
    expect(new Set(colors).size).toBe(3);
    expect(defaultSeriesColor("Webchat", 0)).toBe("#3b82f6");
    expect(defaultSeriesColor("Email", 1)).toBe("#f59e0b");
    expect(defaultSeriesColor("WhatsApp", 2)).toBe("#8b5cf6");
  });

  it("does not reuse a color when two names would collide", () => {
    const colors = resolveSeriesColors(["Webchat", "Live chat"]);
    expect(colors[0]).not.toBe(colors[1]);
  });
});
