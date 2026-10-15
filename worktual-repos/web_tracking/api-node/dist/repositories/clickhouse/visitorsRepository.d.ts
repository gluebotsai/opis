import { type ClickHouseClient, type Row } from "../../plugins/clickhouse.js";
import { type VisitorAnalyticsFilter } from "../../utils/clickhouseSql.js";
import { buildVisitorCdpProfile, type VisitorCdpProfile } from "../../utils/visitorCdpProfile.js";
export declare class VisitorsRepository {
    resolveOrganizationId(client: ClickHouseClient, websiteId: number, organizationId: number | null): Promise<number>;
    listVisitors(client: ClickHouseClient, websiteId: number, organizationId: number, offset?: number, limit?: number, search?: string | null): Promise<Row>;
    getVisitorCampaignAttribution(client: ClickHouseClient, websiteId: number, primaryVisitorId: string): Promise<string | null>;
    listLinkedCdpProfilesForVisitor(client: ClickHouseClient, organizationId: number, visitorId: string, websiteId?: number): Promise<Row[]>;
    /** Enriched, deduped known accounts for visitor detail / account picker (excludes Anonymous). */
    resolveLinkedKnownCdpProfiles(client: ClickHouseClient, organizationId: number, visitorId: string, websiteId: number): Promise<VisitorCdpProfile[]>;
    /** Names for tooltip: Anonymous + each login seen on this browser (visitor_id). */
    getBrowserAccountLabelLists(client: ClickHouseClient, websiteId: number, visitorIds: string[]): Promise<Record<string, string[]>>;
    /** dim_known_users + list joins for many visitor IDs (Visitors list / cart abandon enrichment). */
    getVisitorCdpProfileRowsByIds(client: ClickHouseClient, websiteId: number, organizationId: number, visitorIds: string[]): Promise<Map<string, Row>>;
    /**
     * Most recent identify/login row per visitor (Live Users label after logout).
     * Uses dim_known_users only — no session user_id required.
     */
    getSessionDisplayProfileRowsByKeys(client: ClickHouseClient, websiteId: number, organizationId: number, keys: {
        session_id: string;
        visitor_id: string;
    }[]): Promise<Map<string, Row>>;
    /** Most recently active session per visitor (same activity signal as list profile). */
    getRecentSessionIdsByVisitorIds(client: ClickHouseClient, websiteId: number, visitorIds: string[]): Promise<Map<string, string>>;
    /** Active live window (5 min): one session_id per visitor for list ↔ live sync. */
    getActiveLiveSessionIdsByVisitorIds(client: ClickHouseClient, websiteId: number, visitorIds: string[]): Promise<Map<string, string>>;
    getLatestKnownProfileRowsByVisitorIds(client: ClickHouseClient, websiteId: number, visitorIds: string[]): Promise<Map<string, Row>>;
    /**
     * One display profile per visitor_id (recent session user + dim_known_users).
     * Used by Live Users, Visitors, Sessions, and Replay for consistent names.
     */
    getUnifiedVisitorDisplayProfilesByVisitorIds(client: ClickHouseClient, websiteId: number, organizationId: number, visitorIds: string[]): Promise<Map<string, ReturnType<typeof buildVisitorCdpProfile>>>;
    /** Same profile label as Visitors list (recent session account), for a set of visitor IDs. */
    getLastActiveProfileByVisitorIds(client: ClickHouseClient, websiteId: number, organizationId: number, visitorIds: string[]): Promise<Record<string, {
        last_active_profile_label: string;
    }>>;
    /** Latest identify traits per store user_id (any visitor cookie on this site). */
    fetchKnownUserIdentityByUserIds(client: ClickHouseClient, websiteId: number, userIds: string[]): Promise<Map<string, {
        first_name: string;
        last_name: string;
        email: string;
        phone: string;
        method: string;
        traits_json: string;
    }>>;
    getVisitor(client: ClickHouseClient, websiteId: number, organizationId: number, visitorId: string, selectedCdpId?: string | null): Promise<Row | null>;
    getVisitorSessions(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row[]>;
    getVisitorSessionAttribution(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row[]>;
    getVisitorClickCount(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<number>;
    getVisitorInteractionCount(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<number>;
    getVisitorTopPages(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row[]>;
    getVisitorTopProducts(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row[]>;
    getVisitorConversions(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row[]>;
    getVisitorConversionRevenue(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row>;
    getVisitorJourney(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row[]>;
    getVisitorTotalDuration(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<number>;
    getVisitorScrollDepth(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row[]>;
    /** Net cart/wishlist qty from add/remove events; quantity defaults to 1 when omitted in extra_data. */
    private static readonly PRODUCT_QTY_EXPR;
    private static productInteractionWhere;
    private static stagingEventWhere;
    /** props.products[] / extra_data.products[] element (Booxoo begin_checkout & purchase). */
    private static readonly PRODUCTS_ARRAY_LINE_ID;
    private static readonly PRODUCTS_ARRAY_LINE_NAME;
    private static readonly PRODUCTS_ARRAY_LINE_QTY;
    private static readonly PRODUCTS_ARRAY_LINE_PRICE;
    getVisitorProductActivity(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row>;
    getVisitorRecentInteractions(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter, limit?: number): Promise<Row[]>;
    getVisitorDailyActivity(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row[]>;
    getVisitorCombinedRollup(client: ClickHouseClient, websiteId: number, visitorIds: string[]): Promise<Row>;
    getVisitorEngagement(client: ClickHouseClient, websiteId: number, filter: VisitorAnalyticsFilter): Promise<Row>;
}
export declare const visitorsRepository: VisitorsRepository;
