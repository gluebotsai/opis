/**
 * Pure unit checks for SLA reminder window + mail kind constants.
 * Run: npx tsx ui-backend/scripts/sla-sweep-unit.ts
 */
import assert from "node:assert/strict";
import {
  isInSlaReminderWindow,
  slaMailEnabled,
  SLA_BREACH_ADMIN_KIND,
  SLA_LEGACY_OVERDUE_MAIL_LIMIT,
  SLA_REMINDER_KIND,
} from "../src/server/customerMail";

const now = new Date("2026-08-17T12:00:00.000Z");

assert.equal(slaMailEnabled(), false, "SLA SMTP stays off unless SLA_MAIL=on");
assert.equal(SLA_REMINDER_KIND, "sla_reminder_1h");
assert.equal(SLA_BREACH_ADMIN_KIND, "sla_breach_admin");
assert.ok(
  SLA_LEGACY_OVERDUE_MAIL_LIMIT > 0 && SLA_LEGACY_OVERDUE_MAIL_LIMIT <= 10,
  "legacy overdue mail must trickle, not burst"
);

assert.equal(
  isInSlaReminderWindow(new Date("2026-08-17T12:30:00.000Z"), now),
  true,
  "30m remaining → reminder window"
);
assert.equal(
  isInSlaReminderWindow(new Date("2026-08-17T13:00:00.000Z"), now),
  true,
  "exactly 1h remaining → reminder window"
);
assert.equal(
  isInSlaReminderWindow(new Date("2026-08-17T13:00:00.001Z"), now),
  false,
  "just over 1h → outside window"
);
assert.equal(
  isInSlaReminderWindow(new Date("2026-08-17T11:59:00.000Z"), now),
  false,
  "already past due → not reminder (breach path)"
);
assert.equal(
  isInSlaReminderWindow(new Date("2026-08-17T12:00:00.000Z"), now),
  false,
  "due exactly now → not reminder"
);

console.log("sla-sweep-unit: ok");
