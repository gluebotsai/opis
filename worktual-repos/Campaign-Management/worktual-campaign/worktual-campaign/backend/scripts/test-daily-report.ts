/**
 * Lightweight tests for daily report helpers (no test runner required).
 * Run: tsx scripts/test-daily-report.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addCalendarDays,
  dayWindowUtc,
  isDailyReportSendWindow,
  todayLocalDate,
} from "../src/helpers/report-day-window.js";
import { buildChannelPerformanceRows } from "../src/dao/daily-campaign-report.js";
import { renderDailyCampaignReportEmail } from "../src/services/daily-report/render-email.js";
import type { DailyCampaignReport } from "../src/services/daily-report/types.js";

function testDayWindow() {
  const win = dayWindowUtc("2026-09-05", "Asia/Kolkata");
  assert.ok(win);
  assert.ok(win!.end.getTime() > win!.start.getTime());
  assert.equal(addCalendarDays("2026-09-05", 1), "2026-09-06");
  assert.match(todayLocalDate("Asia/Kolkata"), /^\d{4}-\d{2}-\d{2}$/);
}

function testSendWindow() {
  const tz = "Asia/Kolkata";
  const mon1700 = new Date("2026-09-07T11:30:00.000Z");
  assert.equal(isDailyReportSendWindow(tz, mon1700), true);
  const mon1400 = new Date("2026-09-07T08:30:00.000Z");
  assert.equal(isDailyReportSendWindow(tz, mon1400), false);
}

function testChannelPerformance() {
  const map = new Map([
    [
      "email",
      {
        sent: 10,
        delivered: 9,
        failed: 1,
        opens: 3,
        clicks: 2,
        processed: 10,
      },
    ],
  ]);
  const rows = buildChannelPerformanceRows(map);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "email");
  assert.equal(rows[0].opens, 3);
  assert.equal(rows[0].openRate, 3 / 9);
}

function testRenderZeroActivity() {
  const report: DailyCampaignReport = {
    reportDate: "2026-09-05",
    reportDateLabel: "Friday, September 5, 2026",
    timezone: "Asia/Kolkata",
    userId: "1",
    userName: "Test User",
    userEmail: "test@example.com",
    organizationId: "1",
    organizationName: "Acme",
    generatedAt: new Date().toISOString(),
    overall: {
      available: true,
      error: null,
      data: {
        campaignsLaunched: 0,
        campaignsCompleted: 0,
        campaignsRunning: 0,
        campaignsScheduled: 0,
        campaignsFailed: 0,
        campaignsPaused: 0,
        campaignsCancelled: 0,
        contactsTargeted: 0,
        contactsReached: 0,
        messagesSent: 0,
        messagesDelivered: 0,
        messagesFailed: 0,
        deliveryRate: null,
        clickRate: null,
        noActivity: true,
      },
    },
    campaignActivity: { available: true, error: null, data: [] },
    currentStatus: {
      available: true,
      error: null,
      data: { active: [], scheduled: [], paused: [], failed: [], cancelled: [] },
    },
    channelPerformance: { available: true, error: null, data: [] },
    contactActivity: {
      available: true,
      error: null,
      data: {
        created: 0,
        updated: 0,
        imported: 0,
        addedToCampaigns: 0,
        reached: 0,
        notReached: 0,
        failed: 0,
        unsubscribed: 0,
        duplicates: null,
        noActivity: true,
      },
    },
    whatsappTemplates: {
      available: true,
      error: null,
      data: {
        submitted: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        activated: 0,
        deactivated: 0,
        rejectedDetails: [],
        noActivity: true,
      },
    },
    scheduledCampaigns: { available: true, error: null, data: [] },
    attentionRequired: { available: true, error: null, data: [] },
    upcomingActivity: {
      available: true,
      error: null,
      data: { scheduledCampaigns: [], noUpcoming: true },
    },
    comparison: { available: true, error: null, data: null },
  };

  const { subject, html } = renderDailyCampaignReportEmail(report);
  assert.match(subject, /Daily Campaign Report/);
  assert.match(html, /No campaign activity was recorded/);
  assert.match(html, /no active campaigns/i);
}

/** Regression: never blast all setup_users — Campaign product login only. */
function testRecipientSqlCampaignProductOnly() {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "../src/dao/daily-report-users.ts",
  );
  const src = readFileSync(path, "utf8");
  assert.match(src, /setup_user_product_access/);
  assert.match(src, /lower\(a\.product_id\) = 'campaign'/);
}

testDayWindow();
testSendWindow();
testChannelPerformance();
testRenderZeroActivity();
testRecipientSqlCampaignProductOnly();
console.log("daily-report tests passed");
