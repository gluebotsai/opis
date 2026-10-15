/** Query / filter sentinel: metrics where fact.user_id is empty (pre-login, post-logout). */
export const ANONYMOUS_FILTER_USER_ID = "__anonymous__";
/** Picker value for anonymous scope (not a dim_known_users row). */
export const ANONYMOUS_SCOPE_CDP_ID = "__anonymous__";
export function buildAnonymousScopeProfile() {
    return {
        cdp_id: ANONYMOUS_SCOPE_CDP_ID,
        contact_type: "Anonymous",
        display_name: "Anonymous",
        first_name: "",
        last_name: "",
        primary_email: "",
        primary_phone: "",
        company: "",
        acquisition_channel: "",
        webtracking_user_id: ANONYMOUS_FILTER_USER_ID,
        is_cdp_known: false,
        identity_label: "Anonymous",
        linked_visitor_ids_count: 0,
        linked_visitor_ids: [],
        other_linked_visitor_ids: [],
    };
}
/** @deprecated Use buildAnonymousScopeProfile */
export function buildGuestUserProfile(_websiteId, _visitorId) {
    return buildAnonymousScopeProfile();
}
export function isAnonymousScopeCdpId(cdpId) {
    return String(cdpId ?? "").trim() === ANONYMOUS_SCOPE_CDP_ID;
}
/** @deprecated Use isAnonymousScopeCdpId */
export function isGuestCdpId(cdpId) {
    return isAnonymousScopeCdpId(cdpId);
}
export function isAnonymousFilterUserId(userId) {
    return String(userId ?? "").trim() === ANONYMOUS_FILTER_USER_ID;
}
export function filterUserIdFromCdpId(cdpId, websiteId) {
    if (isAnonymousScopeCdpId(cdpId))
        return ANONYMOUS_FILTER_USER_ID;
    const prefix = `wt:${websiteId}:`;
    if (!cdpId.startsWith(prefix))
        return null;
    return cdpId.slice(prefix.length);
}
