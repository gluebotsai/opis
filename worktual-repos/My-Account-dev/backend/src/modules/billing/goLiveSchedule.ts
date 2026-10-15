import {
  addDays,
  endOfMonth,
  getDate,
  getDaysInMonth,
  setDate,
  startOfDay,
  startOfMonth,
} from "date-fns";

import { applyGst, calculateFullMonthlyAmount, GST_RATE } from "./amounts.js";
import {
  countRemainingDays,
  DEFAULT_PURCHASE_CUTOFF_DAY,
  normalizeCutoffDay,
  toDateString,
} from "./dates.js";

function toDate(value: any) {
  if (value instanceof Date) {
    return startOfDay(value);
  }
  return startOfDay(new Date(value));
}

function roundMoney(value: any) {
  return Math.round(Number(value) * 100) / 100;
}

/** Calendar-month day proration: (monthly ÷ daysInStartMonth) × inclusive days. */
export function calculateCalendarProratedAmount(
  monthlyPrice: any,
  periodStart: any,
  periodEnd: any,
) {
  const start = toDate(periodStart);
  const end = toDate(periodEnd);
  const daysInMonth = getDaysInMonth(start);
  const days = countRemainingDays(start, end);
  if (daysInMonth <= 0 || days <= 0) {
    return 0;
  }
  return roundMoney((Number(monthlyPrice) / daysInMonth) * days);
}

export function isOnOrBeforeCutoff(anchorDate: any, cutoffDay = DEFAULT_PURCHASE_CUTOFF_DAY) {
  const cutoff = normalizeCutoffDay(cutoffDay);
  return getDate(toDate(anchorDate)) <= cutoff;
}

export function getGoLiveInvoice2GenerationDate(
  anchorDate: any,
  cutoffDay = DEFAULT_PURCHASE_CUTOFF_DAY,
) {
  const anchor = toDate(anchorDate);
  const cutoff = normalizeCutoffDay(cutoffDay);
  if (getDate(anchor) <= cutoff) {
    return setDate(anchor, cutoff);
  }
  return anchor;
}

/**
 * Go-live Inv1/Inv2 service periods after UAT Accept.
 * Anchor = Accept date. Sales sets prorated ON/OFF + optional custom dates.
 */
export function buildGoLiveServiceSchedule({
  anchorDate,
  skipProration = false,
  periodStart = null,
  periodEnd = null,
  cutoffDay = DEFAULT_PURCHASE_CUTOFF_DAY,
}: any = {}) {
  const anchor = toDate(anchorDate);
  const cutoff = normalizeCutoffDay(cutoffDay);

  let inv1Start: Date;
  let inv1End: Date;

  if (skipProration) {
    if (!periodStart || !periodEnd) {
      throw new Error(
        "Sales must set billing period start and end when prorated billing is off.",
      );
    }
    inv1Start = toDate(periodStart);
    inv1End = toDate(periodEnd);
    if (inv1End.getTime() < inv1Start.getTime()) {
      throw new Error("Billing period end must be on or after the start date.");
    }
  } else {
    inv1Start = anchor;
    inv1End = endOfMonth(anchor);
  }

  const dayAfterInv1 = addDays(inv1End, 1);
  const eomOfInv1EndMonth = endOfMonth(inv1End);
  const inv1EndsOnMonthEnd =
    toDateString(inv1End) === toDateString(eomOfInv1EndMonth);

  let inv2Start: Date;
  let inv2End: Date;
  let inv2IsStub: boolean;

  if (inv1EndsOnMonthEnd) {
    inv2Start = startOfMonth(dayAfterInv1);
    inv2End = endOfMonth(inv2Start);
    inv2IsStub = false;
  } else {
    inv2Start = dayAfterInv1;
    inv2End = eomOfInv1EndMonth;
    inv2IsStub = true;
  }

  const inv2GenerationDate = getGoLiveInvoice2GenerationDate(anchor, cutoff);
  const inv2Scheduled = isOnOrBeforeCutoff(anchor, cutoff);
  const renewsAt = addDays(inv2End, 1);

  return {
    anchor,
    cutoffDay: cutoff,
    skipProration: Boolean(skipProration),
    inv1Start,
    inv1End,
    inv1Days: countRemainingDays(inv1Start, inv1End),
    inv2Start,
    inv2End,
    inv2IsStub,
    inv2Days: inv2IsStub ? countRemainingDays(inv2Start, inv2End) : null,
    inv2GenerationDate,
    inv2Scheduled,
    renewsAt,
  };
}

export function buildGoLiveSubscriptionInvoices({
  anchorDate,
  monthlyPrice,
  skipProration = false,
  periodStart = null,
  periodEnd = null,
  cutoffDay = DEFAULT_PURCHASE_CUTOFF_DAY,
}: any = {}) {
  const schedule = buildGoLiveServiceSchedule({
    anchorDate,
    skipProration,
    periodStart,
    periodEnd,
    cutoffDay,
  });
  const mrr = Number(monthlyPrice) || 0;

  const inv1Subtotal = skipProration
    ? calculateFullMonthlyAmount(mrr)
    : calculateCalendarProratedAmount(mrr, schedule.inv1Start, schedule.inv1End);
  const inv1Amounts = applyGst(inv1Subtotal);

  const inv2Subtotal = schedule.inv2IsStub
    ? calculateCalendarProratedAmount(mrr, schedule.inv2Start, schedule.inv2End)
    : calculateFullMonthlyAmount(mrr);
  const inv2Amounts = applyGst(inv2Subtotal);

  return {
    schedule,
    invoices: [
      {
        sequence: 1,
        invoiceType: "prorated_initial",
        generationDate: toDateString(schedule.anchor),
        status: "generated",
        servicePeriodStart: toDateString(schedule.inv1Start),
        servicePeriodEnd: toDateString(schedule.inv1End),
        remainingDays: schedule.inv1Days,
        monthlyPrice: mrr,
        subtotal: inv1Amounts.subtotal,
        gstRate: GST_RATE,
        grandTotal: inv1Amounts.grandTotal,
      },
      {
        sequence: 2,
        invoiceType: schedule.inv2IsStub ? "prorated_initial" : "full_monthly",
        generationDate: toDateString(schedule.inv2GenerationDate),
        status: schedule.inv2Scheduled ? "scheduled" : "generated",
        servicePeriodStart: toDateString(schedule.inv2Start),
        servicePeriodEnd: toDateString(schedule.inv2End),
        remainingDays: schedule.inv2Days,
        monthlyPrice: mrr,
        subtotal: inv2Amounts.subtotal,
        gstRate: GST_RATE,
        grandTotal: inv2Amounts.grandTotal,
      },
    ],
  };
}
