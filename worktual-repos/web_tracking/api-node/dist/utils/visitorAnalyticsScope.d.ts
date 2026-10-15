import type { VisitorCdpProfile } from "./visitorCdpProfile.js";
export type VisitorAnalyticsScopeKind = "single" | "cdp_linked" | "multi_account_browser";
export interface VisitorAnalyticsScope {
    scope: VisitorAnalyticsScopeKind;
    primary_visitor_id: string;
    combined_visitor_ids: string[];
    /** CDP profiles tied to this browser visitor id (shared device / multiple logins). */
    linked_cdp_profiles: VisitorCdpProfile[];
    selected_cdp_id: string | null;
    /** Filter sessions/metrics by webtracking userId (customer_id). Empty = no filter. */
    filter_user_id: string;
}
export declare function normalizeVisitorIdList(primaryVisitorId: string, linkedIds: unknown): string[];
export declare function resolveVisitorAnalyticsScope(primaryVisitorId: string, cdpProfile: VisitorCdpProfile | null, options?: {
    linkedCdpProfiles?: VisitorCdpProfile[];
    selectedCdpId?: string | null;
}): VisitorAnalyticsScope;
export declare function analyticsFilterFromScope(scope: VisitorAnalyticsScope): {
    visitorIds: string[];
    filterUserId: string;
};
