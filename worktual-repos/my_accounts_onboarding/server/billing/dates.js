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

const PURCHASE_CUTOFF_DAY = 20;

function toDate(value) {
  if (value instanceof Date) {
    return startOfDay(value);
  }
  return startOfDay(new Date(value));
}

function toDateString(date) {
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  return format(toDate(date), "yyyy-MM-dd");
}

export function getServicePeriodStart(purchaseDate) {
  return addDays(toDate(purchaseDate), 1);
}

export function getServicePeriodEndForInvoice1(purchaseDate) {
  return endOfMonth(toDate(purchaseDate));
}

export function getServicePeriodForInvoice2(purchaseDate) {
  const purchase = toDate(purchaseDate);
  const nextMonthStart = startOfMonth(addDays(endOfMonth(purchase), 1));
  return {
    start: nextMonthStart,
    end: endOfMonth(nextMonthStart),
  };
}

export function countRemainingDays(periodStart, periodEnd) {
  return differenceInCalendarDays(toDate(periodEnd), toDate(periodStart)) + 1;
}

export function isPurchaseOnOrBefore20th(purchaseDate) {
  return getDate(toDate(purchaseDate)) <= PURCHASE_CUTOFF_DAY;
}

export function getInvoice2GenerationDate(purchaseDate) {
  const purchase = toDate(purchaseDate);
  if (isPurchaseOnOrBefore20th(purchase)) {
    return setDate(purchase, PURCHASE_CUTOFF_DAY);
  }
  return purchase;
}

export function getPurchaseDateOnly(purchaseDate) {
  return toDate(purchaseDate);
}

export { toDateString };
