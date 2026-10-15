/** ClickHouse visitor profile for dashboard: dim_known_users + dim_sessions only. */
import { knownUserProfilesForVisitorSelectSql } from "./knownUserIdentificationSql.js";
export declare function profileIdentitySelectSql(): string;
export declare function profileListIdentitySelectSql(): string;
export declare function profileLinkedCountSql(): string;
export declare function profileListIdentificationJoinSql(visitorIdExpr?: string): string;
export declare function profileListLinkedCountSql(): string;
export declare function sessionProfileSelectSql(): string;
export declare function profileIdentificationJoinSql(visitorIdExpr?: string): string;
export declare function profileIdentificationJoinForSelectedSql(visitorIdExpr?: string): string;
export declare function sessionProfileJoinSql(sessionIdExpr: string, visitorIdExpr: string): string;
export declare function sessionDisplayProfileSelectSql(): string;
export declare function sessionDisplayProfileJoinSql(sessionIdExpr: string, visitorIdExpr: string): string;
export declare function replayListProfileJoinSqlFor(visitorIdExpr: string): string;
export declare function replayListProfileSelectSql(): string;
export { knownUserProfilesForVisitorSelectSql };
/** Parse synthetic id: wt:{websiteId}:{userId} */
export declare function parseKnownUserIdFromProfileKey(profileKey: string): string | null;
