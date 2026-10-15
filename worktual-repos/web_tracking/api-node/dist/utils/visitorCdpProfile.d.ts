import type { Row } from "../plugins/clickhouse.js";
export interface VisitorCdpProfile {
    cdp_id: string;
    contact_type: string;
    display_name: string;
    first_name: string;
    last_name: string;
    primary_email: string;
    primary_phone: string;
    company: string;
    acquisition_channel: string;
    /** Internal: SDK userId; not shown in admin profile UI. */
    webtracking_user_id: string;
    is_cdp_known: boolean;
    identity_label: string;
    linked_visitor_ids_count: number;
    linked_visitor_ids: string[];
    other_linked_visitor_ids: string[];
}
export declare function buildVisitorCdpProfile(row: Row | null | undefined, currentVisitorId: string): VisitorCdpProfile | null;
export declare function buildVisitorCdpProfileSummary(row: Row | null | undefined): VisitorCdpProfile | null;
/** UI label for list / picker (Anonymous when no resolved login). */
export declare function profileDisplayLabel(profile: VisitorCdpProfile | null | undefined): string;
/** Visitors list: prefer "First Last · email" when both exist. */
export declare function profileListDisplayLabel(profile: VisitorCdpProfile | null | undefined): string;
/** Known login but no usable name/email — still not Anonymous for pickers. */
export declare function isWeakKnownProfileLabel(label: string): boolean;
/** Richness score for picking the best row when the same person appears under multiple user_ids. */
export declare function profileIdentityScore(profile: VisitorCdpProfile): number;
/** Login user_id with no name, email, or phone — hide from multi-account picker. */
export declare function isEmptyKnownProfile(profile: VisitorCdpProfile | null | undefined): boolean;
/** One picker entry per user_id / email; drop empty "Customer" stubs. */
export declare function dedupeLinkedKnownProfiles(profiles: VisitorCdpProfile[]): VisitorCdpProfile[];
/** @deprecated Use resolveSessionDisplayProfiles — session-only identity, no visitor-level fallback. */
export declare function pickLiveSessionCdpProfile(sessionProfile: VisitorCdpProfile | null, _visitorLatestKnownProfile: VisitorCdpProfile | null): VisitorCdpProfile | null;
/** Fill name/email from dim_known_users by user_id when session row only had userId. */
export declare function enrichWeakProfileFromKnownUserIdentity(profile: VisitorCdpProfile | null, visitorId: string, websiteId: number, identity: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    method: string;
    traits_json: string;
} | undefined): VisitorCdpProfile | null;
export declare function buildProfileLabelFromIdentityRow(row: Row, websiteId: number, visitorId: string): string;
