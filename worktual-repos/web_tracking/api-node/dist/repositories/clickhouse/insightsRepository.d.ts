import { type ClickHouseClient } from "../../plugins/clickhouse.js";
import type { ComparisonMetric, InsightsSnapshot, RollupPoint, TopMover } from "../../types/insights.js";
export declare class InsightsRepository {
    getDailyRollups(client: ClickHouseClient, websiteId: number, days?: number): Promise<RollupPoint[]>;
    getWeeklyRollups(client: ClickHouseClient, websiteId: number, weeks?: number): Promise<RollupPoint[]>;
    getMonthlyRollups(client: ClickHouseClient, websiteId: number, months?: number): Promise<RollupPoint[]>;
    private windowMetrics;
    private windowDays;
    getComparison(client: ClickHouseClient, websiteId: number, period: string): Promise<ComparisonMetric[]>;
    private comparePair;
    getTopMovers(client: ClickHouseClient, websiteId: number, period: string): Promise<TopMover[]>;
    detectPrimaryAnomaly(comparison: ComparisonMetric[], topMovers: TopMover[]): InsightsSnapshot["primary_anomaly"];
    buildSnapshot(client: ClickHouseClient, websiteId: number, period: string): Promise<InsightsSnapshot>;
}
export declare const insightsRepository: InsightsRepository;
