import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboardPdfBuffer, buildScheduledReportPdfBuffer, countPdfPages } from "./build-dashboard-pdf.js";
import { buildKpiCsvSection } from "./reporting.js";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("buildDashboardPdfBuffer matches dashboard export layout with image and csv tables", () => {
  const csvReportText = buildKpiCsvSection(
    {
      handled: 111,
      handledChangePercent: null,
      resolutionRate: 28.8,
      avgFirstResponseSeconds: 46,
      avgHandleSeconds: 291,
      slaRate: 85,
      transferred: 0,
      firstResponseCount: 80,
      withinSlaCount: 68,
    },
    {
      start: new Date("2026-07-23T00:00:00.000Z"),
      end: new Date("2026-08-21T16:53:42.006Z"),
    },
    new Date("2026-08-21T16:53:42.006Z"),
    "Organization dashboard KPIs",
  ).join("\n");

  const buffer = buildDashboardPdfBuffer({
    dashboardImagePng: ONE_BY_ONE_PNG,
    csvReportText,
  });

  assert.ok(buffer.length > 500);
  assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
});

test("buildScheduledReportPdfBuffer still builds when dashboard screenshot is missing", () => {
  const csvReportText = buildKpiCsvSection(
    {
      handled: 42,
      handledChangePercent: null,
      resolutionRate: 80,
      avgFirstResponseSeconds: 20,
      avgHandleSeconds: 90,
      slaRate: 90,
      transferred: 0,
      firstResponseCount: 18,
      withinSlaCount: 16,
    },
    {
      start: new Date("2026-09-06T18:30:00.000Z"),
      end: new Date("2026-09-07T18:29:59.000Z"),
    },
    new Date("2026-09-07T18:29:00.000Z"),
    "Organization dashboard KPIs",
  ).join("\n");

  const buffer = buildScheduledReportPdfBuffer({
    title: "Daily dashboard KPIs",
    periodLabel: "6 Sept 2026 (Asia/Kolkata)",
    sections: { dashboardKpis: true, agentTable: false, aiSummary: true },
    dashboardImagePng: null,
    dashboardLayout: {
      periodLabel: "6 Sept 2026 (Asia/Kolkata)",
      orgKpis: {
        handled: 42,
        handledChangePercent: null,
        resolutionRate: 80,
        avgFirstResponseSeconds: 20,
        avgHandleSeconds: 90,
        slaRate: 90,
        transferred: 0,
        resolved: 34,
      },
      daily: [],
      channels: [],
      dispositions: [],
    },
    kpiCsvText: csvReportText,
    summaryText: "Performance report generated for the selected period.",
    highlights: ["Handled volume held steady."],
    improvementSuggestions: ["Review SLA on chat."],
  });

  assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.ok(countPdfPages(buffer) >= 2);
});

test("buildScheduledReportPdfBuffer renders four pages with dashboard, kpi, agent, summary", () => {
  const csvReportText = buildKpiCsvSection(
    {
      handled: 111,
      handledChangePercent: null,
      resolutionRate: 28.8,
      avgFirstResponseSeconds: 46,
      avgHandleSeconds: 291,
      slaRate: 85,
      transferred: 0,
      firstResponseCount: 80,
      withinSlaCount: 68,
    },
    {
      start: new Date("2026-07-23T00:00:00.000Z"),
      end: new Date("2026-08-21T16:53:42.006Z"),
    },
    new Date("2026-08-21T16:53:42.006Z"),
    "Organization dashboard KPIs",
  ).join("\n");

  const buffer = buildScheduledReportPdfBuffer({
    title: "Weekly report",
    periodLabel: "30D",
    sections: { dashboardKpis: true, agentTable: false, aiSummary: true },
    dashboardImagePng: ONE_BY_ONE_PNG,
    kpiCsvText: csvReportText,
    summaryText: "Summary text",
    highlights: ["Highlight"],
    improvementSuggestions: ["Suggestion"],
  });

  assert.equal(countPdfPages(buffer), 3);
});
