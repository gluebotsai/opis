import type { ClickHouseClient } from "../plugins/clickhouse.js";
import { buildVisitorCdpProfile, type VisitorCdpProfile } from "../utils/visitorCdpProfile.js";
export type SessionDisplayKey = {
    session_id: string;
    visitor_id: string;
};
export declare function sessionDisplayMapKey(key: SessionDisplayKey): string;
/** Profile label for one browser session (logged in this session, else Anonymous). */
export declare function sessionDisplayProfileOrAnonymous(row: Parameters<typeof buildVisitorCdpProfile>[0], visitorId: string): VisitorCdpProfile;
export declare function resolveSessionDisplayProfiles(client: ClickHouseClient, websiteId: number, organizationId: number, keys: SessionDisplayKey[]): Promise<Map<string, VisitorCdpProfile>>;
export declare function pickLiveSessionIdForVisitor(liveSessions: SessionDisplayKey[]): Map<string, string>;
