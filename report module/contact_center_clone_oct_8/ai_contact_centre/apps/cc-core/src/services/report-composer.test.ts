import assert from "node:assert/strict";
import test from "node:test";

import { composeScheduledReportPdf } from "./report-composer.js";
import { buildAgentCsvSection, buildKpiCsvSection } from "./reporting.js";
import { countPdfPages } from "./build-dashboard-pdf.js";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SAMPLE_AGENT_ROWS = [
  {
    name: "Priya Sharma",
    presentDays: 5,
    readyHours: 32,
    readyPresenceHours: 28,
    busyPresenceHours: 6,
    notReadyPresenceHours: 2,
    breakPresenceHours: 1,
    dominantPresence: "Ready",
    handled: 42,
    resolutionRate: 88,
    avgHandleMinutes: 4.2,
    slaRate: 91,
    transferred: 1,
  },
  {
    name: "Alex Johnson",
    presentDays: 4,
    readyHours: 24,
    readyPresenceHours: 18,
    busyPresenceHours: 8,
    notReadyPresenceHours: 4,
    breakPresenceHours: 2,
    dominantPresence: "Busy",
    handled: 31,
    resolutionRate: 72,
    avgHandleMinutes: 6.1,
    slaRate: 68,
    transferred: 3,
  },
];

test("composeScheduledReportPdf produces four pages for full report", async () => {
  const exportedAt = new Date("2026-08-21T16:53:42.006Z");
  const kpiCsvText = buildKpiCsvSection(
    {
      handled: 111,
      handledChangePercent: 12.5,
      resolutionRate: 28.8,
      avgFirstResponseSeconds: 46,
      avgHandleSeconds: 291,
      slaRate: 85,
      transferred: 0,
      firstResponseCount: 80,
      withinSlaCount: 68,
    },
    {
      start: new Date("2026-08-20T00:00:00.000Z"),
      end: new Date("2026-08-20T23:59:59.000Z"),
    },
    exportedAt,
    "Organization dashboard KPIs",
  ).join("\n");
  const agentCsvText = buildAgentCsvSection(SAMPLE_AGENT_ROWS, {
    subDay: false,
    title: "Agent performance & presence",
  }).join("\n");

  const buffer = await composeScheduledReportPdf({
    title: "Daily performance report",
    periodLabel: "20 Aug 2026",
    sections: {
      dashboardKpis: true,
      agentTable: true,
      aiSummary: true,
    },
    window: {
      start: new Date("2026-08-20T00:00:00.000Z"),
      end: new Date("2026-08-20T23:59:59.000Z"),
      label: "20 Aug 2026",
      subDay: false,
    },
    dashboardImagePng: ONE_BY_ONE_PNG,
    kpiCsvText,
    agentCsvText,
    summaryText: "Team handled 111 conversations with strong SLA performance.",
    highlights: ["SLA held above target", "Webchat remained the top channel"],
    improvementSuggestions: [
      "Coach Alex Johnson on first-response SLA during busy periods.",
      "Increase ready hours for agents with high not-ready time.",
    ],
  });

  assert.ok(buffer.length > 500);
  assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.equal(countPdfPages(buffer), 4);
});

test("composeScheduledReportPdf embeds summary when dashboard disabled", async () => {
  const buffer = await composeScheduledReportPdf({
    title: "Daily report",
    periodLabel: "Aug 20, 2026",
    sections: {
      dashboardKpis: false,
      agentTable: true,
      aiSummary: true,
    },
    window: {
      start: new Date("2026-08-20T00:00:00.000Z"),
      end: new Date("2026-08-20T23:59:59.000Z"),
      label: "Aug 20, 2026",
      subDay: false,
    },
    agentCsvText: buildAgentCsvSection(SAMPLE_AGENT_ROWS, { subDay: false }).join("\n"),
    summaryText: "Team handled ten conversations with strong SLA.",
    highlights: ["SLA held above target"],
    improvementSuggestions: ["Review agents with zero handled volume."],
  });

  assert.ok(buffer.length > 100);
  assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.equal(countPdfPages(buffer), 2);
});

test("composeScheduledReportPdf rejects empty section selection", async () => {
  await assert.rejects(
    () =>
      composeScheduledReportPdf({
        title: "Empty",
        periodLabel: "Aug 20, 2026",
        sections: {
          dashboardKpis: false,
          agentTable: false,
          aiSummary: false,
        },
        window: {
          start: new Date(),
          end: new Date(),
          label: "Aug 20, 2026",
          subDay: false,
        },
      }),
    /At least one report section must be selected/,
  );
});
