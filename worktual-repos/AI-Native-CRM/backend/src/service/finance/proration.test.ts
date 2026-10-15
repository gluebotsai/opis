import assert from "node:assert/strict";
import {
  daysInBillingPeriod,
  previewProration,
  prorateMonthlyAmount,
  remainingDaysInTerm,
} from "./proration";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`, err);
    process.exitCode = 1;
  }
}

test("remaining days mid-term", () => {
  const start = new Date("2026-01-01");
  const end = new Date("2026-12-31");
  const effective = new Date("2026-07-01");
  const remaining = remainingDaysInTerm(start, end, effective);
  assert.ok(remaining > 180 && remaining < 185);
});

test("zero remaining after term end", () => {
  const start = new Date("2026-01-01");
  const end = new Date("2026-06-30");
  const effective = new Date("2026-08-01");
  assert.equal(remainingDaysInTerm(start, end, effective), 0);
});

test("prorate monthly amount", () => {
  const start = new Date("2026-01-01");
  const end = new Date("2026-01-31");
  const effective = new Date("2026-01-16");
  const { proratedAmount, remainingDays } = prorateMonthlyAmount(
    3100,
    start,
    end,
    effective,
  );
  assert.equal(remainingDays, 16);
  assert.ok(proratedAmount > 1500 && proratedAmount < 1700);
});

test("preview totals lines", () => {
  const result = previewProration({
    termStart: new Date("2026-01-01"),
    termEnd: new Date("2026-03-31"),
    effectiveDate: new Date("2026-02-15"),
    lines: [{ name: "Seats", monthlyAmount: 3000 }],
  });
  assert.equal(result.lines.length, 1);
  assert.ok(result.totalProrated > 0);
  assert.ok(daysInBillingPeriod(new Date("2026-02-01"), new Date("2026-02-28")) >= 28);
});
