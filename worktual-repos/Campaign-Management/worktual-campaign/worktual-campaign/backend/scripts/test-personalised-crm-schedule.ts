/**
 * Personalised CRM send_at + isolation flags (no test runner required).
 * Run: npx tsx scripts/test-personalised-crm-schedule.ts
 */
import assert from "node:assert/strict";
import {
  isIsolatedLaunchPlan,
  isOnDemandLaunchPlan,
  isPersonalisedCrmLaunchPlan,
} from "../src/helpers/launch-send-plan.js";
import {
  PERSONALISED_CRM_PAST_SLACK_MS,
  resolvePersonalisedCrmSendAt,
} from "../src/helpers/personalised-crm-schedule.js";
import { AppError } from "../src/helpers/response-builders.js";

assert.equal(isOnDemandLaunchPlan({ on_demand: true }), true);
assert.equal(isPersonalisedCrmLaunchPlan({ personalised_crm: true }), true);
assert.equal(isIsolatedLaunchPlan({ on_demand: true }), true);
assert.equal(isIsolatedLaunchPlan({ personalised_crm: true }), true);
assert.equal(isOnDemandLaunchPlan({ personalised_crm: true }), false);
assert.equal(isPersonalisedCrmLaunchPlan({ on_demand: true }), false);
assert.equal(isIsolatedLaunchPlan({}), false);

const now = new Date("2026-09-29T16:00:00.000Z");

const missing = resolvePersonalisedCrmSendAt({ now });
assert.equal(missing.scheduleMode, "now");
assert.equal(missing.status, "live");

const future = resolvePersonalisedCrmSendAt({
  send_at: "2026-09-30T10:00:00.000Z",
  now,
});
assert.equal(future.scheduleMode, "at");
assert.equal(future.status, "scheduled");
assert.equal(future.sendAt.toISOString(), "2026-09-30T10:00:00.000Z");

const withinSlack = resolvePersonalisedCrmSendAt({
  send_at: new Date(now.getTime() - PERSONALISED_CRM_PAST_SLACK_MS + 1_000).toISOString(),
  now,
});
assert.equal(withinSlack.scheduleMode, "now");
assert.equal(withinSlack.status, "live");

let pastRejected = false;
try {
  resolvePersonalisedCrmSendAt({
    send_at: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    now,
  });
} catch (err) {
  pastRejected = err instanceof AppError && err.statusCode === 400;
}
assert.equal(pastRejected, true);

console.log("personalised-crm schedule + isolation flags ok");
