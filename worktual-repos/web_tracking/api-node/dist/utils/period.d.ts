export declare const PERIOD_PATTERN: RegExp;
/** Max history window for overall chart + heavy breakdown queries (avoids full-table scans). */
export declare const OVERALL_HEAVY_MAX_DAYS = 364;
export declare function periodFilter(period: string, dateFrom?: string | null, dateTo?: string | null): [string | null, string | null];
/** Lower bound for overall-period chart, bounce, traffic, scroll (site-scoped, capped at 12 months). */
export declare function overallHeavyStartExpr(): string;
export declare function isUnboundedOverall(period: string, dateFrom?: string | null, dateTo?: string | null): boolean;
/**
 * Date bounds for expensive queries (charts, bounce CTEs, traffic rows).
 * Overall uses a bounded window; summary KPI counts stay unbounded via periodFilter().
 */
export declare function resolveHeavyQueryBounds(period: string, dateFrom?: string | null, dateTo?: string | null): [string, string];
/**
 * Equal-length window immediately before the selected period.
 * Overall has no comparable window. Dates stay in ClickHouse `today()` so the
 * comparison matches the KPI query timezone.
 */
export declare function previousPeriodBounds(period: string, dateFrom?: string | null, dateTo?: string | null): [string, string] | null;
export declare function dateFilter(column: string, startExpr: string | null, endExpr: string | null): string;
/** Inclusive day count for chart date spine — avoids `end - start` operator precedence bugs. */
export declare function chartDayCount(startExpr: string, endExpr: string): string;
