export declare function paginateClause(offset: number, limit: number): string;
export declare function limitClause(limit: number): string;
/** Filter fact rows for one or more web visitor IDs (CDP-linked customer scope). */
export declare const VISITOR_IDS_FILTER_SQL = "visitor_id IN {visitorIds:Array(String)}";
export declare function visitorIdsFilterFor(columnExpr: string): string;
/** When set, restrict dim_sessions-backed rows to this webtracking userId (customer_id). */
export declare const DIM_SESSION_USER_ID_FILTER_SQL = "(\n  {filterUserId:String} = ''\n  OR (\n    {filterUserId:String} = '__anonymous__'\n    AND length(coalesce(s.user_id, '')) = 0\n    AND s.visitor_id IN {visitorIds:Array(String)}\n  )\n  OR (\n    length({filterUserId:String}) > 0\n    AND {filterUserId:String} != '__anonymous__'\n    AND upper(coalesce(s.user_id, '')) = upper({filterUserId:String})\n  )\n)";
/**
 * Per-account scope on fact tables (alias required, e.g. pv, ie, p).
 * Event-level user_id only — do not expand via dim_sessions.session_id (same browser
 * session can include guest browsing then login; session-level user_id would merge both).
 */
export declare function factAccountFilterSql(tableAlias: string): string;
/** Session list/joins: if facts are account-scoped, do not also filter by dim_sessions.user_id. */
export declare const DIM_SESSION_USER_OR_SKIP_WHEN_ACCOUNT_FILTER_SQL = "(\n  length({filterUserId:String}) > 0\n  OR (\n  {filterUserId:String} = ''\n  OR (\n    {filterUserId:String} = '__anonymous__'\n    AND length(coalesce(s.user_id, '')) = 0\n    AND s.visitor_id IN {visitorIds:Array(String)}\n  )\n  OR (\n    length({filterUserId:String}) > 0\n    AND {filterUserId:String} != '__anonymous__'\n    AND upper(coalesce(s.user_id, '')) = upper({filterUserId:String})\n  )\n)\n)";
export type VisitorAnalyticsFilter = {
    visitorIds: string[];
    filterUserId?: string | null;
};
export declare function visitorAnalyticsParams(websiteId: number, filter: VisitorAnalyticsFilter): Record<string, unknown>;
/** SDK scroll_milestone props use milestone + maxDepth; missing keys extract as 0 in ClickHouse. */
export declare const SCROLL_DEPTH_FROM_PROPS = "\ncoalesce(\n    nullIf(JSONExtractFloat(props_json, 'milestone'), 0),\n    nullIf(JSONExtractFloat(props_json, 'scrollDepth'), 0),\n    nullIf(JSONExtractFloat(props_json, 'maxDepth'), 0),\n    0\n)\n";
export declare const SCROLL_DEPTH_FROM_EXTRA = "\ncoalesce(\n    nullIf(JSONExtractFloat(extra_data, 'milestone'), 0),\n    nullIf(JSONExtractFloat(extra_data, 'scrollDepth'), 0),\n    nullIf(JSONExtractFloat(extra_data, 'maxDepth'), 0),\n    0\n)\n";
export declare const SCROLL_EVENT_TYPES_SQL = "'scroll', 'scroll_depth'";
