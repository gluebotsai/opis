import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { composeScheduledReportPdf } from "../src/services/report-composer.js";
import { countPdfPages } from "../src/services/build-dashboard-pdf.js";
import { buildAgentCsvSection, buildKpiCsvSection } from "../src/services/reporting.js";

const agentRows = [
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
  {
    name: "Sam Lee",
    presentDays: 3,
    readyHours: 20,
    readyPresenceHours: 14,
    busyPresenceHours: 4,
    notReadyPresenceHours: 5,
    breakPresenceHours: 1,
    dominantPresence: "Not Ready",
    handled: 18,
    resolutionRate: 65,
    avgHandleMinutes: 7.4,
    slaRate: 62,
    transferred: 2,
  },
];

async function main() {
  const exportedAt = new Date();
  const periodStart = new Date("2026-08-18T00:00:00.000Z");
  const periodEnd = new Date("2026-08-24T23:59:59.000Z");
  const periodLabel = "18 Aug 2026 – 24 Aug 2026";

  const kpiCsvText = buildKpiCsvSection(
    {
      handled: 111,
      handledChangePercent: 12.5,
      resolutionRate: 78.4,
      avgFirstResponseSeconds: 46,
      avgHandleSeconds: 291,
      slaRate: 85,
      transferred: 6,
      firstResponseCount: 80,
      withinSlaCount: 68,
    },
    { start: periodStart, end: periodEnd },
    exportedAt,
    "Organization dashboard KPIs",
  ).join("\n");

  const agentCsvText = buildAgentCsvSection(agentRows, {
    subDay: false,
    title: "Agent performance & presence",
  }).join("\n");
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultDashboardImage = resolve(scriptDir, "../tmp/reports-dashboard-sample.png");
  const dashboardImagePath = process.env.SAMPLE_DASHBOARD_IMAGE_PATH ?? defaultDashboardImage;
  const dashboardImagePng = existsSync(dashboardImagePath)
    ? readFileSync(dashboardImagePath)
    : null;

  const buffer = await composeScheduledReportPdf({
    title: "Weekly performance report",
    periodLabel,
    sections: {
      dashboardKpis: true,
      agentTable: true,
      aiSummary: true,
    },
    window: {
      start: periodStart,
      end: periodEnd,
      label: periodLabel,
      subDay: false,
    },
    dashboardImagePng,
    dashboardLayout: {
      periodLabel,
      orgKpis: {
        handled: 111,
        handledChangePercent: 12.5,
        resolutionRate: 78.4,
        avgFirstResponseSeconds: 46,
        avgHandleSeconds: 291,
        slaRate: 85,
        transferred: 6,
        resolved: 87,
      },
      daily: [
        { label: "18 Aug", handled: 14, avgHandleSeconds: 280 },
        { label: "19 Aug", handled: 16, avgHandleSeconds: 295 },
      ],
      channels: [
        { channel: "Webchat", handler: "AI", label: "Webchat · AI", value: 72 },
        { channel: "Email", handler: "Agent", label: "Email · Agent", value: 39 },
      ],
      dispositions: [{ label: "Issue resolved", value: 87 }],
    },
    kpiCsvText,
    agentCsvText,
    summaryText:
      "The team handled 111 conversations during the week with an 85% SLA rate. Webchat remained the dominant channel.",
    highlights: [
      "Priya Sharma led handled volume with 91% SLA.",
      "Resolution rate improved versus the prior period.",
    ],
    improvementSuggestions: [
      "Coach Sam Lee on reducing not-ready time during peak hours.",
      "Review Alex Johnson's transfer rate on complex email threads.",
      "Maintain ready coverage above 6 hours per agent on weekdays.",
    ],
  });

  const outputPath = resolve(scriptDir, "../tmp/scheduled-report-sample.pdf");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);

  console.log(JSON.stringify({ outputPath, bytes: buffer.length, pages: countPdfPages(buffer) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
