import assert from "node:assert/strict";
import {
  buildScheduleIdempotencyKey,
  computeSubscriptionStartDate,
} from "@/dao/finance/billing-schedule-service";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test("cutoff schedules on cutoff day when purchase before cutoff", () => {
  const purchase = new Date("2026-03-10T12:00:00Z");
  const scheduled = computeSubscriptionStartDate(purchase, 20);
  assert.equal(scheduled.getDate(), 20);
});

test("cutoff keeps purchase day when after cutoff", () => {
  const purchase = new Date("2026-03-25T12:00:00Z");
  const scheduled = computeSubscriptionStartDate(purchase, 20);
  assert.equal(scheduled.getDate(), 25);
});

test("idempotency key is stable", () => {
  const key = buildScheduleIdempotencyKey({
    contractId: "c1",
    billingKind: "renewal",
    scheduledFor: new Date("2026-06-01"),
  });
  assert.equal(key, "c1:renewal:2026-06-01");
});
