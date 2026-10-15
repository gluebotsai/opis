/** ClickHouse visitor profile for dashboard: dim_known_users + dim_sessions only. */

import {
  KNOWN_USER_IDENTITY_SELECT_SQL,
  KNOWN_USER_LINKED_PROFILES_COUNT_FOR_VISITOR_SQL,
  KNOWN_USER_LIST_IDENTITY_SELECT_SQL,
  KNOWN_USER_LIST_LINKED_PROFILES_COUNT_SQL,
  KNOWN_USER_SESSION_IDENTITY_SELECT_SQL,
  KNOWN_USER_SESSION_DISPLAY_IDENTITY_SELECT_SQL,
  knownUserIdentificationJoinSql,
  knownUserListIdentificationJoinSql,
  knownUserProfilesForVisitorSelectSql,
  knownUserSessionIdentificationJoinSql,
  knownUserSessionDisplayIdentificationJoinSql,
  replayListProfileJoinSql,
  REPLAY_LIST_PROFILE_SELECT_SQL,
} from "./knownUserIdentificationSql.js";

export function profileIdentitySelectSql(): string {
  return KNOWN_USER_IDENTITY_SELECT_SQL;
}

export function profileListIdentitySelectSql(): string {
  return KNOWN_USER_LIST_IDENTITY_SELECT_SQL;
}

export function profileLinkedCountSql(): string {
  return KNOWN_USER_LINKED_PROFILES_COUNT_FOR_VISITOR_SQL;
}

export function profileListIdentificationJoinSql(visitorIdExpr = "v.visitor_id"): string {
  return knownUserListIdentificationJoinSql(visitorIdExpr);
}

export function profileListLinkedCountSql(): string {
  return KNOWN_USER_LIST_LINKED_PROFILES_COUNT_SQL;
}

export function sessionProfileSelectSql(): string {
  return KNOWN_USER_SESSION_IDENTITY_SELECT_SQL;
}

export function profileIdentificationJoinSql(visitorIdExpr = "v.visitor_id"): string {
  return knownUserIdentificationJoinSql(visitorIdExpr);
}

export function profileIdentificationJoinForSelectedSql(visitorIdExpr = "v.visitor_id"): string {
  return knownUserIdentificationJoinSql(visitorIdExpr);
}

export function sessionProfileJoinSql(sessionIdExpr: string, visitorIdExpr: string): string {
  return knownUserSessionIdentificationJoinSql(sessionIdExpr, visitorIdExpr);
}

export function sessionDisplayProfileSelectSql(): string {
  return KNOWN_USER_SESSION_DISPLAY_IDENTITY_SELECT_SQL;
}

export function sessionDisplayProfileJoinSql(sessionIdExpr: string, visitorIdExpr: string): string {
  return knownUserSessionDisplayIdentificationJoinSql(sessionIdExpr, visitorIdExpr);
}

export function replayListProfileJoinSqlFor(visitorIdExpr: string): string {
  return replayListProfileJoinSql(visitorIdExpr);
}

export function replayListProfileSelectSql(): string {
  return REPLAY_LIST_PROFILE_SELECT_SQL;
}

export { knownUserProfilesForVisitorSelectSql };

/** Parse synthetic id: wt:{websiteId}:{userId} */
export function parseKnownUserIdFromProfileKey(profileKey: string): string | null {
  const key = String(profileKey ?? "").trim();
  if (!key.startsWith("wt:")) return null;
  const parts = key.split(":");
  if (parts.length < 3) return null;
  return parts.slice(2).join(":");
}
