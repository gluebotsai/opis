/**
 * Generic proration helper for mid-term amendments and partial renewal periods.
 */

export type ProrationLineInput = {
  name: string;
  monthlyAmount: number;
};

export type ProrationPreviewInput = {
  termStart: Date;
  termEnd: Date;
  effectiveDate: Date;
  lines: ProrationLineInput[];
};

export type ProrationLineResult = {
  name: string;
  monthlyAmount: number;
  dailyRate: number;
  remainingDays: number;
  proratedAmount: number;
};

export type ProrationPreviewResult = {
  termStart: string;
  termEnd: string;
  effectiveDate: string;
  totalDaysInTerm: number;
  remainingDays: number;
  lines: ProrationLineResult[];
  totalProrated: number;
};

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetweenInclusive(start: Date, end: Date): number {
  const ms = startOfDay(end).getTime() - startOfDay(start).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000) + 1);
}

export function daysInBillingPeriod(start: Date, end: Date): number {
  return Math.max(1, daysBetweenInclusive(start, end));
}

export function remainingDaysInTerm(
  termStart: Date,
  termEnd: Date,
  effectiveDate: Date,
): number {
  const start = startOfDay(effectiveDate);
  const end = startOfDay(termEnd);
  if (start.getTime() > end.getTime()) return 0;
  return daysBetweenInclusive(start, end);
}

export function prorateMonthlyAmount(
  monthlyAmount: number,
  termStart: Date,
  termEnd: Date,
  effectiveDate: Date,
): { dailyRate: number; remainingDays: number; proratedAmount: number } {
  const totalDays = daysInBillingPeriod(termStart, termEnd);
  const remaining = remainingDaysInTerm(termStart, termEnd, effectiveDate);
  const dailyRate = monthlyAmount / totalDays;
  const proratedAmount = Math.round(dailyRate * remaining * 100) / 100;
  return { dailyRate, remainingDays: remaining, proratedAmount };
}

export function previewProration(
  input: ProrationPreviewInput,
): ProrationPreviewResult {
  const termStart = startOfDay(input.termStart);
  const termEnd = startOfDay(input.termEnd);
  const effectiveDate = startOfDay(input.effectiveDate);
  const totalDaysInTerm = daysInBillingPeriod(termStart, termEnd);
  const remainingDays = remainingDaysInTerm(termStart, termEnd, effectiveDate);

  const lines: ProrationLineResult[] = input.lines.map((line) => {
    const calc = prorateMonthlyAmount(
      line.monthlyAmount,
      termStart,
      termEnd,
      effectiveDate,
    );
    return {
      name: line.name,
      monthlyAmount: line.monthlyAmount,
      ...calc,
    };
  });

  const totalProrated =
    Math.round(lines.reduce((sum, l) => sum + l.proratedAmount, 0) * 100) / 100;

  return {
    termStart: termStart.toISOString().slice(0, 10),
    termEnd: termEnd.toISOString().slice(0, 10),
    effectiveDate: effectiveDate.toISOString().slice(0, 10),
    totalDaysInTerm,
    remainingDays,
    lines,
    totalProrated,
  };
}
