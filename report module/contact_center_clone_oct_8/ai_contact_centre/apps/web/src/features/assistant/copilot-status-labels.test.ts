import { describe, expect, it, vi } from "vitest";

import {
  createStatusPresenter,
  resolveCopilotStatusLabel,
  routingStatusLabelForPath,
} from "./copilot-status-labels";

describe("routingStatusLabelForPath", () => {
  it("maps destinations to page-specific routing copy", () => {
    expect(routingStatusLabelForPath("/admin/monitoring")).toMatch(/live monitoring/i);
    expect(routingStatusLabelForPath("/admin/contacts")).toMatch(/contacts/i);
    expect(routingStatusLabelForPath("/admin/workforce/queues")).toMatch(/queues/i);
    expect(routingStatusLabelForPath("/agent/tasks")).toMatch(/tasks/i);
    expect(routingStatusLabelForPath("/admin/dashboard")).toMatch(/dashboard/i);
  });
});

describe("resolveCopilotStatusLabel", () => {
  it("uses polished phase labels", () => {
    expect(resolveCopilotStatusLabel({ phase: "semantic_layer" })).toMatch(/semantic layer/i);
    expect(resolveCopilotStatusLabel({ phase: "kpi" })).toMatch(/KPI/i);
    expect(resolveCopilotStatusLabel({ phase: "writing" })).toMatch(/Generating response/i);
    expect(resolveCopilotStatusLabel({ phase: "charting" })).toMatch(/Constructing the chart/i);
  });

  it("preserves live ontology progress labels", () => {
    expect(
      resolveCopilotStatusLabel({
        phase: "concepts",
        label: "Found: Missed Contacts, Abandonment Rate",
      }),
    ).toBe("Found: Missed Contacts, Abandonment Rate");
  });
});

describe("createStatusPresenter", () => {
  it("replaces labels after dwell and skips duplicates", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const presenter = createStatusPresenter((label) => seen.push(label), 1000);

    presenter.enqueue("Understanding your question…");
    presenter.enqueue("Utilizing the semantic layer…");
    presenter.enqueue("Utilizing the semantic layer…");

    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(["Understanding your question…"]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([
      "Understanding your question…",
      "Utilizing the semantic layer…",
    ]);

    presenter.replaceNow("Ready when you are");
    expect(seen.at(-1)).toBe("Ready when you are");
    vi.useRealTimers();
  });

  it("stop hides the chip and ignores later enqueues", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const presenter = createStatusPresenter((label) => seen.push(label), 1000);

    presenter.enqueue("Utilizing the semantic layer…");
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.at(-1)).toBe("Utilizing the semantic layer…");

    presenter.stop();
    expect(seen.at(-1)).toBe("");

    presenter.enqueue("Generating response…");
    presenter.replaceNow("Generating response…");
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen.filter((label) => label === "Generating response…")).toHaveLength(0);
    vi.useRealTimers();
  });
});
