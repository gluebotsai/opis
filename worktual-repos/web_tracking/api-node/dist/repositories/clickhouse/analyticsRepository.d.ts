import { type ClickHouseClient, type Row } from "../../plugins/clickhouse.js";
export declare class AnalyticsRepository {
    getOverview(client: ClickHouseClient, websiteId: number, period: string, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getEngagement(client: ClickHouseClient, websiteId: number, period: string, limit?: number): Promise<Row>;
    getLive(client: ClickHouseClient, websiteId: number, organizationId: number): Promise<Row>;
    getPageDropoff(client: ClickHouseClient, websiteId: number, period: string, limit?: number): Promise<Row>;
    getTopPages(client: ClickHouseClient, websiteId: number, period: string, limit?: number): Promise<Row[]>;
    getScrollDepth(client: ClickHouseClient, websiteId: number, period: string, limit?: number): Promise<Row>;
    getTrafficSourceSessions(client: ClickHouseClient, websiteId: number, period: string): Promise<Row[]>;
    getBrowserSessions(client: ClickHouseClient, websiteId: number, period: string): Promise<Row[]>;
    getGeographySessions(client: ClickHouseClient, websiteId: number, period: string): Promise<Row[]>;
    getForms(client: ClickHouseClient, websiteId: number, period: string, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getFormSubmissions(client: ClickHouseClient, websiteId: number, period: string, formId: string, limit: number, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getFormLeads(client: ClickHouseClient, websiteId: number, period: string, formId: string, limit: number, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getPerformance(client: ClickHouseClient, websiteId: number, period: string, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getErrors(client: ClickHouseClient, websiteId: number, period: string, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getCustomEvents(client: ClickHouseClient, websiteId: number, period: string, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getProducts(client: ClickHouseClient, websiteId: number, period: string, limit?: number): Promise<Row>;
    getSessions(client: ClickHouseClient, websiteId: number, period: string, dateFrom?: string | null, dateTo?: string | null, offset?: number, limit?: number): Promise<Row>;
    sessionExists(client: ClickHouseClient, websiteId: number, sessionId: string): Promise<boolean>;
    sessionHasReplay(client: ClickHouseClient, websiteId: number, sessionId: string): Promise<boolean>;
    getReplaySessions(client: ClickHouseClient, websiteId: number, organizationId: number, period: string, dateFrom?: string | null, dateTo?: string | null, offset?: number, limit?: number, sessionSearch?: string | null, visitorSearch?: string | null, filterUserId?: string | null): Promise<{
        sessions: Row[];
        total: number;
        format: string;
        offset: number;
        limit: number;
        latest_recording_at: unknown;
    }>;
    getReplayEvents(client: ClickHouseClient, websiteId: number, sessionId: string, period: string, dateFrom?: string | null, dateTo?: string | null, pagePath?: string | null, limit?: number): Promise<{
        events: unknown[];
        chunkCount: number;
        storage: string;
        minChunkIndex?: number;
        format?: string;
    }>;
    getEcommerceOverview(client: ClickHouseClient, websiteId: number, period: string, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getEcommerceProducts(client: ClickHouseClient, websiteId: number, period: string, limit?: number, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getEcommerceTrending(client: ClickHouseClient, websiteId: number, period: string, limit?: number, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
    getEcommerceEngagedVisitors(client: ClickHouseClient, websiteId: number, organizationId: number, period: string, limit?: number, dateFrom?: string | null, dateTo?: string | null): Promise<Row>;
}
export declare const analyticsRepository: AnalyticsRepository;
