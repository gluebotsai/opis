/** Safe inline LIMIT/OFFSET — ClickHouse parameterized LIMIT is unreliable in some clients. */
import { ANONYMOUS_FILTER_USER_ID } from "./guestUserProfile.js";
export function paginateClause(offset, limit) {
    const safeOffset = Math.max(0, Math.floor(offset));
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return `LIMIT ${safeLimit} OFFSET ${safeOffset}`;
}
export function limitClause(limit) {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return `LIMIT ${safeLimit}`;
}
/** Filter fact rows for one or more web visitor IDs (CDP-linked customer scope). */
export const VISITOR_IDS_FILTER_SQL = "visitor_id IN {visitorIds:Array(String)}";
export function visitorIdsFilterFor(columnExpr) {
    return `${columnExpr} IN {visitorIds:Array(String)}`;
}
const ANON = ANONYMOUS_FILTER_USER_ID;
/** When set, restrict dim_sessions-backed rows to this webtracking userId (customer_id). */
export const DIM_SESSION_USER_ID_FILTER_SQL = `(
  {filterUserId:String} = ''
  OR (
    {filterUserId:String} = '${ANON}'
    AND length(coalesce(s.user_id, '')) = 0
    AND s.visitor_id IN {visitorIds:Array(String)}
  )
  OR (
    length({filterUserId:String}) > 0
    AND {filterUserId:String} != '${ANON}'
    AND upper(coalesce(s.user_id, '')) = upper({filterUserId:String})
  )
)`;
/**
 * Per-account scope on fact tables (alias required, e.g. pv, ie, p).
 * Event-level user_id only — do not expand via dim_sessions.session_id (same browser
 * session can include guest browsing then login; session-level user_id would merge both).
 */
export function factAccountFilterSql(tableAlias) {
    const t = tableAlias;
    return `(
  {filterUserId:String} = ''
  OR (
    {filterUserId:String} = '${ANON}'
    AND length(coalesce(nullIf(${t}.user_id, ''), '')) = 0
    AND ${t}.visitor_id IN {visitorIds:Array(String)}
  )
  OR (
    length({filterUserId:String}) > 0
    AND {filterUserId:String} != '${ANON}'
    AND upper(coalesce(nullIf(${t}.user_id, ''), '')) = upper({filterUserId:String})
  )
)`;
}
/** Session list/joins: if facts are account-scoped, do not also filter by dim_sessions.user_id. */
export const DIM_SESSION_USER_OR_SKIP_WHEN_ACCOUNT_FILTER_SQL = `(
  length({filterUserId:String}) > 0
  OR ${DIM_SESSION_USER_ID_FILTER_SQL}
)`;
export function visitorAnalyticsParams(websiteId, filter) {
    return {
        websiteId,
        visitorIds: filter.visitorIds,
        filterUserId: String(filter.filterUserId ?? "").trim(),
    };
}
/** SDK scroll_milestone props use milestone + maxDepth; missing keys extract as 0 in ClickHouse. */
export const SCROLL_DEPTH_FROM_PROPS = `
coalesce(
    nullIf(JSONExtractFloat(props_json, 'milestone'), 0),
    nullIf(JSONExtractFloat(props_json, 'scrollDepth'), 0),
    nullIf(JSONExtractFloat(props_json, 'maxDepth'), 0),
    0
)
`;
export const SCROLL_DEPTH_FROM_EXTRA = `
coalesce(
    nullIf(JSONExtractFloat(extra_data, 'milestone'), 0),
    nullIf(JSONExtractFloat(extra_data, 'scrollDepth'), 0),
    nullIf(JSONExtractFloat(extra_data, 'maxDepth'), 0),
    0
)
`;
export const SCROLL_EVENT_TYPES_SQL = "'scroll', 'scroll_depth'";
