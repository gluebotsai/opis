/** ClickHouse visitor profile for dashboard: dim_known_users + dim_sessions only. */
import { KNOWN_USER_IDENTITY_SELECT_SQL, KNOWN_USER_LINKED_PROFILES_COUNT_FOR_VISITOR_SQL, KNOWN_USER_LIST_IDENTITY_SELECT_SQL, KNOWN_USER_LIST_LINKED_PROFILES_COUNT_SQL, KNOWN_USER_SESSION_IDENTITY_SELECT_SQL, KNOWN_USER_SESSION_DISPLAY_IDENTITY_SELECT_SQL, knownUserIdentificationJoinSql, knownUserListIdentificationJoinSql, knownUserProfilesForVisitorSelectSql, knownUserSessionIdentificationJoinSql, knownUserSessionDisplayIdentificationJoinSql, replayListProfileJoinSql, REPLAY_LIST_PROFILE_SELECT_SQL, } from "./knownUserIdentificationSql.js";
export function profileIdentitySelectSql() {
    return KNOWN_USER_IDENTITY_SELECT_SQL;
}
export function profileListIdentitySelectSql() {
    return KNOWN_USER_LIST_IDENTITY_SELECT_SQL;
}
export function profileLinkedCountSql() {
    return KNOWN_USER_LINKED_PROFILES_COUNT_FOR_VISITOR_SQL;
}
export function profileListIdentificationJoinSql(visitorIdExpr = "v.visitor_id") {
    return knownUserListIdentificationJoinSql(visitorIdExpr);
}
export function profileListLinkedCountSql() {
    return KNOWN_USER_LIST_LINKED_PROFILES_COUNT_SQL;
}
export function sessionProfileSelectSql() {
    return KNOWN_USER_SESSION_IDENTITY_SELECT_SQL;
}
export function profileIdentificationJoinSql(visitorIdExpr = "v.visitor_id") {
    return knownUserIdentificationJoinSql(visitorIdExpr);
}
export function profileIdentificationJoinForSelectedSql(visitorIdExpr = "v.visitor_id") {
    return knownUserIdentificationJoinSql(visitorIdExpr);
}
export function sessionProfileJoinSql(sessionIdExpr, visitorIdExpr) {
    return knownUserSessionIdentificationJoinSql(sessionIdExpr, visitorIdExpr);
}
export function sessionDisplayProfileSelectSql() {
    return KNOWN_USER_SESSION_DISPLAY_IDENTITY_SELECT_SQL;
}
export function sessionDisplayProfileJoinSql(sessionIdExpr, visitorIdExpr) {
    return knownUserSessionDisplayIdentificationJoinSql(sessionIdExpr, visitorIdExpr);
}
export function replayListProfileJoinSqlFor(visitorIdExpr) {
    return replayListProfileJoinSql(visitorIdExpr);
}
export function replayListProfileSelectSql() {
    return REPLAY_LIST_PROFILE_SELECT_SQL;
}
export { knownUserProfilesForVisitorSelectSql };
/** Parse synthetic id: wt:{websiteId}:{userId} */
export function parseKnownUserIdFromProfileKey(profileKey) {
    const key = String(profileKey ?? "").trim();
    if (!key.startsWith("wt:"))
        return null;
    const parts = key.split(":");
    if (parts.length < 3)
        return null;
    return parts.slice(2).join(":");
}
