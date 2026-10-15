import type { VisitorCdpProfile } from "./visitorCdpProfile.js";
/** Query / filter sentinel: metrics where fact.user_id is empty (pre-login, post-logout). */
export declare const ANONYMOUS_FILTER_USER_ID = "__anonymous__";
/** Picker value for anonymous scope (not a dim_known_users row). */
export declare const ANONYMOUS_SCOPE_CDP_ID = "__anonymous__";
export declare function buildAnonymousScopeProfile(): VisitorCdpProfile;
/** @deprecated Use buildAnonymousScopeProfile */
export declare function buildGuestUserProfile(_websiteId: number, _visitorId: string): VisitorCdpProfile;
export declare function isAnonymousScopeCdpId(cdpId: string | null | undefined): boolean;
/** @deprecated Use isAnonymousScopeCdpId */
export declare function isGuestCdpId(cdpId: string | null | undefined): boolean;
export declare function isAnonymousFilterUserId(userId: string | null | undefined): boolean;
export declare function filterUserIdFromCdpId(cdpId: string, websiteId: number): string | null;
