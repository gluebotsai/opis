import { type ClickHouseClient, type Row } from "../../plugins/clickhouse.js";
export declare const REPLAY_EVENT_NAMES: readonly ["rrweb", "rrweb_event", "replay_event", "replay_chunk", "session_replay"];
export declare const HEATMAP_EVENT_TYPES: readonly ["click", "move", "scroll", "rage_click", "dead_click"];
export declare const MOVE_BIN_SIZE = 25;
export declare const REPLAY_API_HINT: {
    format: string;
    schema_version: number;
    endpoint: string;
    storage: string;
};
export declare const EVENT_TYPE_LABELS: Record<string, string>;
export declare class HeatmapRepository {
    fetchDomainEventTotals(client: ClickHouseClient, websiteId: number, dateFilterSql: string): Promise<Row>;
    fetchHeatmapPages(client: ClickHouseClient, websiteId: number, interactionDateFilterSql: string, limit?: number): Promise<Row[]>;
    fetchScrollDistribution(client: ClickHouseClient, websiteId: number, pagePath: string, dateFilterSql: string, visitorId?: string | null, sessionId?: string | null): Promise<Row[]>;
    fetchHeatmapData(client: ClickHouseClient, websiteId: number, pagePath: string, dateFilterSql: string, eventType?: string, visitorId?: string | null, sessionId?: string | null, pointLimit?: number, filterUserId?: string | null): Promise<Row>;
    fetchHeatmapScopes(client: ClickHouseClient, websiteId: number, pagePath: string, dateFilterSql: string, eventType?: string, limit?: number): Promise<Row>;
}
export declare const heatmapRepository: HeatmapRepository;
