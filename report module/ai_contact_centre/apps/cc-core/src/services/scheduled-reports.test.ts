import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentNlpSummaryPayload,
  buildNlpSummaryPayload,
  computeNextRunAt,
  mapAgentIncludedSectionsToStored,
  mapStoredIncludedSectionsForAgent,
  resolveReportWindow,
  type OrgAgentReportRow,
} from "./scheduled-reports.js";

test("resolveReportWindow every_1h uses rolling hour label", () => {
  const now = new Date("2026-08-21T10:00:00.000Z");
  const window = resolveReportWindow(
    { schedule: "every_1h", period: "yesterday", timeZone: "UTC" },
    now,
  );
  assert.equal(window.label, "Last 1 hour");
  assert.equal(window.subDay, true);
  assert.equal(window.end.getTime(), now.getTime());
  assert.equal(window.start.getTime(), now.getTime() - 3_600_000);
});

test("resolveReportWindow daily yesterday labels previous local day", () => {
  const now = new Date("2026-08-21T04:30:00.000Z");
  const window = resolveReportWindow(
    { schedule: "daily", period: "yesterday", timeZone: "Asia/Kolkata" },
    now,
  );
  assert.match(window.label, /20 Aug 2026/);
  assert.equal(window.subDay, false);
});

test("computeNextRunAt daily returns a future timestamp", () => {
  const from = new Date("2026-08-21T10:00:00.000Z");
  const next = computeNextRunAt(
    {
      schedule: "daily",
      weekday: "monday",
      monthDay: 1,
      sendMode: "custom_time",
      sendAt: "09:00",
      timeZone: "Asia/Kolkata",
    },
    from,
  );
  assert.ok(next.getTime() > from.getTime());
});

test("buildNlpSummaryPayload caps performer lists at three", () => {
  const rows: OrgAgentReportRow[] = Array.from({ length: 50 }, (_, index) => ({
    agentId: String(index),
    name: `Agent ${index}`,
    presentDays: 5,
    readyHours: 6,
    readyPresenceHours: 5,
    busyPresenceHours: 1,
    notReadyPresenceHours: 0.5,
    breakPresenceHours: 0.5,
    dominantPresence: "Ready",
    handled: index,
    resolutionRate: 80,
    avgHandleMinutes: 8,
    slaRate: 70 - index,
    transferred: 0,
  }));
  const payload = buildNlpSummaryPayload({
    agentRows: rows,
    includeAgentSection: true,
    channelRows: [{ channel: "Webchat", value: 10 }],
    dispositionRows: [{ label: "Resolved", value: 8 }],
  });
  assert.equal(payload.topPerformers?.length, 3);
  assert.equal(payload.needsAttention?.length, 3);
  assert.ok(payload.teamRollup);
});

test("buildNlpSummaryPayload omits team rollup when agent section disabled", () => {
  const payload = buildNlpSummaryPayload({
    agentRows: [
      {
        agentId: "1",
        name: "Agent A",
        presentDays: 1,
        readyHours: 2,
        readyPresenceHours: 2,
        busyPresenceHours: 0.5,
        notReadyPresenceHours: 0,
        breakPresenceHours: 0,
        dominantPresence: "Ready",
        handled: 3,
        resolutionRate: 80,
        avgHandleMinutes: 5,
        slaRate: 90,
        transferred: 0,
      },
    ],
    includeAgentSection: false,
    channelRows: [],
    dispositionRows: [],
  });
  assert.equal(payload.teamRollup, undefined);
  assert.equal(payload.topPerformers, undefined);
});

test("mapAgentIncludedSectionsToStored maps performance KPIs to dashboardKpis", () => {
  const stored = mapAgentIncludedSectionsToStored({
    performanceKpis: true,
    aiSummary: false,
  });
  assert.equal(stored.dashboardKpis, true);
  assert.equal(stored.agentTable, false);
  assert.equal(stored.aiSummary, false);
});

test("mapStoredIncludedSectionsForAgent maps dashboardKpis to performanceKpis", () => {
  const agent = mapStoredIncludedSectionsForAgent({
    dashboardKpis: true,
    agentTable: true,
    aiSummary: true,
  });
  assert.equal(agent.performanceKpis, true);
  assert.equal(agent.aiSummary, true);
});

test("buildAgentNlpSummaryPayload returns top 3 channel and disposition mixes", () => {
  const payload = buildAgentNlpSummaryPayload({
    channelRows: [
      { channel: "Voice", value: 10 },
      { channel: "Webchat", value: 30 },
      { channel: "Email", value: 5 },
      { channel: "SMS", value: 15 },
    ],
    dispositionRows: [
      { label: "Resolved", value: 40 },
      { label: "Transferred", value: 10 },
      { label: "Abandoned", value: 5 },
      { label: "Callback", value: 5 },
    ],
  });
  assert.equal(payload.channelMixTop3?.length, 3);
  assert.equal(payload.channelMixTop3?.[0]?.channel, "Webchat");
  assert.equal(payload.dispositionMixTop3?.length, 3);
  assert.equal(payload.dispositionMixTop3?.[0]?.disposition, "Resolved");
});
