/**
 * Mid-month day pro-rata pricing smoke assertions.
 */
import assert from "node:assert/strict";

import {
  applyInvoicePeriodPricing,
  countInclusiveDays,
  getMonthDayContext,
  prorateMonthlyAmount,
  prorateMonthlyAmountForSelectedDays,
  resolveSkipInvoiceProration,
  toMoney,
} from "../src/lib/proration.js";

function main() {
  // 15 Jun in a 30-day month → 16 remaining inclusive
  const jun15 = new Date(2026, 5, 15);
  const ctx = getMonthDayContext(jun15);
  assert.equal(ctx.daysInMonth, 30);
  assert.equal(ctx.remainingDays, 16);

  const full = 100000;
  const dayPrice = full / 30;
  const expected = toMoney(dayPrice * 16);
  assert.equal(prorateMonthlyAmount(full, jun15), expected);
  assert.equal(expected, toMoney((100000 / 30) * 16));

  const monthly = applyInvoicePeriodPricing({
    coreMonthlyAmount: 100000,
    addonAmount: 5000,
    setupAmount: 2000,
    billingCycle: "monthly",
    asOf: jun15,
  });
  assert.equal(monthly.coreBilled, expected);
  assert.equal(monthly.addonBilled, 5000);
  assert.equal(monthly.setupBilled, 2000);
  assert.equal(monthly.recurringDue, toMoney(expected + 5000));
  assert.equal(monthly.totalDue, toMoney(expected + 5000 + 2000));
  assert.equal(monthly.isProrated, true);
  assert.match(monthly.prorationNote, /16\/30/);

  // Custom selected-day window (not only remaining-to-EOM)
  const jun20 = new Date(2026, 5, 20);
  assert.equal(countInclusiveDays(jun15, jun20), 6);
  const selected = prorateMonthlyAmountForSelectedDays(100000, jun15, jun20);
  assert.equal(selected, toMoney((100000 / 30) * 6));

  const customPeriod = applyInvoicePeriodPricing({
    coreMonthlyAmount: 100000,
    addonAmount: 5000,
    setupAmount: 2000,
    billingCycle: "monthly",
    asOf: jun15,
    periodStart: jun15,
    periodEnd: jun20,
  });
  assert.equal(customPeriod.coreBilled, selected);
  assert.equal(customPeriod.addonBilled, 5000);
  assert.equal(customPeriod.setupBilled, 2000);
  assert.equal(customPeriod.selectedDays, 6);
  assert.match(customPeriod.prorationNote, /6\/30/);

  // Proration OFF: full price, custom dates preserved
  const fixed = applyInvoicePeriodPricing({
    coreMonthlyAmount: 100000,
    addonAmount: 5000,
    setupAmount: 2000,
    billingCycle: "monthly",
    asOf: jun15,
    skipProration: true,
    periodStart: jun15,
    periodEnd: jun20,
  });
  assert.equal(fixed.coreBilled, 100000);
  assert.equal(fixed.addonBilled, 5000);
  assert.equal(fixed.setupBilled, 2000);
  assert.equal(fixed.isProrated, false);
  assert.equal(fixed.periodStart.getDate(), 15);
  assert.equal(fixed.periodEnd.getDate(), 20);

  assert.equal(resolveSkipInvoiceProration({ proratedBilling: true }), false);
  assert.equal(resolveSkipInvoiceProration({ proratedBilling: false }), true);
  assert.equal(resolveSkipInvoiceProration({ skipInvoiceProration: true }), true);
  assert.equal(resolveSkipInvoiceProration({}), false);

  const yearly = applyInvoicePeriodPricing({
    coreMonthlyAmount: 10000,
    addonAmount: 1000,
    setupAmount: 500,
    billingCycle: "yearly",
    asOf: jun15,
  });
  assert.equal(yearly.coreBilled, 120000);
  assert.equal(yearly.addonBilled, 12000);
  assert.equal(yearly.totalDue, toMoney(120000 + 12000 + 500));
  assert.equal(yearly.isProrated, false);
  const spanMs = yearly.periodEnd.getTime() - yearly.periodStart.getTime();
  const days = Math.round(spanMs / (24 * 60 * 60 * 1000));
  assert.equal(days, 365);

  // First of month = full month (no effective cut)
  const jul1 = new Date(2026, 6, 1);
  const fullMonth = applyInvoicePeriodPricing({
    coreMonthlyAmount: 31000,
    billingCycle: "monthly",
    asOf: jul1,
  });
  assert.equal(fullMonth.remainingDays, 31);
  assert.equal(fullMonth.coreBilled, 31000);
  assert.equal(fullMonth.isProrated, false);

  console.log(
    "[smoke-test-proration] OK — selected-day proration, fixed addons/setup, full yearly",
  );
}

main();
