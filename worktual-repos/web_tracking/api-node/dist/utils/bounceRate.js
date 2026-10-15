/** Bounce = exactly one page view in the session AND session activity duration < threshold. */
export const BOUNCE_MAX_DURATION_SECONDS = 10;
/** Aggregate bounce rate (0–100) from rows with is_bounce (0/1). */
export const BOUNCE_RATE_AGG_EXPR = `
  if(count() = 0, 0,
     round(countIf(is_bounce = 1) / count() * 100, 2))
`;
export function bounceQuerySource() {
    const raw = (process.env.BOUNCE_QUERY_SOURCE ?? "view").trim().toLowerCase();
    return raw === "facts" ? "facts" : "view";
}
export function isSessionBounce(pageviewCount, durationSeconds) {
    return pageviewCount === 1 && durationSeconds < BOUNCE_MAX_DURATION_SECONDS;
}
/** Page the visitor left on for a bounce session (single-page: entry path). */
export function bouncePageForSession(row) {
    const pageviewCount = Number(row.pageview_count ?? 0);
    const durationSeconds = Number(row.duration_seconds ?? 0);
    const bounced = Number(row.is_bounce ?? 0) === 1 || isSessionBounce(pageviewCount, durationSeconds);
    if (!bounced)
        return "";
    const entry = String(row.entry_page ?? "").trim();
    const exit = String(row.exit_page ?? "").trim();
    if (pageviewCount <= 1)
        return entry || exit;
    return exit || entry;
}
/** Map fact-table date filters to v_session_bounce.session_started_at. */
export function sessionBounceViewFilter(pageviewFilter) {
    return pageviewFilter.replace(/created_at/g, "session_started_at");
}
/** ClickHouse CTEs from fact tables (fallback when v_session_bounce is not deployed). */
export function sessionBounceCteFromFacts(pageviewFilter, activityFilter) {
    const maxDur = BOUNCE_MAX_DURATION_SECONDS;
    return `
    pageview_stats AS (
      SELECT
        session_id,
        count() AS pageview_count,
        min(created_at) AS session_started_at
      FROM fact_page_views
      WHERE website_id = {websiteId:UInt32}${pageviewFilter}
      GROUP BY session_id
      HAVING pageview_count > 0
    ),
    session_activity AS (
      SELECT
        session_id,
        toUInt32(greatest(0, dateDiff('second', min(event_ts), max(event_ts)))) AS duration_seconds
      FROM (
        SELECT session_id, created_at AS event_ts
        FROM fact_page_views
        WHERE website_id = {websiteId:UInt32}${activityFilter}
        UNION ALL
        SELECT session_id, created_at AS event_ts
        FROM fact_interaction_events
        WHERE website_id = {websiteId:UInt32}${activityFilter}
      )
      GROUP BY session_id
    ),
    session_bounce AS (
      SELECT
        p.session_id,
        p.pageview_count,
        coalesce(a.duration_seconds, 0) AS duration_seconds,
        toUInt8(p.pageview_count = 1 AND coalesce(a.duration_seconds, 0) < ${maxDur}) AS is_bounce,
        p.session_started_at
      FROM pageview_stats p
      LEFT JOIN session_activity a ON a.session_id = p.session_id
    )`;
}
/** session_bounce source: v_session_bounce view or fact CTEs. */
export function sessionBounceCte(pageviewFilter, activityFilter) {
    if (bounceQuerySource() === "facts") {
        return sessionBounceCteFromFacts(pageviewFilter, activityFilter);
    }
    const viewFilter = sessionBounceViewFilter(pageviewFilter);
    return `
    session_bounce AS (
      SELECT
        session_id,
        pageview_count,
        duration_seconds,
        is_bounce,
        session_started_at
      FROM v_session_bounce
      WHERE website_id = {websiteId:UInt32}${viewFilter}
    )`;
}
/** Scalar bounce rate for a period. */
export function bounceRateScalarQuery(pageviewFilter, activityFilter) {
    return `
    WITH ${sessionBounceCte(pageviewFilter, activityFilter)}
    SELECT ${BOUNCE_RATE_AGG_EXPR} AS bounce_rate
    FROM session_bounce
  `;
}
/** Bounce rate grouped by day (session day = date of first page view). */
export function bounceRateByDayQuery(pageviewFilter, activityFilter) {
    return `
    WITH ${sessionBounceCte(pageviewFilter, activityFilter)}
    SELECT toDate(session_started_at) AS day,
           ${BOUNCE_RATE_AGG_EXPR} AS bounce_rate
    FROM session_bounce
    GROUP BY day
  `;
}
/** Bounce rate grouped by an arbitrary period expression on session_started_at. */
export function bounceRateGroupedQuery(groupExpr, pageviewFilter, activityFilter) {
    return `
    WITH ${sessionBounceCte(pageviewFilter, activityFilter)}
    SELECT ${groupExpr} AS period_key,
           uniqExact(session_id) AS sessions,
           ${BOUNCE_RATE_AGG_EXPR} AS bounce_rate
    FROM session_bounce
    GROUP BY period_key
  `;
}
export const SESSION_BOUNCE_IS_BOUNCE_EXPR = `
  toUInt8(
    coalesce(ps.pageview_count, 0) = 1
    AND coalesce(sa.duration_seconds, 0) < ${BOUNCE_MAX_DURATION_SECONDS}
  )`;
