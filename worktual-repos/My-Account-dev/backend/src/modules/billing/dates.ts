import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getDate,
  setDate,
  startOfDay,
  startOfMonth,
} from "date-fns";

/** Default cut-off day; admin Invoice settings can override via purchase_cutoff_day. */
export const DEFAULT_PURCHASE_CUTOFF_DAY = 20;
/** @deprecated Prefer DEFAULT_PURCHASE_CUTOFF_DAY / normalizeCutoffDay */
const PURCHASE_CUTOFF_DAY = DEFAULT_PURCHASE_CUTOFF_DAY;

export function normalizeCutoffDay(value: any, fallback = DEFAULT_PURCHASE_CUTOFF_DAY) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 28) {
    return fallback;
  }
  return n;
}

function toDate(value: any) {
  if (value instanceof Date) {
    return startOfDay(value);
  }
  return startOfDay(new Date(value));
}

function toDateString(date: any) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  return format(toDate(date), "yyyy-MM-dd");
}

/** Standard (non–go-live) path: service starts the day after purchase. */
export function getServicePeriodStart(purchaseDate: any) {
  return addDays(toDate(purchaseDate), 1);
}

export function getServicePeriodEndForInvoice1(purchaseDate: any) {
  return endOfMonth(toDate(purchaseDate));
}

export function getServicePeriodForInvoice2(purchaseDate: any) {
  const purchase = toDate(purchaseDate);
  const nextMonthStart = startOfMonth(addDays(endOfMonth(purchase), 1));
  return {
    start: nextMonthStart,
    end: endOfMonth(nextMonthStart),
  };
}

export function countRemainingDays(periodStart: any, periodEnd: any) {
  return differenceInCalendarDays(toDate(periodEnd), toDate(periodStart)) + 1;
}

export function isPurchaseOnOrBefore20th(
  purchaseDate: any,
  cutoffDay: any = DEFAULT_PURCHASE_CUTOFF_DAY,
) {
  return getDate(toDate(purchaseDate)) <= normalizeCutoffDay(cutoffDay);
}

export function getInvoice2GenerationDate(
  purchaseDate: any,
  cutoffDay: any = DEFAULT_PURCHASE_CUTOFF_DAY,
) {
  const purchase = toDate(purchaseDate);
  const cutoff = normalizeCutoffDay(cutoffDay);
  if (isPurchaseOnOrBefore20th(purchase, cutoff)) {
    return setDate(purchase, cutoff);
  }
  return purchase;
}

/**
 * When to auto-generate the Finance renewal quotation for a subscription
 * whose next period starts at `dueAt` (typically the 1st of the next month).
 * Aligns with cut-off day of the prior month (default 20).
 */
export function getRenewalQuoteGenerationDate(
  dueAt: any,
  cutoffDay: any = DEFAULT_PURCHASE_CUTOFF_DAY,
) {
  const due = toDate(dueAt);
  const priorMonthAnchor = addDays(due, -1);
  return setDate(startOfMonth(priorMonthAnchor), normalizeCutoffDay(cutoffDay));
}

export function isRenewalQuoteDue(
  dueAt: any,
  asOf = new Date(),
  cutoffDay: any = DEFAULT_PURCHASE_CUTOFF_DAY,
) {
  const generationDate = getRenewalQuoteGenerationDate(dueAt, cutoffDay);
  return startOfDay(asOf).getTime() >= generationDate.getTime();
}

export function getPurchaseDateOnly(purchaseDate: any) {
  return toDate(purchaseDate);
}

export { toDateString, PURCHASE_CUTOFF_DAY };
