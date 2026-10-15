/** Bounce = exactly one page view in the session AND session activity duration < threshold. */
export declare const BOUNCE_MAX_DURATION_SECONDS = 10;
/** Aggregate bounce rate (0–100) from rows with is_bounce (0/1). */
export declare const BOUNCE_RATE_AGG_EXPR = "\n  if(count() = 0, 0,\n     round(countIf(is_bounce = 1) / count() * 100, 2))\n";
/** view = v_session_bounce (ClickHouse agg); facts = inline CTE fallback before migration. */
export type BounceQuerySource = "view" | "facts";
export declare function bounceQuerySource(): BounceQuerySource;
export declare function isSessionBounce(pageviewCount: number, durationSeconds: number): boolean;
/** Page the visitor left on for a bounce session (single-page: entry path). */
export declare function bouncePageForSession(row: {
    pageview_count?: number | string | null;
    duration_seconds?: number | string | null;
    is_bounce?: number | boolean | string | null;
    entry_page?: string | null;
    exit_page?: string | null;
}): string;
/** Map fact-table date filters to v_session_bounce.session_started_at. */
export declare function sessionBounceViewFilter(pageviewFilter: string): string;
/** ClickHouse CTEs from fact tables (fallback when v_session_bounce is not deployed). */
export declare function sessionBounceCteFromFacts(pageviewFilter: string, activityFilter: string): string;
/** session_bounce source: v_session_bounce view or fact CTEs. */
export declare function sessionBounceCte(pageviewFilter: string, activityFilter: string): string;
/** Scalar bounce rate for a period. */
export declare function bounceRateScalarQuery(pageviewFilter: string, activityFilter: string): string;
/** Bounce rate grouped by day (session day = date of first page view). */
export declare function bounceRateByDayQuery(pageviewFilter: string, activityFilter: string): string;
/** Bounce rate grouped by an arbitrary period expression on session_started_at. */
export declare function bounceRateGroupedQuery(groupExpr: string, pageviewFilter: string, activityFilter: string): string;
export declare const SESSION_BOUNCE_IS_BOUNCE_EXPR = "\n  toUInt8(\n    coalesce(ps.pageview_count, 0) = 1\n    AND coalesce(sa.duration_seconds, 0) < 10\n  )";
