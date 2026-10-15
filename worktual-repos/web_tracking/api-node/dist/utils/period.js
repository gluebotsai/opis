export const PERIOD_PATTERN = /^(today|week|month|overall)$/;
/** Max history window for overall chart + heavy breakdown queries (avoids full-table scans). */
export const OVERALL_HEAVY_MAX_DAYS = 364;
export function periodFilter(period, dateFrom, dateTo) {
    if (dateFrom && dateTo) {
        return [`toDate('${dateFrom}')`, `toDate('${dateTo}') + 1`];
    }
    if (period === "today")
        return ["today()", "today() + 1"];
    // Rolling windows — match dashboard pills (7D / 30D), not calendar week/month
    if (period === "week")
        return ["today() - 6", "today() + 1"];
    if (period === "month")
        return ["today() - 29", "today() + 1"];
    return [null, null];
}
/** Lower bound for overall-period chart, bounce, traffic, scroll (site-scoped, capped at 12 months). */
export function overallHeavyStartExpr() {
    return `today() - ${OVERALL_HEAVY_MAX_DAYS}`;
}
export function isUnboundedOverall(period, dateFrom, dateTo) {
    return period === "overall" && !dateFrom && !dateTo;
}
/**
 * Date bounds for expensive queries (charts, bounce CTEs, traffic rows).
 * Overall uses a bounded window; summary KPI counts stay unbounded via periodFilter().
 */
export function resolveHeavyQueryBounds(period, dateFrom, dateTo) {
    const [start, end] = periodFilter(period, dateFrom, dateTo);
    if (start !== null && end !== null)
        return [start, end];
    return [overallHeavyStartExpr(), "today() + 1"];
}
/**
 * Equal-length window immediately before the selected period.
 * Overall has no comparable window. Dates stay in ClickHouse `today()` so the
 * comparison matches the KPI query timezone.
 */
export function previousPeriodBounds(period, dateFrom, dateTo) {
    if (dateFrom && dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
        const start = Date.parse(`${dateFrom}T00:00:00Z`);
        const end = Date.parse(`${dateTo}T00:00:00Z`);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
            return null;
        const days = Math.round((end - start) / 86400000) + 1;
        const prevStart = new Date(start - days * 86400000).toISOString().slice(0, 10);
        return [`toDate('${prevStart}')`, `toDate('${dateFrom}')`];
    }
    if (period === "today")
        return ["today() - 1", "today()"];
    if (period === "week")
        return ["today() - 13", "today() - 6"];
    if (period === "month")
        return ["today() - 59", "today() - 29"];
    return null;
}
export function dateFilter(column, startExpr, endExpr) {
    if (!startExpr || !endExpr)
        return "";
    return ` AND ${column} >= ${startExpr} AND ${column} < ${endExpr}`;
}
/** Inclusive day count for chart date spine — avoids `end - start` operator precedence bugs. */
export function chartDayCount(startExpr, endExpr) {
    return `dateDiff('day', ${startExpr}, ${endExpr})`;
}
