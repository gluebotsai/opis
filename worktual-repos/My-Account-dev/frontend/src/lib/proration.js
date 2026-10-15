/**
 * Mid-month quotation / first-invoice day pro-rata helpers.
 *
 * When Prorated Billing is ON (monthly):
 *   amount = (monthlyPrice ÷ daysInStartMonth) × inclusiveDays(periodStart, periodEnd)
 * Default period when dates unset: asOf → end of that month (remaining days).
 *
 * When OFF (skipProration): full monthly/yearly price; custom dates kept as metadata.
 * Setup/OTC: always full (never day-prorated). Add-ons & yearly: no day pro-rata.
 */

export function toMoney(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function startOfLocalDay(date) {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Resolve whether invoice period pricing should skip day proration.
 * `proratedBilling: true` ⇒ prorate; `false` ⇒ full price.
 * Legacy: `skipInvoiceProration` / `zeroCatalogDefaults` ⇒ skip (full price).
 */
export function resolveSkipInvoiceProration(config = {}) {
  if (typeof config?.proratedBilling === "boolean") {
    return !config.proratedBilling;
  }
  return Boolean(config?.skipInvoiceProration || config?.zeroCatalogDefaults);
}

/**
 * @param {Date|string|number} [asOf]
 * @returns {{ asOf: Date, daysInMonth: number, dayOfMonth: number, remainingDays: number }}
 */
export function getMonthDayContext(asOf = new Date()) {
  const date = asOf instanceof Date ? new Date(asOf.getTime()) : new Date(asOf);
  if (Number.isNaN(date.getTime())) {
    return getMonthDayContext(new Date());
  }

  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayOfMonth = date.getDate();
  const remainingDays = daysInMonth - dayOfMonth + 1;

  return {
    asOf: date,
    daysInMonth,
    dayOfMonth,
    remainingDays: Math.max(1, remainingDays),
  };
}

export function endOfMonth(asOf = new Date()) {
  const date = asOf instanceof Date ? new Date(asOf.getTime()) : new Date(asOf);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function addDays(asOf, days) {
  const date = asOf instanceof Date ? new Date(asOf.getTime()) : new Date(asOf);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

/** Inclusive calendar-day count between two dates (local midnight). */
export function countInclusiveDays(periodStart, periodEnd) {
  const start = startOfLocalDay(periodStart);
  const end = startOfLocalDay(periodEnd);
  if (!start || !end || end < start) {
    return 0;
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
}

/**
 * Inclusive remaining-days pro-rata for a full monthly amount (asOf → month end).
 */
export function prorateMonthlyAmount(fullMonthlyAmount, asOf = new Date()) {
  const amount = Number(fullMonthlyAmount);
  if (!Number.isFinite(amount) || amount === 0) {
    return 0;
  }

  const context = getMonthDayContext(asOf);
  return prorateMonthlyAmountForSelectedDays(
    amount,
    context.asOf,
    endOfMonth(context.asOf),
  );
}

/**
 * (monthly ÷ daysInStartMonth) × inclusive selected days between start and end.
 */
export function prorateMonthlyAmountForSelectedDays(
  fullMonthlyAmount,
  periodStart,
  periodEnd,
) {
  const amount = Number(fullMonthlyAmount);
  if (!Number.isFinite(amount) || amount === 0) {
    return 0;
  }

  const start = startOfLocalDay(periodStart);
  if (!start) {
    return 0;
  }
  const end = startOfLocalDay(periodEnd) || startOfLocalDay(endOfMonth(start));
  if (!end) {
    return 0;
  }

  const { daysInMonth } = getMonthDayContext(start);
  const selectedDays = countInclusiveDays(start, end);
  if (selectedDays <= 0 || daysInMonth <= 0) {
    return 0;
  }

  return toMoney((amount / daysInMonth) * selectedDays);
}

function resolveCoTerminateAt(coTerminateAt) {
  if (!coTerminateAt) {
    return null;
  }
  const end = coTerminateAt instanceof Date ? new Date(coTerminateAt.getTime()) : new Date(coTerminateAt);
  return Number.isNaN(end.getTime()) ? null : end;
}

/**
 * Apply first-invoice period pricing rules.
 *
 * @param {{
 *   coreMonthlyAmount: number,
 *   addonAmount?: number,
 *   setupAmount?: number,
 *   billingCycle?: string,
 *   asOf?: Date|string|number,
 *   coTerminateAt?: Date|string|number|null,
 *   implementationOnly?: boolean,
 *   skipProration?: boolean,
 *   periodStart?: Date|string|number|null,
 *   periodEnd?: Date|string|number|null,
 * }} input
 *
 * When `coTerminateAt` is set (mid-period add-on invoices), amounts stay unchanged
 * but the period shows end-date only: Valid until {base renewsAt}.
 *
 * When `skipProration` is set, bill full period amounts without day proration
 * and use optional custom periodStart/periodEnd as metadata.
 *
 * When proration is on (monthly), bill:
 *   (monthly ÷ daysInStartMonth) × inclusiveDays(periodStart, periodEnd)
 * Default dates: asOf → end of start month.
 */
export function applyInvoicePeriodPricing({
  coreMonthlyAmount = 0,
  addonAmount = 0,
  setupAmount = 0,
  billingCycle = "monthly",
  asOf = new Date(),
  coTerminateAt = null,
  implementationOnly = false,
  skipProration = false,
  periodStart: customPeriodStart = null,
  periodEnd: customPeriodEnd = null,
} = {}) {
  const context = getMonthDayContext(asOf);
  const setup = Math.max(0, Number(setupAmount) || 0);
  const coTerminateEnd = resolveCoTerminateAt(coTerminateAt);

  const resolveCustomDate = (value, fallback) => {
    if (!value) {
      return fallback;
    }
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date;
  };

  // First invoice for deals with implementation fee: OTC/setup only (no monthly).
  if (implementationOnly) {
    return {
      billingCycle: "one_time",
      isProrated: false,
      daysInMonth: context.daysInMonth,
      remainingDays: context.remainingDays,
      selectedDays: 0,
      coreFull: 0,
      coreBilled: 0,
      addonBilled: 0,
      setupBilled: toMoney(setup),
      recurringDue: 0,
      totalDue: toMoney(setup),
      periodStart: context.asOf,
      periodEnd: context.asOf,
      prorationNote: "Implementation / one-time fee only — subscription billed after go-live",
      periodLabel: "Implementation fee",
      implementationOnly: true,
    };
  }

  const core = Math.max(0, Number(coreMonthlyAmount) || 0);
  const addons = Math.max(0, Number(addonAmount) || 0);
  const isYearly = String(billingCycle || "monthly") === "yearly";

  let result;

  if (skipProration) {
    const periodStart = resolveCustomDate(customPeriodStart, context.asOf);
    const periodEnd = resolveCustomDate(
      customPeriodEnd,
      isYearly ? addDays(periodStart, 365) : endOfMonth(periodStart),
    );
    const selectedDays = countInclusiveDays(periodStart, periodEnd);
    const startCtx = getMonthDayContext(periodStart);
    const coreBilled = isYearly ? toMoney(core * 12) : toMoney(core);
    const addonBilled = isYearly ? toMoney(addons * 12) : toMoney(addons);
    const recurringDue = toMoney(coreBilled + addonBilled);

    result = {
      billingCycle: isYearly ? "yearly" : "monthly",
      isProrated: false,
      daysInMonth: startCtx.daysInMonth,
      remainingDays: startCtx.remainingDays,
      selectedDays,
      coreFull: toMoney(core),
      coreBilled,
      addonBilled,
      setupBilled: toMoney(setup),
      recurringDue,
      totalDue: toMoney(recurringDue + setup),
      periodStart,
      periodEnd,
      prorationNote: "Selected billing period (full price)",
      periodLabel: `Billing period ${formatPeriodDate(periodStart)} to ${formatPeriodDate(periodEnd)}`,
    };
  } else if (isYearly) {
    const annualCore = toMoney(core * 12);
    const annualAddons = toMoney(addons * 12);
    const recurringDue = toMoney(annualCore + annualAddons);
    const periodStart = resolveCustomDate(customPeriodStart, context.asOf);
    const periodEnd = resolveCustomDate(customPeriodEnd, addDays(periodStart, 365));
    const selectedDays = countInclusiveDays(periodStart, periodEnd);
    const startCtx = getMonthDayContext(periodStart);

    result = {
      billingCycle: "yearly",
      isProrated: false,
      daysInMonth: startCtx.daysInMonth,
      remainingDays: startCtx.remainingDays,
      selectedDays,
      coreFull: toMoney(core),
      coreBilled: annualCore,
      addonBilled: annualAddons,
      setupBilled: toMoney(setup),
      recurringDue,
      totalDue: toMoney(recurringDue + setup),
      periodStart,
      periodEnd,
      prorationNote: "Annual billing — full period charged",
      periodLabel: `Validity ${formatPeriodDate(periodStart)} to ${formatPeriodDate(periodEnd)} (365 days)`,
    };
  } else {
    const periodStart = resolveCustomDate(customPeriodStart, context.asOf);
    const periodEnd = resolveCustomDate(customPeriodEnd, endOfMonth(periodStart));
    const startCtx = getMonthDayContext(periodStart);
    const selectedDays = countInclusiveDays(periodStart, periodEnd);
    const coreBilled = prorateMonthlyAmountForSelectedDays(core, periodStart, periodEnd);
    const addonBilled = toMoney(addons);
    const recurringDue = toMoney(coreBilled + addonBilled);
    const isProrated = core > 0 && coreBilled !== toMoney(core);

    result = {
      billingCycle: "monthly",
      isProrated,
      daysInMonth: startCtx.daysInMonth,
      remainingDays: startCtx.remainingDays,
      selectedDays,
      coreFull: toMoney(core),
      coreBilled,
      addonBilled,
      setupBilled: toMoney(setup),
      recurringDue,
      totalDue: toMoney(recurringDue + setup),
      periodStart,
      periodEnd,
      prorationNote: isProrated
        ? `Pro-rated ${selectedDays}/${startCtx.daysInMonth} days`
        : "Full month",
      periodLabel: `Billing period ${formatPeriodDate(periodStart)} to ${formatPeriodDate(periodEnd)}`,
    };
  }

  if (!coTerminateEnd) {
    return result;
  }

  return {
    ...result,
    periodStart: null,
    periodEnd: coTerminateEnd,
    periodLabel: `Valid until ${formatPeriodDate(coTerminateEnd)}`,
    prorationNote: "Full add-on amount — valid until current subscription ends",
  };
}

export function formatPeriodDate(date) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date instanceof Date ? date : new Date(date));
  } catch {
    return String(date);
  }
}

/**
 * Split invoice lines into core recurring vs add-on vs setup.
 */
export function splitPricedLines(lines = []) {
  let coreAmount = 0;
  let addonAmount = 0;
  let setupAmount = 0;

  for (const line of lines) {
    const amount = Number(line?.amount) || 0;
    if (line?.type === "setup") {
      setupAmount += amount;
      continue;
    }
    if (line?.isAddon === true) {
      addonAmount += amount;
      continue;
    }
    coreAmount += amount;
  }

  return {
    coreAmount: toMoney(coreAmount),
    addonAmount: toMoney(addonAmount),
    setupAmount: toMoney(setupAmount),
  };
}
