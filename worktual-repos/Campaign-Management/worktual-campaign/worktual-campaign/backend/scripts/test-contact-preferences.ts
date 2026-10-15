/**
 * Preference merge + window helpers. Does not call send or DB.
 * Run: tsx scripts/test-contact-preferences.ts
 */
import assert from "node:assert/strict";
import {
  mergePreferencesJson,
  normalizePreferencesJson,
  preferencesFromEngagement,
} from "../src/helpers/contact-preferences.js";
import {
  computePreferenceWindows,
  fillMissingWindows,
  windowFromDatetimes,
} from "../src/helpers/contact-preference-timing.js";

function utc(y: number, m: number, d: number, h: number) {
  return new Date(Date.UTC(y, m - 1, d, h, 0, 0));
}

function testNormalizeKeepsFlagsAndTiming() {
  const out = normalizePreferencesJson({
    email: 1,
    whatsapp: 0,
    push: 0,
    web: 0,
    sms: 0,
    timezone: "Asia/Kolkata",
    timing: {
      days: ["mon", "tue", "wed", "thu", "fri"],
      start: "09:00",
      end: "18:00",
    },
    junk: "drop",
  });
  assert.equal(out.email, 1);
  assert.equal(out.timezone, "Asia/Kolkata");
  assert.equal(out.timing?.start, "09:00");
  assert.equal("junk" in out, false);
}

function testMergeFlagsKeepsTiming() {
  const out = mergePreferencesJson(
    {
      email: 0,
      whatsapp: 1,
      push: 0,
      web: 0,
      sms: 0,
      timezone: "Asia/Kolkata",
      timing: {
        days: ["mon", "tue", "wed", "thu", "fri"],
        start: "09:00",
        end: "18:00",
      },
    },
    { email: 1, whatsapp: 0, push: 0, web: 0, sms: 0 },
  );
  assert.equal(out.email, 1);
  assert.equal(out.whatsapp, 0);
  assert.equal(out.timing?.start, "09:00");
}

function testEngagementWinner() {
  const out = preferencesFromEngagement({
    email_open_count: 3,
    email_click_count: 1,
  });
  assert.equal(out.email, 1);
  assert.equal(out.whatsapp, 0);
}

function testWindowsMinFive() {
  const four = Array.from({ length: 4 }, () => utc(2026, 9, 1, 9));
  assert.equal(windowFromDatetimes(four, "UTC"), null);
  const five = Array.from({ length: 5 }, () => utc(2026, 9, 1, 9));
  const window = windowFromDatetimes(five, "UTC");
  assert.ok(window);
  assert.equal(window.start, "09:00");
  assert.equal(window.end, "11:00");
}

function testEmailOpensNotPushClicks() {
  const now = utc(2026, 9, 20, 12);
  const opens = Array.from({ length: 5 }, () => ({
    channel: "email",
    opened_at: utc(2026, 9, 1, 9),
    clicked_at: null,
  }));
  const out = computePreferenceWindows(opens, {
    timezoneName: "UTC",
    now,
    minEvents: 5,
  });
  const timing = out.timing as { start: string };
  assert.equal(timing.start, "09:00");
}

function testFillMissingDoesNotOverwrite() {
  const filled = fillMissingWindows(
    {
      timing: {
        days: ["mon", "tue", "wed", "thu", "fri"],
        start: "08:00",
        end: "10:00",
      },
    },
    {
      timing: { days: ["tue"], start: "15:00", end: "17:00" },
      channel_timing: {
        email: { days: ["tue"], start: "15:00", end: "17:00" },
      },
    },
  );
  const timing = filled.timing as { start: string };
  assert.equal(timing.start, "08:00");
  const ct = filled.channel_timing as Record<string, { start: string }>;
  assert.equal(ct.email.start, "15:00");
}

testNormalizeKeepsFlagsAndTiming();
testMergeFlagsKeepsTiming();
testEngagementWinner();
testWindowsMinFive();
testEmailOpensNotPushClicks();
testFillMissingDoesNotOverwrite();
console.log("test-contact-preferences: ok");
