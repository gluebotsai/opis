/**
 * Run: npx tsx backend/src/service/calendar/schedule-google.test.ts
 */
import assert from "node:assert/strict";
import { isGoogleCalendarEventNotFound } from "./schedule-google.js";

const sample404 = `Google Calendar reschedule failed: { "error": { "errors": [ { "domain": "global", "reason": "notFound", "message": "Not Found" } ], "code": 404, "message": "Not Found" } }`;

assert.equal(isGoogleCalendarEventNotFound(sample404), true);
assert.equal(
  isGoogleCalendarEventNotFound("Google Calendar create failed: 403"),
  false,
);
assert.equal(
  isGoogleCalendarEventNotFound("Google Calendar reschedule failed: timeout"),
  false,
);

console.log("schedule-google.test.ts: ok");
