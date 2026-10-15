import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCallbackDuePreview,
  resolveCallbackDueAt,
  resolveQueueCloseAt,
} from "./callback-due.js";

test("1h and 4h offsets are calculated from now", () => {
  const now = new Date("2026-08-19T09:00:00");
  assert.equal(resolveCallbackDueAt("1h", { now })?.toISOString(), new Date("2026-08-19T10:00:00").toISOString());
  assert.equal(resolveCallbackDueAt("4h", { now })?.toISOString(), new Date("2026-08-19T13:00:00").toISOString());
});

test("today EOD uses queue close time when it is still ahead", () => {
  const now = new Date("2026-08-19T09:00:00");
  const due = resolveQueueCloseAt(now, "18:00").dueAt;
  assert.equal(due.getHours(), 18);
  assert.equal(due.getDate(), 19);
});

test("today EOD rolls to the next day when close time has passed", () => {
  const now = new Date("2026-08-19T19:15:00");
  const due = resolveQueueCloseAt(now, "18:00").dueAt;
  assert.equal(due.getDate(), 20);
  assert.equal(due.getHours(), 18);
});

test("tomorrow is 10:00 local the next calendar day", () => {
  const now = new Date("2026-08-19T22:00:00");
  const due = resolveCallbackDueAt("tomorrow", { now })!;
  assert.equal(due.getDate(), 20);
  assert.equal(due.getHours(), 10);
  assert.equal(due.getMinutes(), 0);
});

test("custom empty value returns null", () => {
  assert.equal(resolveCallbackDueAt("custom", { customValue: "" }), null);
});

test("EOD preview mentions queue close when hours exist", () => {
  const due = new Date("2026-08-19T18:00:00");
  assert.match(
    formatCallbackDuePreview(due, { preset: "eod", usedQueueClose: true }),
    /queue close/,
  );
});
